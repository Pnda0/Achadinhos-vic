import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos } from '../src/config.js';
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
    grupos: loadGrupos().map((g) => (g.nome === 'Geral' ? { ...g, ativo: true, emEspera: false } : g)), // o Geral pode estar pausado no arquivo
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

test('coleta de reposição: "apenasGrupos" busca só os grupos pedidos e anota quando cada grupo foi buscado', async () => {
  const { coletar } = await import('../src/pipeline.js');
  const { Store } = await import('../src/store.js');
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  const grupos = ['Geral', 'Perfumes'].map((nome) => ({ nome, ativo: true, filtros: {} }));
  const baixadas = [];
  const buscouShopee = [];
  await coletar(s, {
    grupos,
    apenasGrupos: ['Perfumes'],
    categoriasML: [
      { grupo: 'Geral', nome: 'G', url: 'https://ml/g', paginas: 1, ativo: true },
      { grupo: 'Perfumes', nome: 'P', url: 'https://ml/p', paginas: 1, ativo: true },
    ],
    raspar: async (cat) => (baixadas.push(cat.nome), []),
    esperar: async () => {},
    shopee: async ({ grupos: g }) => (buscouShopee.push(...g.filter((x) => x.ativo).map((x) => x.nome)), { produtos: [], categorias: {} }),
    amazon: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
    awin: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
  });
  assert.deepEqual(baixadas, ['P']);
  assert.deepEqual(buscouShopee, ['Perfumes']);
  assert.deepEqual(Object.keys(s.data.coletaPorGrupo), ['Perfumes']);
});

test('Mercado Livre bloqueou (verificação): para de pedir páginas na hora e fica em pausa; reposição vai ao ML no máx. a cada 3 h', async () => {
  const { coletar, PAUSA_ML_HORAS } = await import('../src/pipeline.js');
  const { ErroBloqueioML } = await import('../src/ml/scraper.js');
  const { Store } = await import('../src/store.js');
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  const grupos = [{ nome: 'Beleza', ativo: true, filtros: {} }];
  const cats = ['A', 'B', 'C'].map((nome) => ({ grupo: 'Beleza', nome, url: `https://ml/${nome}`, paginas: 1, ativo: true }));
  const pedidas = [];
  const desligado = async () => ({ produtos: [], categorias: {}, motivo: 'desligada' });
  const base = { grupos, categoriasML: cats, esperar: async () => {}, shopee: desligado, amazon: desligado, awin: desligado };
  const r = await coletar(s, { ...base, raspar: async (c) => { pedidas.push(c.nome); throw new ErroBloqueioML('o Mercado Livre pediu verificação'); } });
  assert.equal(pedidas.length, 1, 'parou na primeira página bloqueada');
  assert.match(r.mlBloqueado, /verificação/);
  assert.ok(Date.parse(s.data.pausaML) > Date.now() + (PAUSA_ML_HORAS - 1) * 3_600_000);
  await coletar(s, { ...base, raspar: async (c) => (pedidas.push(c.nome), []) });
  assert.equal(pedidas.length, 1, 'em pausa: nem tenta');

  // reposição: ML no máximo a cada 3 h
  const s2 = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  const vez = [];
  await coletar(s2, { ...base, raspar: async (c) => (vez.push(c.nome), []) });
  await coletar(s2, { ...base, mlMinIntervaloH: 3, raspar: async (c) => (vez.push(c.nome), []) });
  assert.equal(vez.length, 3, 'a 2ª (reposição logo depois) não foi ao ML');
});

test('ML: leitura direta barrada pela verificação → tenta pelo navegador (com janela) e não insiste no HTTP; navegador barrado = bloqueio', async () => {
  const { obterProdutos, ErroBloqueioML, _zerarHttpBarrado } = await import('../src/ml/scraper.js');
  _zerarHttpBarrado();
  const VERIF = '<html>gz/account-verification negative_traffic</html>';
  const pagina = fs.readFileSync(new URL('./fixtures/ofertas-polycard.html', import.meta.url), 'utf8');
  let http = 0;
  const httpBarrado = async () => (http++, VERIF);
  const navegadorBom = { html: async () => pagina };
  const r = await obterProdutos('https://ml/1', { http: httpBarrado, navegador: navegadorBom, temNavegador: true });
  assert.ok(r.produtos.length > 0);
  assert.match(r.fonte, /navegador/);
  await obterProdutos('https://ml/2', { http: httpBarrado, navegador: navegadorBom, temNavegador: true });
  assert.equal(http, 1, 'depois da 1ª verificação, vai direto pelo navegador');
  await assert.rejects(obterProdutos('https://ml/3', { http: httpBarrado, navegador: { html: async () => VERIF }, temNavegador: true }), ErroBloqueioML);
  _zerarHttpBarrado();
});
