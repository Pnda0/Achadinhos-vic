import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGrupos } from '../src/config.js';
import { prioridadeDoGrupo } from '../src/pipeline.js';
import { notaDaOferta } from '../src/ranking.js';
import { Store } from '../src/store.js';
import { itensDaFila, textoDaFila } from '../src/comandos.js';

// 05/11/2026, o dono: "quero que você ranqueie as promoções... as marcas que te falei são prioridade, desconto é bom também".
const fitness = loadGrupos().find((g) => g.nome === 'Fitness');
const nota = notaDaOferta({ prioridade: prioridadeDoGrupo(fitness) });
const agora = Date.now();
const o = (nome, extra = {}) => ({ id: nome, grupo: 'Fitness', nome, loja: 'ml', descontoPct: 30, nota: 4.7, vendidos: '+1000 vendidos', coletadoEm: new Date(agora - 2 * 3_600_000).toISOString(), ...extra });

test('nota da oferta: marca que o dono pediu vence marca posta pelo Claude, mesmo com desconto menor', () => {
  const growth = nota(o('Creatina Monohidratada 300g Growth Supplements', { descontoPct: 25 })).nota;
  const newMillen = nota(o('Creatina 100% Monohidratada 300g - New Millen', { descontoPct: 50 })).nota;
  assert.ok(growth > newMillen, `${growth} > ${newMillen}`);
  assert.equal(nota(o('Creatina 300g - New Millen')).partes.marca, 15);
  assert.equal(nota(o('Whey Protein Max Titanium 900g')).partes.marca, 35);
});

test('nota da oferta: entre marcas do dono, desconto maior e feminino na frente; mesma loja do último perde pontos', () => {
  const a = nota(o('Legging Lupo Feminina Cintura Alta', { descontoPct: 40 })).nota;
  const b = nota(o('Legging Lupo Feminina Cintura Alta', { descontoPct: 15 })).nota;
  assert.ok(a > b);
  assert.ok(nota(o('Tênis Asics Gel Feminino')).nota > nota(o('Tênis Asics Gel Masculino')).nota);
  const p = o('Whey Growth 900g');
  assert.equal(nota(p, { ultimo: { loja: 'ml' } }).bruta, nota(p).bruta - 8);
  const n = nota(o('Whey Growth 900g', { descontoPct: 90, nota: 5, vendidos: '+50mil vendidos', menorPreco30d: true, coletadoEm: new Date().toISOString() })).nota;
  assert.ok(n <= 100);
});

test('fila: sai a de maior nota (a copiada mais nova não fura mais a fila) e o /fila mostra na ordem, com a nota', () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-rank-')), 'db.json'));
  const add = (p) => (store.data.produtos[`Fitness:${p.id}`] = { ...p, status: 'PRONTO', linkAfiliado: 'https://x' });
  add(o('Creatina 300g - New Millen', { id: 'A', origem: 'espelho', coletadoEm: new Date().toISOString() }));
  add(o('Whey Protein Concentrado 900g Growth Supplements', { id: 'B', descontoPct: 35 }));
  add(o('Garrafa Térmica Genérica', { id: 'C', descontoPct: 60 }));
  assert.equal(store.proximo('Fitness', { nota }).id, 'B');
  const linhas = itensDaFila(store.list(), 40, (p) => nota(p).nota);
  assert.match(linhas[0], /^\d+ · Whey Protein Concentrado/);
});

// 05/11/2026, o dono: "só tem coisa da Nike aí, e o que chega no grupo não é isso que chega".
test('nota: marca de um dos 3 últimos posts perde 15; /fila separa o que sai agora do que está preso (Awin no limite)', () => {
  const p = o('Tênis Nike Revolution 8 Feminino');
  assert.equal(nota(p, { recentes: [{ nome: 'Top Nike Swoosh Feminino' }] }).bruta, nota(p).bruta - 15);
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-rank2-')), 'db.json'));
  const add = (p) => (store.data.produtos[`Fitness:${p.id}`] = { ...p, status: 'PRONTO', linkAfiliado: 'https://x' });
  for (let i = 0; i < 4; i++) add(o(`Tênis Nike Downshifter ${i} Feminino`, { id: `AWF-${i}`, loja: 'awin' }));
  add(o('Whey Protein Concentrado 900g Growth Supplements', { id: 'MLB9', descontoPct: 10 }));
  const texto = textoDaFila({ store, grupo: { nome: 'Fitness', ativo: true }, agoraPode: { awin: false }, nota });
  const [, proximos, esperando] = texto.split(/\*Próximos a sair\*|\*Esperando a vez\*/);
  assert.match(proximos, /Whey Protein/);
  assert.doesNotMatch(proximos, /Nike/);
  assert.match(esperando, /\(4\): 4 — catálogo da Awin no limite do dia/);
});
