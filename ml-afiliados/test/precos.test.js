import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { HistoricoDePrecos } = await import('../src/precos.js');
const { notaDeQualidade, Store } = await import('../src/store.js');
const { coletar } = await import('../src/pipeline.js');
const { montarLegenda } = await import('../src/caption.js');

const DIA = 86_400_000;
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-pr-'));

test('histórico de preço: já esteve bem mais barato = caro; o menor preço dos 30 dias ganha o selo', () => {
  const agora = { t: Date.UTC(2026, 9, 1) };
  const h = new HistoricoDePrecos({ arquivo: path.join(pasta(), 'precos.json'), agora: () => agora.t });
  const p = (preco) => ({ id: 'MLB1', precoAtual: preco });
  assert.deepEqual(h.avaliar(p(100)), { caro: false, menorEm30Dias: false, menor: null }); // nunca visto
  h.anotar(p(100));
  agora.t += DIA;
  h.anotar(p(120));
  agora.t += DIA;
  assert.equal(h.avaliar(p(109)).caro, false, 'até 10% acima do menor passa');
  assert.equal(h.avaliar(p(115)).caro, true, 'esteve a R$ 100 há 2 dias: R$ 115 não é oferta');
  const menor = h.avaliar(p(95));
  assert.equal(menor.menorEm30Dias, true);
  assert.equal(menor.caro, false);
  h.anotar(p(95));
  // depois de 30 dias o menor antigo não vale mais: recomeça
  agora.t += 31 * DIA;
  assert.equal(h.avaliar(p(130)).caro, false);
  h.anotar(p(130));
  assert.equal(h.avaliar(p(130)).caro, false);
  // grava e lê de volta; o que não é visto há 60 dias é esquecido
  h.salvar();
  const h2 = new HistoricoDePrecos({ arquivo: h.arquivo, agora: () => agora.t + 61 * DIA });
  assert.equal(h2.dados.MLB1.u, 130);
  h2.salvar();
  assert.deepEqual(new HistoricoDePrecos({ arquivo: h.arquivo }).dados, {});
});

test('coleta usa o histórico: o "desconto" que já foi mais barato fica de fora; o menor preço sai com o selo', async () => {
  const dir = pasta();
  const store = new Store(path.join(dir, 'db.json'));
  const precos = new HistoricoDePrecos({ arquivo: path.join(dir, 'precos.json') });
  precos.dados = {
    CARO: { m: 80, mt: Date.now() - 2 * DIA, x: 150, u: 80, ut: Date.now() - 2 * DIA, n: 3 },
    BOM: { m: 120, mt: Date.now() - 5 * DIA, x: 150, u: 130, ut: Date.now() - DIA, n: 4 },
  };
  const item = (id, preco) => ({ id, nome: `Shampoo Elseve ${id}`, url: `https://p/${id}`, precoAtual: preco, precoOriginal: 200, descontoPct: 40, nota: 4.8, vendidos: '+1000 vendidos' });
  const r = await coletar(store, {
    grupos: [{ nome: 'Beleza', ativo: true, filtros: {} }],
    categoriasML: [{ grupo: 'Beleza', nome: 'B', url: 'https://ml/b', paginas: 1, ativo: true }],
    raspar: async () => [item('CARO', 100), item('BOM', 99)],
    esperar: async () => {},
    precos,
    shopee: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
    amazon: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
    awin: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
  });
  assert.deepEqual(r.recusas, { 'já esteve mais barato (30 dias)': 1 });
  const [bom] = store.list();
  assert.equal(bom.id, 'BOM');
  assert.equal(bom.menorPreco30d, true);
  assert.match(montarLegenda({ ...bom, linkAfiliado: 'https://meli.la/x' }, { titulo: 'T' }), /📉 Menor preço dos últimos 30 dias/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'precos.json'), 'utf8')).BOM.u, 99, 'gravou ao lado do db.json');
});

test('nota de qualidade: desconto, vendas, avaliação e menor preço; a fila escolhe entre as melhores', () => {
  const fraca = { descontoPct: 50, vendidos: '+50 vendidos', nota: 4.0 };
  const forte = { descontoPct: 35, vendidos: '+10mil vendidos', nota: 4.9 };
  assert.ok(notaDeQualidade(forte) > notaDeQualidade(fraca), 'muito vendido e bem avaliado vence só desconto alto');
  assert.ok(notaDeQualidade({ ...fraca, menorPreco30d: true }) > notaDeQualidade(fraca));
  const store = new Store(path.join(pasta(), 'db.json'));
  const pronto = (id, extra) => store.upsert({ id, grupo: 'G', nome: `P ${id}`, status: 'PRONTO', linkAfiliado: 'https://meli.la/x', ...extra });
  for (let i = 0; i < 6; i++) pronto(`ruim${i}`, { descontoPct: 20, vendidos: '+5 vendidos' });
  pronto('top', forte);
  const vistos = new Set();
  for (let i = 0; i < 30; i++) vistos.add(store.proximo('G').id);
  assert.ok(vistos.has('top'));
  assert.ok(vistos.size <= 3, 'sorteio só entre as 3 melhores');
});
