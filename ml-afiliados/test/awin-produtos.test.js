import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { lerLinhaCsv, produtoDoCatalogo, listarCatalogos, buscarProdutosAwin, chaveDosCatalogos, urlDoCatalogo } = await import('../src/awin-produtos.js');
const { motivoLinkInvalido } = await import('../src/pipeline.js');

const LISTA = [
  '"Advertiser ID","Advertiser Name","Primary Region","Membership Status","Feed ID","Feed Name","Language","Vertical","Last Imported","Last Checked","No of products","URL"',
  '17652,"Nike","BR","active",9001,"Nike BR","pt","Retail","","","3","https://x"',
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
  await assert.rejects(listarCatalogos('ruim', { fetchImpl: async () => new Response('{}', { status: 401 }) }), /recusou a chave/);
});
