import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
process.env.SIMULAR_DIGITANDO = 'false';
const { lerLinhaCsv, produtoDoCatalogo, listarCatalogos, buscarProdutosAwin, chaveDosCatalogos, urlDoCatalogo, motivoForaDoPublico } = await import('../src/awin-produtos.js');
const { motivoLinkInvalido, awinLiberada, enviarProximo } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');

const LISTA = [
  '"Advertiser ID","Advertiser Name","Primary Region","Membership Status","Feed ID","Feed Name","Language","Vertical","Last Imported","Last Checked","No of products","URL"',
  '17652,"Nike","BR","active",9001,"Nike BR","Portuguese","Retail","","","3","https://x"', // como a Awin escreve de verdade
  '99999,"Loja não aprovada","BR","not joined",9002,"Outra","pt","Retail","","","10","https://y"',
].join('\n');
const CATALOGO = [
  'aw_deep_link,product_name,aw_product_id,merchant_image_url,aw_image_url,search_price,rrp_price,product_price_old,savings_percent,brand_name,in_stock,merchant_category,category_name,merchant_deep_link,currency',
  'https://www.awin1.com/pclick.php?p=1&a=1694399&m=17652,"Tênis Nike Revolution 7, Feminino",1,https://img/1.jpg,,299.99,499.99,,40,Nike,1,Tênis,Calçados,https://www.nike.com.br/1,BRL',
  'https://www.awin1.com/pclick.php?p=2&a=1694399&m=17652,Meia Nike Everyday,2,https://img/2.jpg,,49.90,,52.00,,Nike,1,Meias,Acessórios,https://www.nike.com.br/2,BRL',
  'https://www.awin1.com/pclick.php?p=3&a=1694399&m=17652,Camiseta Nike Dri-FIT Esgotada,3,https://img/3.jpg,,99.90,199.90,,50,Nike,0,Camisetas,Roupas,https://www.nike.com.br/3,BRL',
].join('\n');

const fetchFalso = (chamadas = []) => async (url) => {
  chamadas.push(url);
  if (url.includes('/list/')) return new Response(LISTA);
  if (url.includes('/download/')) return new Response(zlib.gzipSync(CATALOGO));
  return new Response('', { status: 404 });
};

test('catálogo da Awin: CSV com vírgula entre aspas, preço antigo, desconto, estoque e link de afiliado', () => {
  assert.deepEqual(lerLinhaCsv('a,"b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
  const loja = { nome: 'Nike' };
  const p = produtoDoCatalogo({ aw_deep_link: 'https://www.awin1.com/pclick.php?p=1&a=1694399&m=17652', product_name: 'Tênis Nike', aw_product_id: '1', search_price: '299.99', rrp_price: '499.99', in_stock: '1', merchant_image_url: 'https://img/1.jpg' }, loja);
  assert.deepEqual([p.id, p.loja, p.lojaNome, p.precoAtual, p.precoOriginal, p.descontoPct, p.emEstoque, p.categoria], ['AWF-1', 'awin', 'Nike', 299.99, 499.99, 40, true, 'Awin: Nike']);
  assert.equal(motivoLinkInvalido({ ...p }), null, 'link de produto (pclick ... a=) é aceito');
  assert.equal(produtoDoCatalogo({ product_name: 'x', aw_product_id: '9', search_price: '10' }, loja), null, 'sem link: fora');
  assert.equal(chaveDosCatalogos({ AWIN_FEED_KEY: ' k ' }), 'k');
  assert.match(urlDoCatalogo('k', 9001), /\/fid\/9001\/columns\/aw_deep_link,product_name.*\/compression\/gzip\//);
});

test('busca de produtos da Awin: só lojas aprovadas, só com desconto e em estoque, baixa 1x por dia e reveza entre os grupos', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mla-aw-'));
  const chamadas = [];
  const api = { anunciantes: async () => [{ id: 17652, nome: 'Nike' }] };
  const grupos = [{ nome: 'Fitness', ativo: true }, { nome: 'Geral', ativo: false }];
  const r = await buscarProdutosAwin({ grupos, api, chave: 'k', pasta, cfg: { porGrupo: 8, descontoMinimo: 15 }, fetchImpl: fetchFalso(chamadas) });
  assert.deepEqual(r.produtos.map((p) => [p.grupo, p.id]), [['Fitness', 'AWF-1']]); // meia com 4% e camiseta esgotada ficam de fora
  assert.deepEqual(r.categorias, { 'Awin: Nike': { encontrados: 1, aceitos: 0 } });
  assert.equal(chamadas.filter((u) => u.includes('/download/')).length, 1, 'só a loja aprovada');
  await buscarProdutosAwin({ grupos, api, chave: 'k', pasta, cfg: {}, fetchImpl: fetchFalso(chamadas) });
  assert.equal(chamadas.filter((u) => u.includes('/download/')).length, 1, 'catálogo de hoje fica guardado');
  assert.match((await buscarProdutosAwin({ grupos, api, chave: '', pasta })).motivo, /AWIN_FEED_KEY/);
  // Cada grupo recebe só o que é do assunto dele (e de marca, se for "só marcas"): o Perfumes não ganha o tênis.
  const comNicho = [
    { nome: 'Fitness', ativo: true, filtros: { palavrasObrigatorias: ['tenis'], soMarcas: true } },
    { nome: 'Perfumes', ativo: true, filtros: { palavrasObrigatorias: ['perfume'] } },
  ];
  const r2 = await buscarProdutosAwin({ grupos: comNicho, api, chave: 'k', pasta, cfg: {}, fetchImpl: fetchFalso(chamadas) });
  assert.deepEqual(r2.produtos.map((p) => [p.grupo, p.id]), [['Fitness', 'AWF-1']]);
  await assert.rejects(listarCatalogos('ruim', { fetchImpl: async () => new Response('{}', { status: 401 }) }), /recusou a chave/);
});

// Caso real (27/10/2026): num dia saíram 11 Nike no Fitness, alguns masculinos, de até R$ 1.099, até 4 seguidos.
// O dono: "os tênis da Nike tão muito exagerados, lembre que o grupo é pra mulheres".
test('catálogo da Awin no grupo de meninas: sem masculino, sem infantil, sem preço exagerado; femininas primeiro', async () => {
  const meninas = { nome: 'Fitness', preferirFeminino: 4 };
  const cfg = { precoMaximo: 400 };
  const p = (nome, precoAtual = 300) => ({ nome, precoAtual });
  assert.equal(motivoForaDoPublico(p('Tênis Nike ZoomX VaporFly 4 Masculino'), meninas, cfg), 'masculino (catálogo da Awin)');
  assert.equal(motivoForaDoPublico(p('Chuteira Futsal Kylian Mbappé Nike Mercurial Superfly 11 Club Infantil'), meninas, cfg), 'infantil (catálogo da Awin)');
  assert.match(motivoForaDoPublico(p('Tênis Nike Zoom VaporFly Next 4 SE Feminino', 1099.99), meninas, cfg), /acima de R\$ 400/);
  assert.equal(motivoForaDoPublico(p('Tênis Nike Court Vision Alta Feminino', 341.99), meninas, cfg), null);
  assert.equal(motivoForaDoPublico(p('Mochila Nike Brasilia'), meninas, cfg), null, 'neutro passa (as femininas vêm antes)');
  assert.equal(motivoForaDoPublico(p('Camiseta Nike Masculina'), { nome: 'Geral' }, cfg), null, 'grupo sem preferência: masculino passa');

  const catalogo = [
    'aw_deep_link,product_name,aw_product_id,search_price,rrp_price,in_stock',
    'https://www.awin1.com/pclick.php?p=1&a=1694399&m=17652,Tênis Nike Air Max Alpha Trainer 6 Masculino,1,199.90,399.90,1',
    'https://www.awin1.com/pclick.php?p=2&a=1694399&m=17652,Mochila Nike Brasilia,2,149.90,299.90,1',
    'https://www.awin1.com/pclick.php?p=3&a=1694399&m=17652,Tênis Nike Revolution 7 Feminino,3,249.90,499.90,1',
    'https://www.awin1.com/pclick.php?p=4&a=1694399&m=17652,Tênis Nike Alphafly 3 Feminino,4,999.99,2499.99,1',
  ].join('\n');
  const fetchImpl = async (url) => new Response(url.includes('/list/') ? LISTA : zlib.gzipSync(catalogo));
  const api = { anunciantes: async () => [{ id: 17652, nome: 'Nike' }] };
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mla-aw-'));
  const r = await buscarProdutosAwin({ grupos: [{ nome: 'Fitness', ativo: true, preferirFeminino: 4 }], api, chave: 'k', pasta, cfg, fetchImpl });
  assert.deepEqual(r.produtos.map((x) => x.id), ['AWF-3', 'AWF-2']);
});

test('catálogo da Awin com calma: no máximo 1 a cada 4 posts e 6 por dia no grupo; o que já estava na fila também é barrado', async () => {
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-aw-')), 'db.json'));
  const grupo = { nome: 'Fitness', jid: '-1', mensagemAdicional: '', preferirFeminino: 4, filtros: { diasSemRepetir: 5 } };
  const add = (id, nome, precoAtual = 250) =>
    s.upsert({ id, grupo: 'Fitness', nome, loja: 'awin', url: `https://www.nike.com.br/${id}`, imagem: 'i', precoAtual, precoOriginal: precoAtual * 2, descontoPct: 50, linkAfiliado: `https://www.awin1.com/pclick.php?p=${id}&a=1694399&m=17652` });
  add('AWF-1', 'Tênis Nike Rival Fly 4 Masculino');
  add('AWF-2', 'Tênis Nike Zoom VaporFly Next 4 SE Feminino', 1099.99);
  const sender = { sendImage: async () => ({ comImagem: true }), sendText: async () => {} };
  assert.equal(await enviarProximo(sender, grupo, s), null, 'só masculino e R$ 1.099 na fila: nenhum sai');
  assert.equal(s.list((p) => p.id === 'AWF-1')[0].status, 'REJEITADO', 'masculino que já estava na fila não sai');
  assert.equal(s.list((p) => p.id === 'AWF-2')[0].status, 'REJEITADO', 'R$ 1.099 não sai');
  add('AWF-3', 'Tênis Nike Court Vision Alta Feminino');
  add('AWF-4', 'Legging Nike One Feminina');
  assert.match((await enviarProximo(sender, grupo, s)).nome, /Feminin/);
  assert.deepEqual(await enviarProximo(sender, grupo, s), { esperando: true }, 'dois do catálogo seguidos, não');

  const agora = Date.parse('2026-10-27T18:00:00Z');
  const cfg = { umACada: 4, maxPorDia: 6 };
  const s2 = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-aw-')), 'db.json'));
  const enviado = (id, minAtras) => {
    s2.upsert({ id, grupo: 'G', nome: id, status: 'PRONTO', loja: 'awin', linkAfiliado: 'x' });
    s2.setStatus(s2.list((p) => p.id === id)[0], 'ENVIADO', { enviadoEm: new Date(agora - minAtras * 60_000).toISOString() });
  };
  enviado('AWF-a', 100);
  enviado('X1', 6);
  enviado('X2', 3);
  assert.equal(awinLiberada(s2, 'G', cfg, 3, agora), true, 'fora dos 3 últimos: libera');
  enviado('X3', 1);
  for (let i = 0; i < 5; i++) enviado(`AWF-${i}x`, 90 - i * 15);
  assert.equal(awinLiberada(s2, 'G', cfg, 3, agora), false, 'já saíram 6 hoje');
  assert.equal(awinLiberada(s2, 'G', { umACada: 4 }, 3, agora), true, 'sem limite por dia');
});
