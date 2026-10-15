import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SIMULAR_DIGITANDO = 'false';
const { generoDoPerfume } = await import('../src/genero.js');
const { enviarProximo } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');

test('gênero do perfume pelo nome do anúncio e pelo texto do post', () => {
  assert.equal(generoDoPerfume({ nome: 'Perfume Lattafa Yara Eau de Parfum Feminino 100ml' }), 'f');
  assert.equal(generoDoPerfume({ nome: 'Perfume Jean Paul Gaultier Le Male EDT Masculino 125ml' }), 'm');
  assert.equal(generoDoPerfume({ nome: 'Natura Homem Identidad 100ml' }), 'm');
  assert.equal(generoDoPerfume({ nome: 'Carolina Herrera Good Girl EDP' }), 'f');
  assert.equal(generoDoPerfume({ nome: 'Al Wataniah Sabah EDP Unissex 100ml' }), null);
  assert.equal(generoDoPerfume({ nome: 'Perfume Árabe Maison Alhambra Philos Pura' }), null, '"Maison" não é "man"');
});

test('Perfumes: femininos na frente; no máximo 1 masculino a cada 3 posts; só masculino na fila = espera (sem alarme de fila vazia)', async () => {
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-g-')), 'db.json'));
  const grupo = { nome: 'Perfumes', jid: '-1', mensagemAdicional: '', preferirFeminino: true, filtros: { diasSemRepetir: 5 } };
  const add = (id, nome, desconto) =>
    s.upsert({ id, grupo: 'Perfumes', nome, url: `https://p/${id}`, imagem: 'i', precoAtual: 100, descontoPct: desconto, vendidos: '+100 vendidos', linkAfiliado: `https://meli.la/${id}` });
  add('M1', 'Perfume Azzaro Wanted Masculino', 90);
  add('M2', 'Perfume Le Male Masculino', 85);
  add('F1', 'Perfume Yara Feminino', 10);
  const postados = [];
  const sender = { sendImage: async (jid, img, t) => (postados.push(t), { comImagem: true }), sendText: async () => {} };
  const nomeDe = (p) => p?.nome?.split(' ')[1];

  assert.equal(nomeDe(await enviarProximo(sender, grupo, s)), 'Yara', 'feminino na frente, mesmo com desconto menor');
  assert.match((await enviarProximo(sender, grupo, s)).nome, /Masculino/, 'sem feminino: sai 1 masculino');
  const r = await enviarProximo(sender, grupo, s);
  assert.deepEqual(r, { esperando: true }, 'logo depois de um masculino, outro masculino espera');
  assert.equal(postados.length, 2);
  add('F2', 'Perfume Good Girl Feminino', 5);
  assert.equal(nomeDe(await enviarProximo(sender, grupo, s)), 'Good');
  // grupo sem a preferência: segue pela ordem de sempre
  assert.match((await enviarProximo(sender, { ...grupo, preferirFeminino: false }, s)).nome, /Masculino/);
});
