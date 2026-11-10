// 10/11/2026, o dono: "não tem como o perfume ter tão poucos, pegue tudo do grupo da luh".
import test from 'node:test';
import assert from 'node:assert/strict';
import { Espelho } from '../src/espelho.js';
import { fonteDoGrupoTelegram } from '../src/telegram-canais.js';
import { motivoRecusa } from '../src/pipeline.js';

test('fonte de confiança ("confiar"): sem "só marcas" e sem desconto mínimo; nicho, bloqueadas e sem masculino continuam', () => {
  const c = { apenasAmazon: true, mlPeloNome: true, destinos: [{ grupo: 'Perfumes' }], grupos: [{ titulo: 'Apromodaluh_perf', confiar: true, maxPorHora: 10 }, { titulo: 'Sentinela' }] };
  const luh = fonteDoGrupoTelegram(c, { jid: '1@g.us', titulo: '07 - Apromodaluh_perf' });
  const outra = fonteDoGrupoTelegram(c, { jid: '2@g.us', titulo: 'Sentinela Promo' });
  assert.equal(luh.confiar, true);
  assert.equal(luh.maxPorHora, 10);
  assert.equal(outra.confiar, undefined);
  const grupo = { nome: 'Perfumes', filtros: { palavrasObrigatorias: ['perfume'], palavrasBloqueadas: ['automotivo'], soMarcas: true, descontoMinimo: 20, semMasculino: true } };
  const e = new Espelho({ sender: null, store: null, fontes: [], grupos: [] });
  const p = (nome, extra = {}) => ({ id: 'X', loja: 'amazon', nome, precoAtual: 89, descontoPct: 5, ...extra });
  assert.equal(motivoRecusa(p('Perfume Ciclo Cosméticos Feminino 100ml'), e.filtros(luh, grupo), null, { exigirVendas: false }), null);
  assert.equal(motivoRecusa(p('Perfume Ciclo Cosméticos Feminino 100ml'), e.filtros(outra, grupo), null, { exigirVendas: false }), 'sem marca da lista');
  assert.equal(motivoRecusa(p('Perfume Automotivo Carro'), e.filtros(luh, grupo), null, { exigirVendas: false }), 'palavra bloqueada');
  assert.equal(motivoRecusa(p('Perfume Malbec Masculino'), e.filtros(luh, grupo), null, { exigirVendas: false }), 'masculino');
});

test('cupom: com dois códigos e o 1º só para MELI+, vale o que serve para todo mundo', async () => {
  const { dadosDoTexto } = await import('../src/amazon-espelho.js');
  const d = dadosDoTexto('✨ Perfume Jean Paul Gaultier “La Belle” Paradise Garden Eau de Parfum 50 ml Feminino\n\nde R$ 829\n🔥 por R$ 368,00\n\n🏷️ Cupom: MELIMAISPREDD (Somente clientes MELI+) ou ULTIMASCHANCES\n\n🛒 https://meli.la/1hZGLwX');
  assert.equal(d.cupom, 'ULTIMASCHANCES');
  assert.equal(d.precoAtual, 368);
  assert.equal(dadosDoTexto('Perfume Lattafa Yara 100ml\npor R$ 199\nCupom: ULTIMASCHANCES').cupom, 'ULTIMASCHANCES');
});
