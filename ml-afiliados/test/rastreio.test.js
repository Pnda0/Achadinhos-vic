import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoDoLink, comLinkRastreado, ligado, paraWhatsApp } from '../src/rastreio.js';
import { dinheiroShopee, pedidosDaConversao, situacaoShopee } from '../src/analytics/ganhos.js';
import { produtosComLink } from '../src/analytics/relatorio.js';
import { htmlDoPainel } from '../src/analytics/pagina.js';

const LIGADO = { RASTREIO_CLIQUES: 'true' };

test('rastreio: só os links curtos do ML, da Shopee e da Awin passam pelo site; Amazon e link longo vão direto', () => {
  assert.equal(codigoDoLink('https://meli.la/2AbCdE'), 'm2AbCdE');
  assert.equal(codigoDoLink('https://s.shopee.com.br/7Kx9'), 's7Kx9');
  assert.equal(codigoDoLink('https://tidd.ly/3xYz'), 'a3xYz');
  assert.equal(codigoDoLink('https://www.mercadolivre.com.br/p/MLB1?matt_word=pndaaaa'), null);
  assert.equal(codigoDoLink('https://meli.la/2AbCdE?x=1'), null);
  assert.equal(codigoDoLink('http://meli.la/2AbCdE'), null);
  assert.equal(codigoDoLink('lixo'), null);

  const p = { id: 'MLB1', loja: 'ml', nome: 'Perfume', linkAfiliado: 'https://meli.la/2AbCdE' };
  const r = comLinkRastreado(p, 'Perfumes', { env: LIGADO });
  assert.equal(r.linkAfiliado, 'https://achadinhos-vic.pages.dev/p/tpm2AbCdE');
  assert.equal(r.codigoClique, 'm2AbCdE');
  assert.equal(p.linkAfiliado, 'https://meli.la/2AbCdE', 'a oferta da fila não muda');
  assert.equal(comLinkRastreado(p, 'Grupo Novo', { env: LIGADO }).linkAfiliado.endsWith('/p/txm2AbCdE'), true);

  const amazon = { loja: 'amazon', linkAfiliado: 'https://www.amazon.com.br/dp/B0?tag=x-20' };
  assert.equal(comLinkRastreado(amazon, 'Beleza', { env: LIGADO }), amazon);
  assert.equal(comLinkRastreado(p, 'Beleza', { env: { RASTREIO_CLIQUES: 'false' } }), p);

  const pronto = comLinkRastreado({ ...p, textoPronto: 'Olha!\nhttps://meli.la/2AbCdE' }, 'Beleza', { env: LIGADO });
  assert.equal(pronto.textoPronto, 'Olha!\nhttps://achadinhos-vic.pages.dev/p/tbm2AbCdE');
  assert.equal(paraWhatsApp('🔗 https://achadinhos-vic.pages.dev/p/tbm2AbCdE'), '🔗 https://achadinhos-vic.pages.dev/p/wbm2AbCdE');
  assert.equal(ligado({}), true);
  assert.equal(ligado({ NODE_TEST_CONTEXT: 'child' }), false);
});

test('ganhos da Shopee: pedidos por situação, canceladas fora das vendas, produtos que mais renderam', () => {
  assert.deepEqual(['PENDING', 'UNPAID', 'COMPLETED', 'CANCELLED', 'INVALID'].map(situacaoShopee), ['pendente', 'pendente', 'concluido', 'cancelado', 'cancelado']);
  const conv = (id, ts, status, itens, total) => ({ conversionId: id, purchaseTime: ts, totalCommission: total, orders: [{ orderId: 'o' + id, orderStatus: status, items: itens }] });
  const ts = Math.floor(Date.parse('2026-11-02T15:00:00Z') / 1000);
  const pedidos = Object.fromEntries(
    [
      conv(1, ts, 'COMPLETED', [{ itemId: 9, itemName: 'Sérum', qty: 2, itemTotalCommission: '3.50' }]),
      conv(2, ts, 'PENDING', [{ itemId: 9, itemName: 'Sérum', qty: 1, itemTotalCommission: '1.75' }]),
      conv(3, ts, 'CANCELLED', [{ itemId: 8, itemName: 'Batom', qty: 1, itemTotalCommission: '2' }]),
      conv(4, ts, 'PENDING', [], '0.80'),
    ].flatMap((c) => pedidosDaConversao(c, 'America/Sao_Paulo').map(({ chave, ...p }) => [chave, p]))
  );
  assert.equal(pedidos['1:o1'].dia, '2026-11-02');
  assert.equal(pedidos['4:o4'].comissao, 0.8, 'sem item: a comissão da conversão');
  const t = dinheiroShopee({ pedidos }, ['2026-11-02']);
  assert.deepEqual([t.pedidos, t.pendente, t.concluido, t.cancelado], [3, 2.55, 3.5, 2]);
  assert.deepEqual(t.produtos[0], { nome: 'Sérum', vendas: 3, comissao: 5.25 });
  assert.equal(dinheiroShopee({ pedidos }, ['2026-10-01']), null, 'período sem pedido e sem leitura: sem dados');
});

test('painel: produtos com link ligados aos cliques; página com todas as abas e JS que compila', () => {
  const agora = new Date('2026-11-03T15:00:00Z');
  const ev = [
    { t: '2026-11-03T12:00:00Z', tipo: 'publicado', grupo: 'Beleza', codigo: 'm2AbCdE', nome: 'Sérum', loja: 'ml', preco: 50, descontoPct: 30 },
    { t: '2026-11-03T13:00:00Z', tipo: 'publicado', grupo: 'Beleza', codigo: 'm2AbCdE', nome: 'Sérum', loja: 'ml', preco: 45, descontoPct: 35 },
    { t: '2026-11-03T12:00:00Z', tipo: 'publicado', grupo: 'Beleza', nome: 'Sem código' },
    { t: '2026-09-01T12:00:00Z', tipo: 'publicado', grupo: 'Beleza', codigo: 'mVELHO', nome: 'Antigo' },
  ];
  assert.deepEqual(produtosComLink(ev, agora), [{ c: 'm2AbCdE', g: 'Beleza', n: 'Sérum', l: 'ml', p: 45, d: 35, dia: '2026-11-03' }]);
  const html = htmlDoPainel({ hora: '03/11, 12:00', periodos: { '7d': { dias: ['2026-11-03'] } }, analytics: { '7d': { nGrupos: 1 } }, produtos: [], letras: { b: 'Beleza' } });
  const js = html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new Function(js), 'o JS da página compila');
});
