// 06/11/2026, o dono: "alguns posts da amazon estão vindo sem imagem, eu gostaria de arrumar isso".
// Da Amazon não dá para tirar a foto (API só depois das vendas mínimas; robô no site é proibido), a foto do canal pode
// ter o selo dele e a prévia do link da Amazon muitas vezes não monta: vai a foto do MESMO produto no catálogo do ML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fotoPeloNome, mesmaFoto } from '../src/ml/api.js';
import { enviarProximo } from '../src/pipeline.js';
import { Store } from '../src/store.js';

test('foto do catálogo: o mesmo produto escrito de outro jeito serve; outro sabor, cor, tamanho, kit ou marca não', () => {
  for (const [doPost, doCatalogo] of [
    ['YoPRO Bebida Láctea UHT Chocolate 15g de proteínas 250ml', 'Bebida Láctea Yopro Chocolate 15g Proteína 250ml'],
    ['Whey Protein Concentrado Growth Supplements 1kg Sabor Chocolate Fonte de Proteína', 'Whey Protein Concentrado (1kg) Growth Supplements - Chocolate'],
    ['Perfume Lattafa Yara EDP 100ml Feminino', 'Lattafa Yara Eau de Parfum 100ml'],
  ]) {
    assert.equal(mesmaFoto(doPost, doCatalogo), true, `${doPost} = ${doCatalogo}`);
  }
  for (const [doPost, doCatalogo] of [
    ['Whey Protein Concentrado Growth Supplements 1kg Chocolate', 'Whey Protein Concentrado Growth Supplements 1kg Baunilha'],
    ['Tênis Nike Revolution 7 Feminino Corrida Preto', 'Tênis Nike Revolution 7 Feminino Rosa'],
    ['Creatina Monohidratada Growth Supplements 250g', 'Creatina Monohidratada Growth Supplements 1kg'],
    ['Kit 3 Shampoo Kerasys Propolis Energy 180ml', 'Shampoo Kerasys Propolis Energy 180ml'],
    ['Whey Protein Concentrado Max Titanium 900g', 'Whey Protein Concentrado Growth 900g'],
    ['Perfume Lattafa Yara Candy 100ml', 'Lattafa Yara 100ml'],
  ]) {
    assert.equal(mesmaFoto(doPost, doCatalogo), false, `${doPost} ≠ ${doCatalogo}`);
  }
});

test('foto do catálogo: pula o resultado de outro sabor e devolve a foto do certo; sem a chave do ML, nada', async () => {
  const consultas = [];
  const api = {
    configurada: true,
    async get(caminho) {
      consultas.push(caminho);
      return { results: [{ id: 'MLB-BAUNILHA', name: 'Whey Protein Concentrado Growth Supplements 1kg Baunilha' }, { id: 'MLB-CHOCOLATE', name: 'Whey Protein Concentrado (1kg) Growth Supplements - Chocolate' }] };
    },
    async produto(id) {
      return { nome: id, imagem: `https://http2.mlstatic.com/D_${id}.jpg` };
    },
    salvarCache() {},
  };
  assert.equal(await fotoPeloNome(api, 'Whey Protein Concentrado Growth Supplements 1kg Sabor Chocolate'), 'https://http2.mlstatic.com/D_MLB-CHOCOLATE.jpg');
  assert.match(consultas[0], /^\/products\/search\?.*q=Whey%20Protein/);
  assert.equal(await fotoPeloNome({ ...api, configurada: false }, 'Whey Protein Concentrado Growth Supplements 1kg'), null);
  assert.equal(await fotoPeloNome({ ...api, get: async () => ({ results: [{ id: 'X', name: 'Creatina Max Titanium 300g' }] }) }, 'Whey Protein Concentrado Growth Supplements 1kg'), null);
});

test('envio: post da Amazon sem foto sai com a foto do catálogo do ML (e o WhatsApp recebe a mesma); sem ela, prévia do link', async () => {
  const grupo = { nome: 'Fitness', jid: '-1', mensagemAdicional: '', filtros: { diasSemRepetir: 5 } };
  const novo = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-amzfoto-')), 'db.json'));
  const amazon = (extra = {}) => ({
    id: 'AMZ-B0954R6FNH', asin: 'B0954R6FNH', grupo: 'Fitness', loja: 'amazon', nome: 'Refrigerante Zero Pepsi Black Lata 350ml Pack com 12 unidades',
    url: 'https://www.amazon.com.br/dp/B0954R6FNH?tag=achadin09027e-20', linkAfiliado: 'https://www.amazon.com.br/dp/B0954R6FNH?tag=achadin09027e-20',
    imagem: null, precoAtual: 31.08, manual: true, ...extra,
  });
  const remetente = (saida) => ({ sendImage: async (jid, foto) => (saida.push(['foto', foto]), { comImagem: true }), sendText: async () => saida.push(['texto']) });
  const doCatalogo = async (nome) => (/pepsi black/i.test(nome) ? 'https://http2.mlstatic.com/D_pepsi.jpg' : null);

  let store = novo();
  let saida = [];
  store.upsert(amazon());
  assert.equal((await enviarProximo(remetente(saida), grupo, store, { fotoDoCatalogo: doCatalogo }))?.id, 'AMZ-B0954R6FNH');
  assert.deepEqual(saida, [['foto', 'https://http2.mlstatic.com/D_pepsi.jpg']]);
  assert.equal(store.data.produtos['Fitness:AMZ-B0954R6FNH'].imagem, 'https://http2.mlstatic.com/D_pepsi.jpg', 'o espelho do WhatsApp lê a foto daqui');

  store = novo();
  saida = [];
  store.upsert(amazon({ nome: 'Refrigerante Zero Guaraná Antarctica Lata 350ml' }));
  await enviarProximo(remetente(saida), grupo, store, { fotoDoCatalogo: doCatalogo });
  assert.deepEqual(saida, [['texto']], 'não achou o mesmo produto: texto com a prévia do link, como antes');

  store = novo();
  saida = [];
  let perguntou = false;
  store.upsert(amazon({ imagem: 'https://cdn4.telesco.pe/file/foto-do-canal.jpg' }));
  await enviarProximo(remetente(saida), grupo, store, { fotoDoCatalogo: async () => ((perguntou = true), null) });
  assert.deepEqual(saida, [['foto', 'https://cdn4.telesco.pe/file/foto-do-canal.jpg']]);
  assert.equal(perguntou, false, 'já tinha foto boa: não gasta a API');

  store = novo();
  saida = [];
  store.upsert(amazon());
  await enviarProximo(remetente(saida), grupo, store, { fotoDoCatalogo: async () => { throw new Error('HTTP 500'); } });
  assert.deepEqual(saida, [['texto']], 'a API do ML falhou: o post sai mesmo assim');
});
