import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { listaDeMarcas, marcaDoProduto, preferenciaDeMarca } = await import('../src/marcas.js');
const { loadMarcas } = await import('../src/config.js');
const { enviarProximo } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');

test('marcas da lista (config/marcas.json): acha pelo nome do anúncio ou pelo texto do post', () => {
  const lista = listaDeMarcas(loadMarcas());
  assert.ok(lista.length > 80);
  assert.equal(marcaDoProduto({ nome: 'Shampoo Elseve Liso dos Sonhos 400ml' }, lista), 'Elseve');
  assert.equal(marcaDoProduto({ nome: 'Máscara Kérastase Nutritive' }, lista), 'Kérastase');
  assert.equal(marcaDoProduto({ nome: "Sérum L'Oréal Paris Revitalift" }, lista), "L'Oréal");
  assert.equal(marcaDoProduto({ nome: 'Protetor La Roche-Posay Anthelios' }, lista), 'La Roche-Posay');
  assert.equal(marcaDoProduto({ nome: 'Oferta', textoPronto: '🔥 Creatina Growth 250g\n👉 https://meli.la/x' }, lista), 'Growth Supplements');
  assert.equal(marcaDoProduto({ nome: 'Legging Live! Fit Feminina' }, lista), 'Live!');
  assert.equal(marcaDoProduto({ nome: 'Quem disse, Berenice? Batom' }, lista), 'Quem Disse, Berenice?');
  // sem marca da lista (e sem falso positivo em pedaço de palavra)
  assert.equal(marcaDoProduto({ nome: 'Air Fryer Mondial 4L' }, lista), null);
  assert.equal(marcaDoProduto({ nome: 'Óleo natural de coco' }, lista), null, '"natural" não é "Natura"');
  assert.equal(marcaDoProduto({ nome: 'Assista à live de hoje' }, lista), null, '"live" sozinho não é a Live!');
});

test('fila: oferta de marca sai antes da sem marca; feminino continua valendo', async () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  const pronto = (id, nome, desconto) => store.upsert({ id, grupo: 'Geral', nome, status: 'PRONTO', url: `https://x/${id}`, linkAfiliado: `https://meli.la/${id}`, descontoPct: desconto, vendidos: '+1000 vendidos', coletadoEm: '2026-10-15T10:00:00Z' });
  pronto('A', 'Vestido Midi Feminino', 60);
  pronto('B', 'Batom Ruby Rose Feminino', 10);
  pronto('C', 'Tênis Nike Revolution', 10);
  pronto('D', 'Camisa Adidas Masculina', 70);
  const saiu = [];
  const sender = { sendImage: async (jid, img, t) => (saiu.push(t), { comImagem: true }), sendText: async (jid, t) => saiu.push(t) };
  const grupo = { nome: 'Geral', jid: 'G', filtros: { diasSemRepetir: 5 }, preferirFeminino: 4 };
  const ordem = [];
  for (let i = 0; i < 3; i++) ordem.push((await enviarProximo(sender, grupo, store))?.nome);
  // feminina de marca (2 + 1,5) > neutra de marca (1 + 1,5) > feminina sem marca (2) > masculina de marca (0 + 1,5)
  assert.deepEqual(ordem, ['Batom Ruby Rose Feminino', 'Tênis Nike Revolution', 'Vestido Midi Feminino']);
  assert.equal(preferenciaDeMarca({ peso: 2, x: ['Nike'] })({ nome: 'Tênis Nike' }), 2);
  assert.equal(preferenciaDeMarca({})({ nome: 'Tênis Nike' }), 0);
});
