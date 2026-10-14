import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lerVendas, motivoVendas } from '../src/ml/vendas.js';
import { motivoRecusa } from '../src/pipeline.js';
import { productFromCard, parseOffersPage } from '../src/ml/parser.js';

const ml = (vendidos) => ({ id: 'MLB1', nome: 'Produto', vendidos });

test('vendas: só passa com MAIS de 50 confirmadas', () => {
  assert.equal(motivoVendas(ml(10)), 'até 50 vendas');
  assert.equal(motivoVendas(ml(50)), 'até 50 vendas'); // exatamente 50: não
  assert.equal(motivoVendas(ml(51)), null);
  assert.equal(motivoVendas(ml('10 vendidos')), 'até 50 vendas');
  assert.equal(motivoVendas(ml('50 vendidos')), 'até 50 vendas');
  assert.equal(motivoVendas(ml('51 vendidos')), null);
  assert.equal(motivoVendas(ml('+25 vendidos')), 'até 50 vendas'); // mais de 25: pode ser 26
  assert.equal(motivoVendas(ml('+50 vendidos')), null); // o card diz "Mais de 50 produtos vendidos"
  assert.equal(motivoVendas(ml('+100 vendidos')), null);
});

test('vendas: sem informação ou ilegível NÃO entra (e não vira zero)', () => {
  assert.equal(motivoVendas(ml(null)), 'sem dado de vendas');
  assert.equal(motivoVendas(ml(undefined)), 'sem dado de vendas');
  assert.equal(motivoVendas(ml('')), 'sem dado de vendas');
  assert.equal(motivoVendas(ml('muitos vendidos')), 'vendas ilegíveis');
  assert.equal(motivoVendas(ml('12,5 vendidos')), 'vendas ilegíveis');
  assert.equal(motivoVendas(ml(-3)), 'vendas ilegíveis');
  assert.equal(motivoVendas(ml(50.5)), 'vendas ilegíveis');
  assert.equal(lerVendas('Frete grátis'), null);
});

test('vendas: lê todos os formatos do rótulo do Mercado Livre', () => {
  const casos = {
    '+50 vendidos': 51,
    '| +100 vendidos': 101,
    '+1mil vendidos': 1001,
    '+1 mil vendidos': 1001,
    '+10MIL VENDIDOS': 10001,
    '+1,5mil vendidos': 1501,
    '+1M vendidos': 1_000_001,
    '+1 milhão vendidos': 1_000_001,
    '1.000 vendidos': 1000,
    '37 vendidos': 37,
    '1 vendido': 1,
    'Mais de 50 produtos vendidos': 51,
    'Mais de 50mil produtos vendidos': 50_001,
    '+50 vendidos': 51, // espaço "duro" (NBSP) do HTML do ML
    '+5 mil vendidos': 5001,
  };
  for (const [rotulo, minimo] of Object.entries(casos)) assert.equal(lerVendas(rotulo)?.minimo, minimo, rotulo);
});

test('vendas: a regra vale só para o Mercado Livre e é aplicada ANTES de entrar na fila (motivoRecusa)', () => {
  const f = { descontoMinimo: 20 };
  assert.equal(motivoRecusa({ ...ml(null), descontoPct: 40 }, f), 'sem dado de vendas');
  assert.equal(motivoRecusa({ ...ml('+100 vendidos'), descontoPct: 40 }, f), null);
  assert.equal(motivoRecusa({ ...ml(null), loja: 'amazon', descontoPct: 40 }, f), null); // Amazon não tem rótulo de vendas
  assert.equal(motivoRecusa({ ...ml(null), loja: 'awin', descontoPct: 40 }, f), null);
  assert.equal(motivoRecusa({ ...ml(null), descontoPct: 40 }, f, null, { exigirVendas: false }), null); // caixa de entrada do dono
  assert.equal(motivoRecusa({ ...ml('+50 vendidos'), descontoPct: 40 }, { ...f, vendasMinimas: 99 }), 'até 99 vendas'); // limite configurável
});

test('vendas: o número vem do card real do ML (fixture de out/2026)', () => {
  const { produtos } = parseOffersPage(fs.readFileSync(new URL('./fixtures/ofertas-json.html', import.meta.url), 'utf8'));
  const comRotulo = produtos.filter((p) => p.vendidos);
  assert.ok(comRotulo.length > 0);
  for (const p of comRotulo) assert.ok(lerVendas(p.vendidos), `rótulo legível: ${p.vendidos}`);
  assert.equal(productFromCard({ metadata: { id: 'MLB9', url: 'https://x/MLB-9' }, components: [{ type: 'title', title: { text: 'T' } }] }).vendidos, null);
});

test('vendas: produto SEM avaliação traz o rótulo de vendas na 1ª posição (visto em out/2026) — e a nota não vira 1000', () => {
  const card = (values) => ({
    metadata: { id: 'MLB9', url: 'https://x/MLB-9' },
    components: [{ type: 'title', title: { text: 'Perfume' } }, { type: 'review_compacted', review_compacted: { values } }],
  });
  const so = productFromCard(card([{ type: 'label', label: { text: '+1000 vendidos' } }]));
  assert.equal(so.vendidos, '+1000 vendidos');
  assert.equal(so.nota, null);
  const ambos = productFromCard(card([{ type: 'icon', icon: { icon_id: 'star' } }, { type: 'label', label: { text: '4.7' } }, { type: 'label', label: { text: '| +50 vendidos' } }]));
  assert.deepEqual({ nota: ambos.nota, vendidos: ambos.vendidos }, { nota: 4.7, vendidos: '+50 vendidos' });
  // HTML de reserva (poly-card): com e sem "+"
  const { produtos } = parseOffersPage(fs.readFileSync(new URL('./fixtures/ofertas-polycard.html', import.meta.url), 'utf8'));
  assert.ok(produtos.some((p) => p.vendidos === '+50mil vendidos'));
});
