import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { montarDia, gerarDia, porEmDia, lerDia, diasGravados, faixaVendas, MANTER_DIAS } = await import('../src/analytics/dia.js');
const { Store } = await import('../src/store.js');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-an-'));
const novoStore = () => new Store(path.join(pasta(), 'db.json'));
// 14/10/2026 em São Paulo (UTC-3): 12h locais = 15h UTC.
const em = (dia, hora) => `${dia}T${String(hora + 3).padStart(2, '0')}:00:00.000Z`;
const ev = (tipo, extra) => ({ t: em('2026-10-14', 12), tipo, grupo: 'Perfumes', loja: 'ml', origem: 'coleta', fonte: 'Mercado Livre: Perfumes', ...extra });

test('faixa de vendas pelo rótulo do ML', () => {
  assert.equal(faixaVendas('+50 vendidos'), 'mais de 50');
  assert.equal(faixaVendas('+100 vendidos'), 'mais de 100');
  assert.equal(faixaVendas('+1000 vendidos'), 'mais de mil'); // "+1000" = mais de 1000
  assert.equal(faixaVendas('+10mil vendidos'), 'mais de 10 mil');
  assert.equal(faixaVendas('50 vendidos'), 'até 50');
  assert.equal(faixaVendas(null), 'sem dado');
});

test('resumo do dia por grupo e por fonte: só os eventos daquele dia; funil por fonte sem dividir entre grupos', () => {
  const s = novoStore();
  s.contarFunil('@promobigodeperfumes', 'ok', '2026-10-14');
  s.contarFunil('@promobigodeperfumes', 'fora do nicho', '2026-10-14');
  s.anotarFilaVazia('Perfumes', new Date(em('2026-10-14', 20)));
  const eventos = [
    ev('recusado', { detalhe: 'sem dado de vendas' }),
    ev('recusado', { detalhe: 'sem dado de vendas' }),
    ev('na_fila', {}),
    ev('publicado', { hora: '12:05', preco: 100, descontoPct: 40, vendidos: '+500 vendidos', cupom: true, freteGratis: true, full: false, nome: 'Perfume A' }),
    ev('publicado', { hora: '13:10', preco: 300, descontoPct: 20, vendidos: '+100 vendidos', cupom: false, freteGratis: true, full: true, nome: 'Perfume B' }),
    ev('na_fila', { origem: 'espelho', fonte: '@promobigodeperfumes' }),
    ev('publicado', { origem: 'espelho', fonte: '@promobigodeperfumes', hora: '13:15', preco: 200, descontoPct: 60, vendidos: null, nome: 'Perfume C' }),
    ev('duplicado', {}),
    ev('sem_confirmacao', {}),
    { ...ev('publicado', { preco: 999, nome: 'De ontem' }), t: em('2026-10-13', 12) },
    { t: em('2026-10-14', 9), tipo: 'na_fila', grupo: 'Geral', origem: 'coleta' }, // evento antigo, sem "fonte"
  ];
  const r = montarDia('2026-10-14', { eventos, store: s });
  const P = r.grupos.Perfumes;
  assert.deepEqual([P.publicadas, P.naFila, P.recusadas, P.duplicados, P.incertos], [3, 2, 2, 1, 1]);
  assert.deepEqual(P.precos, { media: 200, mediana: 200, min: 100, max: 300 });
  assert.equal(P.descontoMedio, 40);
  assert.deepEqual([P.pctCupom, P.pctFreteGratis, P.pctFull], [33, 67, 33]);
  assert.deepEqual(P.vendas, { 'mais de 500': 1, 'mais de 100': 1, 'sem dado': 1 });
  assert.deepEqual(P.porHora, { 12: 1, 13: 2 });
  assert.deepEqual(P.top10.map((x) => x.nome), ['Perfume C', 'Perfume A', 'Perfume B']);
  assert.deepEqual(P.fontes['Mercado Livre: Perfumes'].recusas, { 'sem dado de vendas': 2 });
  assert.equal(P.fontes['@promobigodeperfumes'].publicadas, 1);
  assert.deepEqual(P.filaVazia, ['20:00']);
  assert.equal(r.grupos.Geral.fontes['Mercado Livre'].naFila, 1); // sem "fonte": nome pela origem
  assert.deepEqual(r.funil['@promobigodeperfumes'], { lidas: 2, comLink: 2, aceitas: 1, motivos: { 'fora do nicho': 1 } });
  assert.equal(P.filaFim, null, 'sem fila deste dia no db.json');
  assert.doesNotMatch(JSON.stringify(r), /https?:|meli\.la|token|cookie/i);
});

test('bot desligado na virada: ao ligar, o dia de ontem é gerado (com a fila que sobrou) antes da limpeza', () => {
  const s = novoStore();
  const base = pasta();
  const ontem = '2026-10-13';
  s.data.produtos['Beleza:MLB1'] = { id: 'MLB1', grupo: 'Beleza', nome: 'x', status: 'PRONTO', coletadoEm: em(ontem, 7) };
  s.data.produtos['Beleza:MLB2'] = { id: 'MLB2', grupo: 'Beleza', nome: 'y', status: 'ENVIADO', coletadoEm: em(ontem, 7) };
  const eventos = [{ t: em(ontem, 10), tipo: 'publicado', grupo: 'Beleza', fonte: 'Mercado Livre: Beleza', preco: 50 }];
  // 21h55 de ontem: o parcial
  gerarDia(ontem, { store: s, base, eventos, parcial: true, agora: new Date(em(ontem, 21)) });
  assert.equal(lerDia(ontem, base).parcial, true);
  // hoje às 7h05: o bot liga e põe em dia (o PC ficou desligado das 22h às 7h)
  const gerados = porEmDia({ store: s, base, eventos, agora: new Date(em('2026-10-14', 7)) });
  assert.deepEqual(gerados, [ontem]);
  const r = lerDia(ontem, base);
  assert.equal(r.parcial, false);
  assert.equal(r.grupos.Beleza.publicadas, 1);
  assert.equal(r.grupos.Beleza.filaFim, 1);
  // ligar de novo no mesmo dia não refaz nada; dia sem dado nenhum não vira arquivo
  assert.deepEqual(porEmDia({ store: s, base, eventos, agora: new Date(em('2026-10-14', 9)) }), []);
  assert.deepEqual(diasGravados(base), [ontem]);
});

test('parcial refeito depois que a fila já é de outro dia: mantém a fila que sobrou medida às 21h55', () => {
  const base = pasta();
  const s = novoStore();
  s.data.produtos['Geral:MLB1'] = { id: 'MLB1', grupo: 'Geral', nome: 'x', status: 'PRONTO', coletadoEm: em('2026-10-13', 7) };
  const eventos = [{ t: em('2026-10-13', 10), tipo: 'na_fila', grupo: 'Geral', fonte: 'Mercado Livre: X' }];
  gerarDia('2026-10-13', { store: s, base, eventos, parcial: true });
  assert.equal(lerDia('2026-10-13', base).grupos.Geral.filaFim, 1);
  s.limparDia(); // a fila de ontem foi descartada antes do "pôr em dia" (ex.: à meia-noite, sem o resumo)
  porEmDia({ store: s, base, eventos, agora: new Date(em('2026-10-14', 8)) });
  const r = lerDia('2026-10-13', base);
  assert.equal(r.parcial, false);
  assert.equal(r.grupos.Geral.filaFim, 1);
});

test(`guarda só ${MANTER_DIAS} dias`, () => {
  const base = pasta();
  const inicio = new Date('2026-01-01T15:00:00Z').getTime();
  for (let i = 0; i < MANTER_DIAS + 5; i++) {
    const dia = new Date(inicio + i * 86_400_000).toISOString().slice(0, 10);
    gerarDia(dia, { base, eventos: [] });
  }
  const dias = diasGravados(base);
  assert.equal(dias.length, MANTER_DIAS);
  assert.equal(dias[0], '2026-01-06');
});
