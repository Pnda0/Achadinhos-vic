import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cortar, destaquesDoDia, resumoSemanal, LIMITE_TELEGRAM } from '../src/analytics/destaques.js';
import { Avisos } from '../src/avisos.js';

const fonte = (publicadas, naFila, recusadas) => ({ publicadas, naFila, recusadas, recusas: {}, barradas: 0, barragens: {}, parteDaFila: null, aproveitamento: null, soRecusa: false });
const PAINEL = {
  painelML: 'https://www.mercadolivre.com.br/afiliados',
  membros: { Fitness: { atual: 120, dia: 3, semana: 15, inicio: 100, desde: '2026-10-01' }, Beleza: { atual: 80, dia: 0, semana: -2, inicio: 70, desde: '2026-10-01' } },
  periodos: {
    hoje: { grupos: { Fitness: { publicadas: 40, filaVazia: 3, fontes: {} }, Beleza: { publicadas: 30, filaVazia: 0, fontes: {} } }, funil: {}, awin: null },
    '7d': {
      grupos: {
        Fitness: { publicadas: 280, filaVazia: 5, fontes: { 'Mercado Livre: Suplementos': fonte(200, 300, 400), 'Mercado Livre: Joias e Relógios': fonte(0, 0, 350) } },
        Beleza: { publicadas: 210, filaVazia: 0, fontes: { 'Mercado Livre: Beleza': fonte(210, 260, 100) } },
      },
      funil: { '@promobigodeperfumes': { lidas: 90, comLink: 88, aceitas: 7, motivos: { 'limite por hora': 60 } } },
      categoriasParadas: ['Joias e Relógios'],
      awin: { cliques: 42, pendentes: { vendas: 2, comissao: 18.4 }, aprovadas: { vendas: 1, comissao: 6 }, recusadas: { vendas: 0, comissao: 0 } },
    },
  },
};

test('destaques do dia: 3 a 5 linhas — melhor e pior fonte, membros, fila vazia, Awin pendente ≠ aprovado; link do painel', () => {
  const l = destaquesDoDia(PAINEL, { url: 'https://achadinhos-vic-painel.pages.dev' });
  assert.ok(l.length >= 4 && l.length <= 6);
  assert.match(l[0], /Melhor fonte.*Beleza.*210/);
  assert.match(l.join('\n'), /quase não aproveita.*Joias e Relógios.*350 recusadas, 0 na fila/);
  assert.match(l.join('\n'), /Fitness 120 \(\+3\) · Beleza 80 \(=\).*inclui você e o bot/);
  assert.match(l.join('\n'), /Fila vazia.*Fitness 3x/);
  assert.match(l.join('\n'), /R\$\s?18 pendente · R\$\s?6 aprovado/);
  assert.equal(l.at(-1), '📊 Painel: https://achadinhos-vic-painel.pages.dev');
  assert.doesNotMatch(destaquesDoDia(PAINEL).join('\n'), /Painel:/, 'sem painel publicado, sem link');
  // sem dado nenhum: nada a destacar, sem quebrar
  assert.deepEqual(destaquesDoDia({ periodos: {}, membros: {} }), []);
});

test('resumo da semana: totais por grupo, fontes, canais, categorias paradas, membros e dinheiro', () => {
  const t = resumoSemanal(PAINEL, { url: 'https://achadinhos-vic-painel.pages.dev' });
  assert.match(t, /Ofertas publicadas: \*490\*/);
  assert.match(t, /Fitness: 280 \(fila vazia 5x\)/);
  assert.match(t, /@promobigodeperfumes: 90 → 7/);
  assert.match(t, /sem nenhuma publicação: Joias e Relógios/);
  assert.match(t, /Fitness 120 \(\+15\)/);
  assert.match(t, /ver no painel do ML/);
  assert.ok(t.length <= LIMITE_TELEGRAM);
});

test('mensagem grande é cortada no fim de uma linha com "…", abaixo do limite do Telegram', () => {
  const longo = Array.from({ length: 400 }, (_, i) => `linha ${i} ${'x'.repeat(20)}`).join('\n');
  const c = cortar(longo);
  assert.ok(c.length <= LIMITE_TELEGRAM);
  assert.match(c, /… \(o resto está no painel\)$/);
  assert.equal(cortar('curto'), 'curto');
});

test('resumo das 22h leva os destaques no fim (e sai mesmo sem eles)', async () => {
  const enviados = [];
  const store = { list: () => [], statsDoDia: () => null };
  const avisos = new Avisos({ sender: { sendText: async (jid, t) => enviados.push(t) }, store, destino: '' });
  avisos.jid = '123';
  await avisos.resumoDiario([], ['🥇 Melhor fonte (7 dias): X — 10 publicadas']);
  await avisos.resumoDiario([]);
  assert.match(enviados[0], /Resumo do dia[\s\S]*✨ \*Destaques\*\n🥇 Melhor fonte/);
  assert.doesNotMatch(enviados[1], /Destaques/);
});
