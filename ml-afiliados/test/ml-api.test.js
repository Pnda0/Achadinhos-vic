import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { MLApi, buscarMaisVendidosML, escolherAnuncio, montarProduto, MIN_ANUNCIOS } = await import('../src/ml/api.js');
const { motivoVendas } = await import('../src/ml/vendas.js');
const { coletar, motivoPeloNome } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-'));
const json = (status, corpo) => ({ ok: status < 400, status, json: async () => corpo });

/** API falsa: responde como o ML respondeu em 27/10/2026 (lista com PRODUCT, USER_PRODUCT e ITEM; só PRODUCT abre). */
function apiFalsa({ anuncios = 900_000, pedidos = [] } = {}) {
  const respostas = {
    '/oauth/token': json(200, { access_token: 'tok', expires_in: 21600 }),
    '/categories/MLB1263': json(200, { name: 'Cuidados com o Cabelo', total_items_in_this_category: anuncios }),
    '/highlights/MLB/category/MLB1263': json(200, {
      content: [
        { id: 'MLB1', position: 1, type: 'PRODUCT' },
        { id: 'MLBU9', position: 2, type: 'USER_PRODUCT' },
        { id: 'MLB2', position: 3, type: 'PRODUCT' },
        { id: 'MLB3', position: 4, type: 'PRODUCT' },
        { id: 'MLB55', position: 5, type: 'ITEM' },
      ],
    }),
    '/products/MLB1': json(200, { name: "L'Oréal Paris Elseve Óleo Extraordinário 100ml", pictures: [{ id: '617155-MLA118231595864_102026', url: 'https://http2.mlstatic.com/D_NQ_NP_617155-MLA118231595864_102026-F.jpg' }] }),
    '/products/MLB2': json(200, { name: 'Escova Secadora Genérica 1200W', pictures: [{ id: '1-MLA1_1' }] }),
    '/products/MLB3': json(200, { name: 'Shampoo Wella Invigo 1L', pictures: [{ id: '2-MLA2_2' }] }),
    '/products/MLB1/items': json(200, {
      results: [
        { item_id: 'MLB900', price: 30, original_price: 60, condition: 'new' }, // mais barato, mas sem loja oficial
        { item_id: 'MLB901', price: 36.14, original_price: 64.9, condition: 'new', official_store_id: 7, shipping: { free_shipping: true } },
        { item_id: 'MLB902', price: 40, original_price: 64.9, condition: 'new', official_store_id: 8 },
      ],
    }),
    '/products/MLB3/items': json(403, { error: 'forbidden' }),
  };
  return async (url, opts = {}) => {
    const caminho = new URL(url).pathname;
    pedidos.push(caminho);
    if (caminho !== '/oauth/token') assert.equal(opts.headers.authorization, 'Bearer tok');
    return respostas[caminho] || json(404, {});
  };
}

test('API oficial do ML: mais vendidos da categoria → produto no formato do bot, com o anúncio da loja oficial', async () => {
  const pedidos = [];
  const api = new MLApi({ clientId: 'id', clientSecret: 'segredo', dir: tmp(), fetchImpl: apiFalsa({ pedidos }), pausaMs: 0 });
  const cat = { grupo: 'Beleza', nome: 'ML mais vendidos: Cabelo', maisVendidos: 'MLB1263' };
  const f = { soMarcas: true };
  const lista = await buscarMaisVendidosML(cat, { api, antes: (p) => !motivoPeloNome(p, f) });
  assert.equal(lista.length, 1, 'sem marca (escova) e sem anúncio (Wella, 403) ficam de fora; USER_PRODUCT/ITEM nem são pedidos');
  const p = lista[0];
  assert.equal(p.id, 'MLB901');
  assert.equal(p.precoAtual, 36.14);
  assert.equal(p.descontoPct, 44);
  assert.equal(p.lojaOficial, true);
  assert.equal(p.frete, 'Frete grátis');
  assert.equal(p.maisVendidoML, 1);
  assert.equal(p.grupo, 'Beleza');
  assert.match(p.url, /^https:\/\/produto\.mercadolivre\.com\.br\/MLB-901-l-oreal-paris-elseve/);
  assert.match(p.imagem, /D_NQ_NP_2X_617155-MLA118231595864_102026-F\.jpg$/);
  assert.ok(!pedidos.includes('/products/MLB2/items'), 'produto sem marca não custa a consulta de preço');
  assert.ok(!pedidos.some((x) => /MLBU9|MLB55/.test(x)));
  assert.equal(motivoVendas(p), null, 'top 20 da categoria vale como vendas confirmadas');

  // 2ª vez: token e nomes guardados — só a lista e os anúncios são pedidos de novo.
  pedidos.length = 0;
  await buscarMaisVendidosML(cat, { api: new MLApi({ clientId: 'id', clientSecret: 'segredo', dir: api.arqToken.replace(/[\\/][^\\/]+$/, ''), fetchImpl: apiFalsa({ pedidos }), pausaMs: 0 }), antes: (x) => !motivoPeloNome(x, f) });
  assert.deepEqual(pedidos.sort(), ['/highlights/MLB/category/MLB1263', '/products/MLB1/items', '/products/MLB3/items']);
});

test('API oficial do ML: categoria pequena não conta ("top 20" ali não garante vendas); anúncio sem preço antigo não tem desconto', async () => {
  const api = new MLApi({ clientId: 'id', clientSecret: 's', dir: tmp(), fetchImpl: apiFalsa({ anuncios: MIN_ANUNCIOS - 1 }), pausaMs: 0 });
  assert.deepEqual(await buscarMaisVendidosML({ grupo: 'Beleza', nome: 'x', maisVendidos: 'MLB1263' }, { api }), []);
  assert.equal(escolherAnuncio([{ item_id: 'A', price: 10, condition: 'used' }]), null);
  const p = montarProduto({ nome: 'Creme Nivea', imagem: 'https://img' }, { item_id: 'MLB5', price: 20, original_price: 20 });
  assert.equal(p.precoOriginal, null);
  assert.equal(p.descontoPct, null);
  assert.equal(motivoVendas({ loja: 'ml', vendidos: null }), 'sem dado de vendas', 'sem a marca de mais vendido, a regra de sempre');
});

test('API oficial do ML na coleta: roda mesmo com as páginas de ofertas em pausa, passa pelos filtros do grupo', async () => {
  const s = new Store(path.join(tmp(), 'db.json'));
  s.data.pausaML = new Date(Date.now() + 3_600_000).toISOString();
  const desligado = async () => ({ produtos: [], categorias: {}, motivo: 'desligada' });
  const raspadas = [];
  const base = { grupo: 'Beleza', imagem: 'https://img/x.jpg', maisVendidoML: 2, vendidos: null };
  const r = await coletar(s, {
    grupos: [{ nome: 'Beleza', ativo: true, filtros: { descontoMinimo: 20, diasSemRepetir: 5 } }],
    categoriasML: [
      { grupo: 'Beleza', nome: 'Ofertas', url: 'https://ml/ofertas', paginas: 1, ativo: true },
      { grupo: 'Beleza', nome: 'ML mais vendidos: Pele', maisVendidos: 'MLB199407', ativo: true },
    ],
    raspar: async (c) => (raspadas.push(c.nome), []),
    maisVendidosML: async (cat) => [
      { ...base, id: 'MLB10', nome: 'Protetor Solar La Roche-Posay', url: 'https://p/10', precoAtual: 77, descontoPct: 30, categoria: cat.nome },
      { ...base, id: 'MLB11', nome: 'Creme Nivea', url: 'https://p/11', precoAtual: 20, descontoPct: 5, categoria: cat.nome },
    ],
    esperar: async () => {},
    shopee: desligado, amazon: desligado, awin: desligado, awinProdutos: desligado,
  });
  assert.deepEqual(raspadas, [], 'páginas de ofertas em pausa');
  assert.equal(r.novos, 1);
  assert.equal(r.recusas['desconto baixo'], 1);
  assert.equal(s.list((p) => p.id === 'MLB10')[0].status, 'PENDENTE', 'vai para o gerador de links como as outras do ML');
});

test('Perfumes: mais vendido do ML com desconto abaixo de 20% entra como reserva e só sai quando não há outra oferta', async () => {
  const s = new Store(path.join(tmp(), 'db.json'));
  const desligado = async () => ({ produtos: [], categorias: {}, motivo: 'desligada' });
  const base = { imagem: 'https://img/x.jpg', maisVendidoML: 3, vendidos: null };
  const filtros = { descontoMinimo: 20, diasSemRepetir: 5 };
  const r = await coletar(s, {
    grupos: [
      { nome: 'Perfumes', ativo: true, filtros, reservaDescontoMinimo: 10 },
      { nome: 'Beleza', ativo: true, filtros }, // sem reserva: a regra de sempre
    ],
    categoriasML: [
      { grupo: 'Perfumes', nome: 'ML mais vendidos: Perfumes', maisVendidos: 'MLB6284', ativo: true },
      { grupo: 'Beleza', nome: 'ML mais vendidos: Pele', maisVendidos: 'MLB199407', ativo: true },
    ],
    maisVendidosML: async (cat) => [
      { ...base, grupo: cat.grupo, id: `${cat.grupo}-A`, nome: 'Floratta O Boticário', url: `https://p/${cat.grupo}A`, precoAtual: 108, descontoPct: 15 },
      { ...base, grupo: cat.grupo, id: `${cat.grupo}-B`, nome: 'Humor Natura', url: `https://p/${cat.grupo}B`, precoAtual: 65, descontoPct: 5 },
    ],
    esperar: async () => {},
    shopee: desligado, amazon: desligado, awin: desligado, awinProdutos: desligado,
  });
  assert.equal(r.novos, 1, 'só o Floratta (15%) do Perfumes; 5% não, e no Beleza 15% também não');
  const floratta = s.list((p) => p.id === 'Perfumes-A')[0];
  assert.equal(floratta.reserva, true);
  s.setLink('https://p/PerfumesA', 'https://meli.la/a');

  // Com outra oferta na fila, a reserva espera; sozinha, sai.
  s.upsert({ id: 'SH1', grupo: 'Perfumes', loja: 'shopee', nome: 'Yara Lattafa', url: 'https://s/1', linkAfiliado: 'https://s.shopee.com.br/x', precoAtual: 180, descontoPct: 40 });
  assert.equal(s.proximo('Perfumes').id, 'SH1');
  assert.equal(s.proximo('Perfumes', { aceitar: (p) => p.loja !== 'shopee' }).id, 'Perfumes-A', 'Shopee esperando a vez: a reserva preenche');
  s.setStatus(s.list((p) => p.id === 'SH1')[0], 'ENVIADO', { enviadoEm: new Date().toISOString() });
  assert.equal(s.proximo('Perfumes').id, 'Perfumes-A');
});

test('mesmoProduto: nome do post x nome do catálogo (casos reais de 29/10/2026)', async () => {
  const { mesmoProduto } = await import('../src/ml/api.js');
  const sim = [
    ['Asad Elixir Lattafa 100 ml', 'Lattafa Asad Elixir 100 ML'],
    ['Mochila Adidas Esportiva Defender', 'Mochila Esportiva Defender adidas'],
    ['Hiper Mass 1kg Growth Supplements Chocolate', 'Hiper Mass 1kg Growth Supplements - Sabor Chocolate'],
    ['Eudora Pulse Masculino Perfume Colônia 100ml', 'Eudora Pulse Colônia 100ml'],
  ];
  const nao = [
    ['Perfume Natura K Max 100ml', 'Perfume Natura Kaiak Pulso Masculino 100ml'],
    ['Perfume Árabe Armaf Club de Nuit Sillage EDP 105ml', 'Perfume Árabe Club De Nuit Intense Da Armaf Edt 105ml'],
    ['Natura Essencial Exclusivo 100ml', 'Refil Deo Parfum Natura Essencial Exclusivo Masculino 100ml'],
    ['Lattafa Asad 100 ml', 'Kit Perfume lattafa Asad 100ml + Desodorante'],
    ['Lattafa Asad 100 ml', 'Lattafa Asad Elixir 100 ML'],
    ['Eudora Siage Cica-therapy (Shampoo+ Máscara)', 'Eudora Siàge Cica-Therapy Shampoo Condicionador'],
    ['Lattafa Yara 100ml', 'Lattafa Yara 50ml'],
    ['O Boticário Floratta Red Passion Edp 75ml', 'Presente O Boticário Floratta Red Passion'],
  ];
  for (const [a, b] of sim) assert.equal(mesmoProduto(a, b), true, `${a} = ${b}`);
  for (const [a, b] of nao) assert.equal(mesmoProduto(a, b), false, `${a} ≠ ${b}`);
});
