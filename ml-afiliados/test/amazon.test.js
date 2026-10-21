import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos } from '../src/config.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AmazonAPI, buscarOfertasAmazon, produtoDeItem, RECURSOS } from '../src/amazon.js';
import { montarLegenda } from '../src/caption.js';
import { coletar } from '../src/pipeline.js';
import { Store } from '../src/store.js';

const itemCamel = {
  asin: 'B0TESTE123',
  detailPageURL: 'https://www.amazon.com.br/dp/B0TESTE123?tag=panda-20&linkCode=ogi&th=1&psc=1',
  images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/abc._SL500_.jpg' } } },
  itemInfo: { title: { displayValue: 'Fritadeira Air Fryer 4L  Preta' } },
  customerReviews: { starRating: { value: 4.7 }, count: 1234 },
  offersV2: {
    listings: [
      { isBuyBoxWinner: false, price: { money: { amount: 399.9 } } },
      {
        isBuyBoxWinner: true,
        availability: { type: 'IN_STOCK' },
        merchantInfo: { name: 'Amazon.com.br' },
        dealDetails: { badge: 'Oferta Relâmpago', endTime: '2026-10-10T03:00:00Z' },
        price: { money: { amount: 299.9 }, savingBasis: { money: { amount: 499.9 } }, savings: { percentage: 40 } },
      },
    ],
  },
};

test('produtoDeItem: lê a oferta vencedora (camelCase) e monta o produto com link de afiliado', () => {
  const p = produtoDeItem(itemCamel, { grupo: 'Geral', categoria: 'Amazon: Air fryer', consultadoEm: new Date('2026-10-09T17:32:00Z') });
  assert.equal(p.id, 'AMZ-B0TESTE123');
  assert.equal(p.loja, 'amazon');
  assert.equal(p.nome, 'Fritadeira Air Fryer 4L Preta');
  assert.equal(p.precoAtual, 299.9);
  assert.equal(p.precoOriginal, 499.9);
  assert.equal(p.descontoPct, 40);
  assert.equal(p.nota, 4.7);
  assert.equal(p.fimRelampago, true);
  assert.equal(p.selo, 'Oferta Relâmpago');
  assert.equal(p.vendedor, 'Amazon.com.br');
  assert.match(p.linkAfiliado, /tag=panda-20/);
  assert.equal(p.imagem, 'https://m.media-amazon.com/images/I/abc._SL500_.jpg');
  assert.equal(p.indisponivel, false);
});

test('produtoDeItem: aceita PascalCase, calcula desconto e descarta item sem preço', () => {
  const p = produtoDeItem({
    ASIN: 'B0PASCAL01',
    DetailPageURL: 'https://www.amazon.com.br/dp/B0PASCAL01?tag=x-20',
    ItemInfo: { Title: { DisplayValue: 'Fone Bluetooth' } },
    OffersV2: { Listings: [{ Price: { Money: { Amount: 75 }, SavingBasis: { Money: { Amount: 100 } } }, Availability: { Type: 'IN_STOCK' } }] },
  });
  assert.equal(p.descontoPct, 25);
  assert.equal(p.precoOriginal, 100);
  assert.equal(produtoDeItem({ asin: 'B0SEMPRECO', itemInfo: { title: { displayValue: 'x' } } }), null);
});

function fetchFalso(respostas) {
  const chamadas = [];
  const fn = async (url, opts) => {
    chamadas.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    const r = respostas(url, chamadas.length);
    return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
  fn.chamadas = chamadas;
  return fn;
}

const cfg = { credentialId: 'amzn1.id', credentialSecret: 's3cr3t', partnerTag: 'panda-20', marketplace: 'www.amazon.com.br', tokenUrl: 'https://api.amazon.com/auth/o2/token', apiUrl: 'https://creatorsapi.amazon/catalog/v1' };

test('AmazonAPI: pede o token uma vez (client_credentials) e chama searchItems com marketplace do Brasil', async () => {
  const f = fetchFalso((url) =>
    url.includes('/auth/o2/token')
      ? { status: 200, body: { access_token: 'tok', expires_in: 3600 } }
      : { status: 200, body: { searchResult: { items: [itemCamel] } } }
  );
  const api = new AmazonAPI(cfg, { fetchImpl: f, pausaMs: 0 });
  const itens = await api.buscar({ nome: 'Air fryer', keywords: 'air fryer', searchIndex: 'HomeAndKitchen', paginas: 2 }, { grupo: 'Geral', minSavingPercent: 20 });
  await api.buscar({ keywords: 'fone' }, { grupo: 'Geral' });
  const tokenCalls = f.chamadas.filter((c) => c.url.includes('/auth/o2/token'));
  assert.equal(tokenCalls.length, 1, 'token reaproveitado');
  assert.deepEqual(tokenCalls[0].body, { grant_type: 'client_credentials', client_id: 'amzn1.id', client_secret: 's3cr3t', scope: 'creatorsapi::default' });
  const busca = f.chamadas.find((c) => c.url.endsWith('/searchItems'));
  assert.equal(busca.opts.headers.authorization, 'Bearer tok');
  assert.equal(busca.opts.headers['x-marketplace'], 'www.amazon.com.br');
  assert.equal(busca.body.marketplace, 'www.amazon.com.br');
  assert.equal(busca.body.partnerTag, 'panda-20');
  assert.equal(busca.body.keywords, 'air fryer');
  assert.equal(busca.body.searchIndex, 'HomeAndKitchen');
  assert.equal(busca.body.minSavingPercent, 20);
  assert.deepEqual(busca.body.resources, RECURSOS);
  assert.equal(itens.length, 1, 'parou na 1ª página porque veio menos que itemCount');
  assert.equal(itens[0].categoria, 'Amazon: Air fryer');
});

test('AmazonAPI: 403 vira mensagem clara e interrompe a coleta da Amazon', async () => {
  const f = fetchFalso((url) =>
    url.includes('/auth/o2/token') ? { status: 200, body: { access_token: 'tok' } } : { status: 403, body: { errors: [{ message: 'AccessDenied' }] } }
  );
  const api = new AmazonAPI(cfg, { fetchImpl: f, pausaMs: 0 });
  await assert.rejects(
    buscarOfertasAmazon(api, { ativo: true, grupo: 'Geral', buscas: [{ keywords: 'a' }, { keywords: 'b' }] }),
    /HTTP 403: AccessDenied — a conta precisa de acesso à Creators API/
  );
  assert.equal(f.chamadas.filter((c) => c.url.endsWith('/searchItems')).length, 1);
});

test('buscarOfertasAmazon: desligada ou sem credenciais não chama a Amazon', async () => {
  const f = fetchFalso(() => ({ status: 500, body: {} }));
  assert.match((await buscarOfertasAmazon(new AmazonAPI(cfg, { fetchImpl: f }), { ativo: false, buscas: [] })).motivo, /desligada/);
  assert.match((await buscarOfertasAmazon(new AmazonAPI({ ...cfg, credentialSecret: '' }, { fetchImpl: f }), { ativo: true, buscas: [{}] })).motivo, /faltam/);
  assert.equal(f.chamadas.length, 0);
});

test('coletar: ofertas da Amazon entram na fila já PRONTAS (com link), passando pelos filtros do grupo', async () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'amz-')), 'db.json'));
  const bom = produtoDeItem(itemCamel, { grupo: 'Geral', categoria: 'Amazon: Air fryer' });
  const ruim = { ...bom, id: 'AMZ-B0RUIM', asin: 'B0RUIM', descontoPct: 5, precoOriginal: null };
  const r = await coletar(store, {
    shopee: async () => ({ produtos: [], categorias: {}, motivo: "desligada (teste)" }),
    grupos: loadGrupos().map((g) => (g.nome === 'Geral' ? { ...g, ativo: true, emEspera: false } : g)), // o Geral pode estar pausado no arquivo
    amazon: async () => ({ produtos: [bom, ruim], categorias: { 'Amazon: Air fryer': { encontrados: 2, aceitos: 0 } } }),
    categoriasML: [],
  });
  const fila = store.list((p) => p.loja === 'amazon');
  assert.equal(fila.length, 1);
  assert.equal(fila[0].status, 'PRONTO');
  assert.match(fila[0].linkAfiliado, /tag=panda-20/);
  assert.equal(r.recusas['desconto baixo'], 1);
  assert.deepEqual(r.categorias['Amazon: Air fryer'], { encontrados: 2, aceitos: 1 });
  assert.equal(r.amazonErro, null);
});

test('legenda da Amazon mostra a loja e a hora do preço (exigência da Amazon)', () => {
  const p = produtoDeItem(itemCamel, { grupo: 'Geral', categoria: 'x', consultadoEm: new Date('2026-10-09T17:32:00Z') });
  const txt = montarLegenda(p, { titulo: 'TESTE' });
  assert.match(txt, /^🧡 \*AMAZON\*/);
  assert.match(txt, /🔗 use o link:\nhttps:\/\/www\.amazon\.com\.br\/dp\/B0TESTE123\?tag=panda-20/);
  assert.match(txt, /> _Preço da Amazon às 14:32 — pode mudar_/);
  assert.match(txt, /💰 de R\$ 499,90 por/);
  assert.doesNotMatch(txt, /Mercado Livre/);
});
