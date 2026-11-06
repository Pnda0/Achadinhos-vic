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

// 05/11/2026, o dono mandou as marcas do Fitness em ordem: "a prioridade podia ser nessas marcas grandes... se não houver
// vai descendo pela marca menos conhecida... coloque o desconto na avaliação".
test('nota da oferta: marca do topo da lista do dono vence marca do fim, mesmo com desconto um pouco menor', () => {
  const growth = nota(o('Creatina Monohidratada 300g Growth Supplements', { descontoPct: 25 })).nota;
  const newMillen = nota(o('Creatina 100% Monohidratada 300g - New Millen', { descontoPct: 35 })).nota;
  assert.ok(growth > newMillen, `${growth} > ${newMillen}`);
  assert.equal(nota(o('Whey Protein Growth Supplements 900g')).partes.marca, 40);
  assert.equal(nota(o('Smartwatch Fitbit Charge 6')).partes.marca, 15);
  const max = nota(o('Whey Protein Max Titanium 900g')).partes.marca;
  const lupo = nota(o('Legging Lupo Feminina')).partes.marca;
  const asics = nota(o('Tênis Asics Feminino')).partes.marca;
  assert.ok(max > lupo && lupo > asics, `${max} > ${lupo} > ${asics}`);
  // Desconto continua contando: New Millen com desconto bem maior passa a Growth com pouco desconto.
  assert.ok(nota(o('Creatina 300g - New Millen', { descontoPct: 60 })).nota > nota(o('Creatina Growth Supplements 300g', { descontoPct: 10 })).nota);
});

test('Track&Field, Alto Giro, Adaptogen, Universal Nutrition e Dymatize saíram da lista (05/11/2026)', async () => {
  const { marcaDoProduto } = await import('../src/marcas.js');
  for (const nome of ['Legging Track & Field Feminina', 'Top Alto Giro Feminino', 'Whey Dymatize Elite 900g', 'Whey Universal Nutrition 900g', 'Adaptogen Whey 900g']) assert.equal(marcaDoProduto({ nome }), null, nome);
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

// 05/11/2026, o dono: "queria essa no grupo fit também" (Dr. Peanut da Amazon). O que ele manda no privado sai primeiro.
test('nota: oferta mandada pelo dono no privado passa na frente de tudo', () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-rank3-')), 'db.json'));
  const add = (p) => (store.data.produtos[`Fitness:${p.id}`] = { ...p, status: 'PRONTO', linkAfiliado: 'https://x' });
  add(o('Tênis Asics Gel Nimbus Feminino', { id: 'A', descontoPct: 50, prioridade: undefined }));
  add(o('Dr. Peanut Pasta de Amendoim 600g Avelã', { id: 'AMZ-B0BVZY7BM6', loja: 'amazon', descontoPct: 38, manual: true, vendidos: null }));
  assert.equal(store.proximo('Fitness', { nota }).id, 'AMZ-B0BVZY7BM6');
});

// 06/11/2026, o dono: "tô achando os produtos da Nike muito caros, tem como dar uma variada nas marcas".
test('nota: produto caro perde pontos no Fitness e marca que já saiu hoje perde 8 por post', () => {
  const notaFit = notaDaOferta({ prioridade: prioridadeDoGrupo(fitness), precoBom: fitness.precoBom });
  assert.equal(fitness.precoBom, 250);
  const caro = o('Tênis Nike Pegasus 41 Feminino', { precoAtual: 699.99 });
  assert.equal(notaFit(caro).partes.preco, -25);
  assert.equal(notaFit(o('Tênis Nike Revolution 7 Feminino', { precoAtual: 249.9 })).partes.preco, 0);
  assert.equal(notaFit(o('Tênis Nike Revolution 7 Feminino', { precoAtual: 400 })).partes.preco, -10);
  const doDia = [{ nome: 'Top Nike Swoosh Feminino' }, { nome: 'Legging Nike One Feminina' }];
  assert.equal(notaFit(caro, { doDia }).partes.marcaNoDia, -16);
  // Na fila: o tênis Nike de R$ 700 com 2 Nike hoje perde para um whey Max Titanium de R$ 120 com menos desconto.
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-rank4-')), 'db.json'));
  const add = (p) => (store.data.produtos[`Fitness:${p.id}`] = { ...p, status: 'PRONTO', linkAfiliado: 'https://x' });
  const env = (id, nome, h) => (store.data.produtos[`Fitness:${id}`] = { id, grupo: 'Fitness', nome, loja: 'awin', status: 'ENVIADO', enviadoEm: new Date(agora - h * 3_600_000).toISOString() });
  env('E1', 'Top Nike Swoosh Feminino', 9);
  env('E2', 'Legging Nike One Feminina', 6);
  env('E3', 'Creatina Growth Supplements 300g', 3);
  env('E4', 'Legging Lupo Feminina', 2);
  env('E5', 'Garrafa Integralmedica', 1);
  add(o('Tênis Nike Pegasus 41 Feminino', { id: 'NIKE', descontoPct: 40, precoAtual: 699.99 }));
  add(o('Whey Protein Max Titanium 900g', { id: 'MAX', descontoPct: 20, precoAtual: 119.9 }));
  assert.equal(store.proximo('Fitness', { nota: notaFit }).id, 'MAX');
});
