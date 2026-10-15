import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { Shopee, credenciaisShopee, extrairLinksShopee, idsDoLinkShopee, urlDoProdutoShopee } = await import('../src/shopee.js');
const { Espelho } = await import('../src/espelho.js');
const { Store } = await import('../src/store.js');
const { motivoLinkInvalido } = await import('../src/pipeline.js');

const tmpStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));

test('Shopee: credenciais do .env, links e ids do produto', () => {
  assert.deepEqual(credenciaisShopee({ SHOPEE_APP_ID: ' 123 ', SHOPEE_SECRET: 'abc' }), { appId: '123', secret: 'abc' });
  assert.deepEqual(credenciaisShopee({ SHOPEE_APPID: '9', SHOPEE_API_KEY: 'k' }), { appId: '9', secret: 'k' });
  assert.equal(new Shopee({ appId: '', secret: 'x' }).ligada(), false);

  const texto = 'Olha https://s.shopee.com.br/AbC123). e https://meli.la/x e https://shopee.com.br/Vestido-Midi-i.111.222?sp_atk=1';
  assert.deepEqual(extrairLinksShopee([], texto), ['https://s.shopee.com.br/AbC123', 'https://shopee.com.br/Vestido-Midi-i.111.222?sp_atk=1']);
  assert.deepEqual(idsDoLinkShopee('https://shopee.com.br/Vestido-Midi-i.111.222?sp_atk=1'), { shopId: '111', itemId: '222' });
  assert.deepEqual(idsDoLinkShopee('https://shopee.com.br/product/333/444'), { shopId: '333', itemId: '444' });
  assert.equal(idsDoLinkShopee('https://s.shopee.com.br/AbC123'), null);
  assert.equal(idsDoLinkShopee('https://outra.com/x-i.1.2'), null);
  assert.equal(urlDoProdutoShopee({ shopId: '1', itemId: '2' }), 'https://shopee.com.br/product/1/2');
});

test('Shopee: chamada assinada (SHA256 de AppID + hora + corpo + Secret) e link curto do dono', async () => {
  const chamadas = [];
  const fetchImpl = async (url, op) => {
    chamadas.push({ url, op });
    return new Response(JSON.stringify({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/MEU1' } } }), { status: 200 });
  };
  const api = new Shopee({ appId: '123', secret: 'segredo', fetchImpl, agora: () => 1_700_000_000_000 });
  assert.equal(await api.gerarLink('https://shopee.com.br/product/1/2', ['telegram', 'Geral']), 'https://s.shopee.com.br/MEU1');
  const { url, op } = chamadas[0];
  assert.equal(url, 'https://open-api.affiliate.shopee.com.br/graphql');
  const assinatura = crypto.createHash('sha256').update(`1231700000000${op.body}segredo`).digest('hex');
  assert.equal(op.headers.authorization, `SHA256 Credential=123, Timestamp=1700000000, Signature=${assinatura}`);
  assert.match(JSON.parse(op.body).query, /generateShortLink\(input: \{ originUrl: "https:\/\/shopee\.com\.br\/product\/1\/2", subIds: \["telegram","Geral"\] \}\)/);

  const ruim = new Shopee({ appId: '1', secret: '2', fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }), { status: 200 }) });
  await assert.rejects(ruim.gerarLink('https://shopee.com.br/product/1/2'), /Invalid Signature \(10020\)/);
});

test('Shopee: link curto é seguido só pelos redirecionamentos até a página do produto (e não abre de novo)', async () => {
  const abertos = [];
  const fetchImpl = async (url) => {
    abertos.push(url);
    if (url === 'https://s.shopee.com.br/AbC123') return new Response(null, { status: 302, headers: { location: 'https://shopee.com.br/universal-link/x?redir=1' } });
    return new Response(null, { status: 301, headers: { location: '/Batom-Ruby-Rose-i.55.66?utm=outro' } });
  };
  const api = new Shopee({ appId: '1', secret: '2', fetchImpl });
  assert.deepEqual(await api.resolver('https://s.shopee.com.br/AbC123'), { shopId: '55', itemId: '66' });
  assert.deepEqual(await api.resolver('https://s.shopee.com.br/AbC123'), { shopId: '55', itemId: '66' });
  assert.equal(abertos.length, 2);
  // link de fora da Shopee não é seguido
  assert.equal(await api.resolver('https://encurtador.com/x'), null);
  assert.equal(abertos.length, 2);
});

test('canal com "copiarTexto": post da Shopee sai igual ao do canal, com o link da Shopee do dono', async () => {
  const agora = 1_800_000_000_000;
  const texto = '💄 Batom Ruby Rose Matte\n💰 Por R$ 12,90\n👉 https://s.shopee.com.br/AbC123\nVia @outrocanal';
  const msg = { id: 'tgc-x/1', jid: 'canal:x', t: agora / 1000 - 60, tipo: 'image', texto, textoVisivel: texto, links: ['https://s.shopee.com.br/AbC123'], foto: 'https://cdn.telesco.pe/file/batom.jpg' };
  const gerados = [];
  const shopee = {
    ligada: () => true,
    resolver: async (u) => (u === 'https://s.shopee.com.br/AbC123' ? { shopId: '55', itemId: '66' } : null),
    produto: async () => ({ nome: 'Batom Líquido Ruby Rose Matte Feminino', precoAtual: 12.9, imagem: 'https://cf.shopee.com.br/file/66' }),
    gerarLink: async (url, sub) => (gerados.push([url, sub]), 'https://s.shopee.com.br/MEU1'),
  };
  const store = tmpStore();
  const espelho = new Espelho({
    sender: { lerMensagens: async () => [msg] },
    store,
    affiliate: { refresh: async () => {}, createLinks: async () => new Map() },
    fontes: [{ nome: '@x', nomeWhats: '@x', jid: 'canal:x', destino: 'Geral', copiarTexto: true, exigirVendas: false, destinos: [{ grupo: 'Geral', palavras: null }] }],
    grupos: [{ nome: 'Geral', filtros: { descontoMinimo: 20, diasSemRepetir: 5 } }],
    cfg: { pausaEntreConsultasSeg: 0 },
    agora: () => agora,
    esperar: async () => {},
    shopee,
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  const [p] = store.list();
  assert.equal(p.id, 'SHP-66');
  assert.equal(p.loja, 'shopee');
  assert.equal(p.imagem, 'https://cdn.telesco.pe/file/batom.jpg');
  assert.equal(p.textoPronto, '💄 Batom Ruby Rose Matte\n💰 Por R$ 12,90\n👉 https://s.shopee.com.br/MEU1');
  assert.equal(p.linkAfiliado, 'https://s.shopee.com.br/MEU1');
  assert.deepEqual(gerados, [['https://shopee.com.br/product/55/66', ['telegram', 'Geral']]]);
  assert.equal(motivoLinkInvalido(p), null);
  assert.equal(motivoLinkInvalido({ ...p, linkAfiliado: 'https://shopee.com.br/product/55/66' }), 'link da Shopee sem afiliado');

  // sem a Shopee ligada, o mesmo post não entra (não dá para trocar o link)
  const sem = new Espelho({ sender: { lerMensagens: async () => [{ ...msg, id: 'tgc-x/2' }] }, store: tmpStore(), affiliate: {}, fontes: [{ nome: '@x', jid: 'canal:x', destino: 'Geral', copiarTexto: true }], grupos: [{ nome: 'Geral', filtros: {} }], agora: () => agora, esperar: async () => {} });
  assert.deepEqual((await sem.tick()).ignoradas, { 'sem link do ML/Amazon': 1 });
});
