import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeCookies, extractCsrfToken, MLAffiliate } from '../src/ml/affiliate.js';
import { montarLegenda, nomeCurto } from '../src/caption.js';
import { motivoRecusa } from '../src/pipeline.js';
import { Store } from '../src/store.js';
import { formatBRL } from '../src/util.js';

const produto = {
  id: 'MLB1', grupo: 'Geral', nome: 'Tênis Masculino Feminino Kappa Park 2.0 Original Preto',
  url: 'https://produto.mercadolivre.com.br/MLB-1-x', imagem: 'https://img/x.jpg',
  precoAtual: 69.34, precoOriginal: 169.99, descontoPct: 59, precoObs: 'no Pix',
  cupom: 'R$ 15 OFF com Cupom', frete: 'Frete grátis', full: true, nota: 4.7, vendidos: '+250mil vendidos',
  fimRelampago: '2026-10-02T03:00:00Z', linkAfiliado: 'https://meli.la/abc',
};

test('formatBRL', () => {
  assert.equal(formatBRL(1234.5), 'R$ 1.234,50');
  assert.equal(formatBRL(69), 'R$ 69');
  assert.equal(formatBRL(null), null);
});

test('mergeCookies: atualiza, adiciona e remove expirados', () => {
  const r = mergeCookies('a=1; ssid=velho; x=9', [
    'ssid=novo; Path=/; HttpOnly',
    'b=2; Path=/',
    'x=; expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]);
  assert.equal(r, 'a=1; ssid=novo; b=2');
});

test('extractCsrfToken', () => {
  assert.equal(extractCsrfToken('<meta name="csrf-token" content="AbCdEfGhIjKlMnOpQrSt">'), 'AbCdEfGhIjKlMnOpQrSt');
  assert.equal(extractCsrfToken('{"csrfToken":"CRoUbkB5-udAuzRwZkidqm7yW9Om"}'), 'CRoUbkB5-udAuzRwZkidqm7yW9Om');
  assert.equal(extractCsrfToken('<html>nada</html>'), null);
});

test('createLinks envia tag/csrf/cookies e lê short_url', async () => {
  let req;
  const fakeFetch = async (url, opts) => {
    req = { url, opts };
    return new Response(JSON.stringify({ urls: [{ origin_url: 'https://p/1', short_url: 'https://meli.la/1' }] }), { status: 200 });
  };
  const aff = new MLAffiliate({ tag: 'minhatag', cookies: 'ssid=1', csrfToken: 'tok', fetchImpl: fakeFetch });
  const m = await aff.createLinks(['https://p/1']);
  assert.equal(m.get('https://p/1'), 'https://meli.la/1');
  assert.match(req.url, /affiliates\/createLink$/);
  assert.deepEqual(JSON.parse(req.opts.body), { urls: ['https://p/1'], tag: 'minhatag' });
  assert.equal(req.opts.headers['x-csrf-token'], 'tok');
  assert.equal(req.opts.headers.cookie, 'ssid=1');
});

test('createLinks: erro 403 vira mensagem clara', async () => {
  const aff = new MLAffiliate({ tag: 't', cookies: 'c=1', fetchImpl: async () => new Response('forbidden', { status: 403 }) });
  await assert.rejects(aff.createLinks(['x']), /cookies expirados/);
});

test('legenda tem título, preço riscado, cupom, frete, link e mensagem adicional', () => {
  const l = montarLegenda(produto, { titulo: 'pisante barato 👟', mensagemAdicional: '🔗 Convide um amigo' });
  assert.match(l, /^\*PISANTE BARATO 👟\*/);
  assert.match(l, /~De R\$ 169,99~/);
  assert.match(l, /\*Por R\$ 69,34\* no Pix \(59% OFF\)/);
  assert.match(l, /🎟️ R\$ 15 OFF com cupom/);
  assert.match(l, /🚚 Frete grátis ⚡FULL/);
  assert.match(l, /https:\/\/meli\.la\/abc/);
  assert.match(l, /Convide um amigo$/);
  assert.equal(nomeCurto(produto.nome), 'Tênis Masculino Feminino Kappa Park 2.0');
});

test('filtros dos grupos', () => {
  const f = { descontoMinimo: 20, precoMinimo: 15, precoMaximo: 5000, notaMinima: 4, palavrasBloqueadas: ['usado'], diasSemRepetir: 5 };
  assert.equal(motivoRecusa(produto, f), null);
  assert.equal(motivoRecusa({ ...produto, descontoPct: 10 }, f), 'desconto baixo');
  assert.equal(motivoRecusa({ ...produto, precoAtual: 9000 }, f), 'preço alto');
  assert.equal(motivoRecusa({ ...produto, nota: 3.2 }, f), 'nota baixa');
  assert.equal(motivoRecusa({ ...produto, nota: null }, f), null);
  assert.equal(motivoRecusa({ ...produto, nome: 'Celular USADO' }, f), 'palavra bloqueada');
});

test('Store: fila PENDENTE -> PRONTO -> ENVIADO e não repete', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json');
  const s = new Store(file);
  const { linkAfiliado, ...semLink } = produto;
  assert.equal(s.upsert(semLink), true);
  assert.equal(s.pendentesDeLink().length, 1);
  s.setLink(produto.url, 'https://meli.la/abc');
  const p = s.proximo('Geral');
  assert.equal(p.linkAfiliado, 'https://meli.la/abc');
  s.setStatus(p, 'ENVIADO');
  s.save();
  const s2 = new Store(file);
  assert.equal(s2.proximo('Geral'), null);
  assert.equal(s2.enviadoRecentemente('MLB1', 'Geral', 5), true);
  assert.equal(motivoRecusa(produto, { diasSemRepetir: 5 }, s2), 'enviado recentemente');
  s2.limparDia();
  assert.equal(s2.list().length, 0);
  assert.equal(s2.enviadoRecentemente('MLB1', 'Geral', 5), true);
});

test('filaDeOutroDia: fila montada ontem (bot desligado na virada) é reconhecida', async () => {
  const { filaDeOutroDia } = await import('../src/pipeline.js');
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  assert.equal(filaDeOutroDia(s), false); // fila vazia
  s.upsert(produto);
  assert.equal(filaDeOutroDia(s), false); // coletado agora
  s.list()[0].coletadoEm = new Date(Date.now() - 30 * 3_600_000).toISOString();
  assert.equal(filaDeOutroDia(s), true);
  s.setStatus(s.list()[0], 'ENVIADO');
  assert.equal(filaDeOutroDia(s), false); // o que já saiu não conta
});

test('Store.reabrirErros devolve para a fila só quem tem link', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json');
  const s = new Store(file);
  const { linkAfiliado, ...semLink } = produto;
  s.upsert(semLink);
  s.upsert({ ...semLink, id: 'MLB2', url: 'https://p/2' });
  s.setLink(produto.url, 'https://meli.la/abc');
  for (const p of s.list()) s.setStatus(p, 'ERRO', { erro: 'falhou' });
  assert.equal(s.reabrirErros(), 1);
  assert.equal(s.proximo('Geral').id, 'MLB1');
  assert.equal(s.list((p) => p.status === 'ERRO').length, 1);
});
