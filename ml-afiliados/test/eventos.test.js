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
    shopee: async () => ({ produtos: [], categorias: {}, motivo: "desligada (teste)" }),
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

test('fonte de cada oferta, com nome legível; o "publicado" leva preço, desconto, vendas, cupom, frete e hora', async () => {
  const { fonteDe } = await import('../src/eventos.js');
  assert.equal(fonteDe({ categoria: 'Perfumes' }), 'Mercado Livre: Perfumes');
  assert.equal(fonteDe({ origem: 'espelho', categoria: 'Espelho: @promobit', loja: 'amazon' }), '@promobit');
  assert.equal(fonteDe({ origem: 'espelho', categoria: 'Espelho: Caixa de entrada' }), 'Caixa de entrada');
  assert.equal(fonteDe({ origem: 'awin', tipo: 'cupom', loja: 'awin', categoria: 'Awin: Dafiti' }), 'Awin: Dafiti');
  assert.equal(fonteDe({ loja: 'amazon', categoria: 'Amazon: Whey' }), 'Amazon: Whey');

  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  s.upsert({ id: 'MLB90', grupo: 'Geral', categoria: 'Ofertas do dia', nome: 'Tênis Corrida', url: 'https://p/90', imagem: 'i', precoAtual: 199.9, descontoPct: 40, vendidos: '+500 vendidos', cupom: 'R$ 10 OFF com Cupom', frete: 'Frete grátis', full: true, linkAfiliado: 'https://meli.la/x' });
  await enviarProximo({ typing: async () => {}, sendImage: async () => ({ comImagem: true }), sendText: async () => {} }, { nome: 'Geral', jid: '-1', filtros: { diasSemRepetir: 5 } }, s);
  const pub = buscarEventos('MLB90').find((e) => e.tipo === 'publicado');
  assert.equal(pub.fonte, 'Mercado Livre: Ofertas do dia');
  assert.deepEqual([pub.preco, pub.descontoPct, pub.vendidos, pub.cupom, pub.freteGratis, pub.full], [199.9, 40, '+500 vendidos', true, true, true]);
  assert.match(pub.hora, /^\d{2}:\d{2}$/);
  assert.doesNotMatch(JSON.stringify(pub), /meli\.la/);
});

test('funil do espelho e horários com fila vazia: contadores por dia, 14 dias, a limpeza diária não apaga', async () => {
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  for (const r of ['ok', 'sem link do ML/Amazon', 'fora do nicho', 'ok']) s.contarFunil('@promobit', r, '2026-10-14');
  assert.deepEqual(s.data.funil['2026-10-14']['@promobit'], { lidas: 4, comLink: 3, aceitas: 2, motivos: { 'sem link do ML/Amazon': 1, 'fora do nicho': 1 } });
  const t = new Date('2026-10-14T15:05:00Z'); // 12:05 em São Paulo
  s.anotarFilaVazia('Beleza', t);
  s.anotarFilaVazia('Beleza', t); // mesmo horário não repete
  assert.deepEqual(s.data.filaVazia['2026-10-14'].Beleza, ['12:05']);
  for (let d = 1; d <= 20; d++) s.contarFunil('@x', 'ok', `2026-09-${String(d).padStart(2, '0')}`);
  assert.equal(Object.keys(s.data.funil).length, 14);
  assert.ok(s.data.funil['2026-10-14'], 'o dia mais novo fica');
  s.limparDia();
  assert.ok(s.data.funil['2026-10-14'] && s.data.filaVazia['2026-10-14']);
});
