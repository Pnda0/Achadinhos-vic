import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarPorMarcaML } from '../src/ml/api.js';
import { motivoVendas } from '../src/ml/vendas.js';
import { BUSCAS_MARCA_POR_COLETA, coletar } from '../src/pipeline.js';
import { Store } from '../src/store.js';

// 04/11/2026, o dono: "não é possível que não tenha nada dessas marcas no Mercado Livre".
test('busca por marca no ML: só o anúncio da loja oficial; vale pela regra de vendas', async () => {
  const api = {
    get: async (url) =>
      url.startsWith('/products/search')
        ? { results: [{ id: 'P1', name: 'Creatina Monohidratada 250g Growth Supplements' }, { id: 'P2', name: 'Creatina Growth 500g' }] }
        : url.startsWith('/products/P1/')
          ? { results: [{ item_id: 'MLB111', price: 59.9, original_price: 89.9, condition: 'new', official_store_id: 77, shipping: {} }, { item_id: 'MLB112', price: 49.9, original_price: 89.9, condition: 'new', shipping: {} }] }
          : { results: [{ item_id: 'MLB222', price: 99, original_price: 129, condition: 'new', shipping: {} }] },
    produto: async (id) => ({ nome: id === 'P1' ? 'Creatina Monohidratada 250g Growth Supplements' : 'Creatina Growth 500g', imagem: 'https://x/y.jpg' }),
    salvarCache() {},
  };
  const lista = await buscarPorMarcaML({ grupo: 'Fitness', nome: 'ML marca: creatina growth', buscaML: 'creatina growth' }, { api });
  assert.deepEqual(lista.map((p) => [p.id, p.precoAtual, p.descontoPct, p.lojaOficialML, p.grupo]), [['MLB111', 59.9, 33, true, 'Fitness']], 'o P2 não tem loja oficial');
  assert.equal(motivoVendas(lista[0]), null);
  assert.equal(motivoVendas({ ...lista[0], lojaOficialML: false }), 'sem dado de vendas');
});

test(`coleta: as buscas por marca revezam, ${BUSCAS_MARCA_POR_COLETA} por vez`, async () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-marca-')), 'db.json'));
  const cats = Array.from({ length: BUSCAS_MARCA_POR_COLETA + 3 }, (_, i) => ({ grupo: 'Fitness', nome: `ML marca: b${i}`, buscaML: `b${i}`, ativo: true }));
  const feitas = [];
  const grupos = [{ nome: 'Fitness', ativo: true, jid: 'x', filtros: {} }];
  const opcoes = { categoriasML: cats, grupos, buscaMarcaML: async (cat) => (feitas.push(cat.buscaML), []), raspar: async () => [], esperar: async () => {}, mlMinIntervaloH: 999 };
  await coletar(store, opcoes);
  await coletar(store, opcoes);
  assert.equal(feitas.length, 2 * BUSCAS_MARCA_POR_COLETA);
  assert.deepEqual(feitas.slice(BUSCAS_MARCA_POR_COLETA, BUSCAS_MARCA_POR_COLETA + 4), ['b8', 'b9', 'b10', 'b0']);
});
