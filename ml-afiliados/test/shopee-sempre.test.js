import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarOfertasShopee } from '../src/shopee-busca.js';

// 04/11/2026, o dono: "não tô vendo os produtos da Kerasys" — a marca só voltava no revezamento a cada 2 dias.
test('Shopee: as buscas "sempre" rodam em toda coleta, antes do revezamento, trocando a página a cada vez', async () => {
  const feitas = [];
  const api = { ligada: () => true, buscar: async (termo, { pagina }) => (feitas.push(`${termo}#${pagina}`), []) };
  const cfg = { buscasPorColeta: 2, paginas: 3, grupos: { Beleza: { buscas: ['a', 'b', 'c', 'd'], sempre: ['kerasys'] } } };
  const vez = {};
  const grupos = [{ nome: 'Beleza', ativo: true }];
  for (let i = 0; i < 3; i++) await buscarOfertasShopee({ grupos, api, cfg, vez, esperar: async () => {} });
  assert.deepEqual(feitas, ['kerasys#1', 'a#1', 'b#1', 'kerasys#2', 'c#1', 'd#1', 'kerasys#3', 'a#2', 'b#2']);
});
