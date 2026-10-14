import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Histórico num arquivo só deste teste (antes de carregar os módulos).
const ARQ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
process.env.EVENTOS_ARQUIVO = ARQ;
process.env.SIMULAR_DIGITANDO = 'false';
const { buscarEventos, evento, origemDe } = await import('../src/eventos.js');
const { enviarProximo, coletar } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');

test('histórico por produto: cada etapa deixa rastro, sem link nem dado sensível', async () => {
  const s = new Store(path.join(path.dirname(ARQ), 'db.json'));
  const base = { grupo: 'Geral', precoAtual: 99, descontoPct: 50, nota: 4.7, imagem: 'https://img/x.jpg' };
  const r = await coletar(s, {
    categoriasML: [{ grupo: 'Geral', nome: 'A', url: 'https://ml/ofertas', paginas: 1, ativo: true }],
    raspar: async () => [
      { ...base, id: 'MLB10', nome: 'Fone Bom', url: 'https://p/10', vendidos: '+1000 vendidos' },
      { ...base, id: 'MLB11', nome: 'Fone Pouco Vendido', url: 'https://p/11', vendidos: '+25 vendidos' },
      { ...base, id: 'MLB12', nome: 'Fone Sem Rótulo', url: 'https://p/12' },
    ],
    esperar: async () => {},
    amazon: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
    awin: async () => ({ produtos: [], categorias: {}, motivo: 'desligada em config/awin.json' }),
  });
  assert.equal(r.novos, 1);
  s.setLink('https://p/10', 'https://meli.la/abc');
  const sender = { typing: async () => {}, sendImage: async () => ({ comImagem: true }), sendText: async () => {} };
  await enviarProximo(sender, { nome: 'Geral', jid: '-1', mensagemAdicional: '', filtros: { diasSemRepetir: 5 } }, s);

  const tipos = (id) => buscarEventos(id).map((e) => e.tipo + (e.detalhe ? `:${e.detalhe}` : ''));
  assert.deepEqual(tipos('MLB10'), ['na_fila', 'publicado']);
  assert.deepEqual(tipos('MLB11'), ['recusado:até 50 vendas']);
  assert.deepEqual(tipos('MLB12'), ['recusado:sem dado de vendas']);
  assert.equal(buscarEventos('pouco vendido').length, 1); // busca também pelo nome
  const texto = fs.readFileSync(ARQ, 'utf8');
  assert.doesNotMatch(texto, /meli\.la|cookie|token|https?:/i);
  assert.equal(buscarEventos('MLB10')[0].origem, 'coleta');
});

test('histórico: linha cortada (queda de energia) não derruba a consulta; origem de cada fonte', () => {
  fs.appendFileSync(ARQ, '{"t":"2026-10-14T10:00:00Z","tipo":"publicado","id":"MLB77"\n'); // cortada
  evento('na_fila', { id: 'MLB77', grupo: 'Geral', nome: 'Ok' });
  assert.deepEqual(buscarEventos('MLB77').map((e) => e.tipo), ['na_fila']);
  assert.equal(origemDe({ origem: 'espelho', categoria: 'Espelho: Caixa de entrada' }), 'caixa');
  assert.equal(origemDe({ origem: 'espelho', categoria: 'Espelho: @urubupromo' }), 'espelho');
  assert.equal(origemDe({ tipo: 'cupom', loja: 'awin' }), 'awin-cupom');
  assert.equal(origemDe({ loja: 'amazon' }), 'amazon');
});
