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
  // Marca com prioridade própria (WePink, pedido do dono, 27/10/2026) passa na frente das outras marcas.
  const pref = preferenciaDeMarca({ peso: 1.5, perfumes: [{ marca: 'WePink', termos: ['wepink', 'we pink'], peso: 3 }, 'Dior'] });
  assert.deepEqual([pref({ nome: 'Body Splash We Pink 200ml' }), pref({ nome: 'Perfume Dior Jadore' }), pref({ nome: 'Perfume qualquer' })], [3, 1.5, 0]);
  // A WePink saiu dos grupos (o dono, 29/10/2026: cara, sem afiliado, no ML acima do valor): não é marca da lista e
  // é palavra bloqueada em todos eles, inclusive os brindes com o nome dela.
  const { loadGrupos } = await import('../src/config.js');
  const { motivoRecusa } = await import('../src/pipeline.js');
  const perfumes = loadGrupos().find((g) => g.nome === 'Perfumes').filtros;
  assert.equal(marcaDoProduto({ nome: 'Body Splash Wepink Virginia 200ml' }), null);
  for (const g of loadGrupos()) {
    for (const nome of ['Body Splash Wepink Virginia 200ml', 'Perfume We Pink Bloom 100ml', 'Porta Body Splash Wepink 200ml Expositor Organizador de Perfumes']) {
      const motivo = motivoRecusa({ id: 'X', nome: `${nome} Feminino`, precoAtual: 120, descontoPct: 30, nota: 4.8, vendidos: '+100 vendidos' }, g.filtros);
      // Fora do nicho do grupo o nicho barra antes (body splash não é fitness); no nicho, a palavra bloqueada.
      assert.ok(['fora do nicho', 'palavra bloqueada'].includes(motivo), `${g.nome}: ${nome} (${motivo})`);
    }
  }
  const fitness = loadGrupos().find((g) => g.nome === 'Fitness').filtros;
  const oferta = (nome) => ({ id: 'X', nome, precoAtual: 120, descontoPct: 30, nota: 4.8, vendidos: '+100 vendidos' });
  assert.equal(motivoRecusa(oferta('Perfume We Pink Bloom 100ml Feminino'), perfumes), 'palavra bloqueada');
  assert.equal(motivoRecusa(oferta('Legging Feminina WePink Fitness'), fitness), 'palavra bloqueada');
  assert.equal(motivoRecusa({ id: 'X', nome: 'Sacolas Plásticas Com Logo Body Splash', precoAtual: 50, descontoPct: 30, nota: 4.8, vendidos: '+100 vendidos' }, perfumes), 'palavra bloqueada');
});

test('grupo "soMarcas" (Fitness, Beleza, Perfumes): só marca da lista entra e sai; Geral não filtra; cupom passa', async () => {
  const { loadGrupos } = await import('../src/config.js');
  const { motivoRecusa } = await import('../src/pipeline.js');
  const grupos = loadGrupos();
  const g = (nome) => grupos.find((x) => x.nome === nome);
  assert.equal(g('Beleza').filtros.soMarcas, true);
  assert.equal(g('Geral').filtros.soMarcas, undefined);
  const p = (grupo, nome, extra = {}) => ({ id: 'X', grupo, nome, precoAtual: 99, descontoPct: 30, nota: 4.6, vendidos: '+1000 vendidos', ...extra });
  assert.equal(motivoRecusa(p('Beleza', 'Shampoo Elseve Liso dos Sonhos 400ml'), g('Beleza').filtros), null);
  assert.equal(motivoRecusa(p('Beleza', 'Shampoo Genérico Liso 400ml'), g('Beleza').filtros), 'sem marca da lista');
  assert.equal(motivoRecusa(p('Beleza', 'Cupom C&A', { tipo: 'cupom' }), { soMarcas: true }), null);
  assert.equal(motivoRecusa(p('Geral', 'Air Fryer Mondial 4L'), g('Geral').filtros), null);

  // na hora de postar: o que já estava na fila sem marca é barrado
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  const pronto = (id, nome) => store.upsert({ id, grupo: 'Beleza', nome, status: 'PRONTO', url: `https://x/${id}`, linkAfiliado: `https://meli.la/${id}`, descontoPct: 30, vendidos: '+1000 vendidos', coletadoEm: '2026-10-15T10:00:00Z' });
  pronto('A', 'Máscara Capilar Genérica Feminina');
  pronto('B', 'Máscara Capilar Wella Feminina');
  const sender = { sendImage: async () => ({ comImagem: true }), sendText: async () => {} };
  const grupo = { nome: 'Beleza', jid: 'B', filtros: { diasSemRepetir: 5 }, soMarcas: true };
  assert.equal((await enviarProximo(sender, grupo, store))?.nome, 'Máscara Capilar Wella Feminina');
  assert.equal(await enviarProximo(sender, grupo, store), null);
  assert.equal(store.list((x) => x.id === 'A')[0].status, 'REJEITADO');
});

test('na hora de postar: o que está na fila fora do nicho (ex.: rack "Dior" no Perfumes) não sai; cupom passa', async () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  // Mercado Livre (a Shopee tem limite de 1 a cada N posts e faria o 2º esperar a vez)
  const pronto = (id, nome, extra = {}) => store.upsert({ id, grupo: 'Perfumes', nome, status: 'PRONTO', url: `https://x/${id}`, linkAfiliado: `https://meli.la/${id}`, vendidos: '+1000 vendidos', descontoPct: 30, coletadoEm: '2026-10-16T10:00:00Z', ...extra });
  pronto('R', 'Rack Suspenso para TV Off White Dior');
  pronto('P', 'Perfume Dior J adore Feminino 100ml');
  const enviados = [];
  const sender = { sendImage: async (j, i, t) => (enviados.push(t), { comImagem: true }), sendText: async (j, t) => enviados.push(t) };
  const grupo = { nome: 'Perfumes', jid: 'P', soMarcas: true, filtros: { diasSemRepetir: 5, palavrasObrigatorias: ['perfume', 'parfum'] } };
  assert.equal((await enviarProximo(sender, grupo, store))?.nome, 'Perfume Dior J adore Feminino 100ml');
  assert.equal(await enviarProximo(sender, grupo, store), null);
  assert.equal(store.list((x) => x.id === 'R')[0].erro, 'fora do nicho');
});

test('capinha de celular com logo de marca não entra em grupo nenhum (busca "Nike" na Shopee, 21/10/2026)', async () => {
  const { loadGrupos } = await import('../src/config.js');
  const { motivoRecusa } = await import('../src/pipeline.js');
  const grupos = loadGrupos();
  const p = (grupo, nome) => ({ id: 'X', grupo, nome, precoAtual: 50, descontoPct: 30, nota: 4.8, vendidos: '+1000 vendidos', loja: 'shopee' });
  for (const g of ['Fitness', 'Beleza', 'Geral']) {
    const f = grupos.find((x) => x.nome === g).filtros;
    assert.ok(motivoRecusa(p(g, 'Silicone Anti-impacto Capinha Capa Nike iPhone 11 12 13 14 15 Pro MAX'), f), g); // recusada (no Beleza já pelo nicho)
    assert.ok(motivoRecusa(p(g, 'Capa Fosco Anti impacto Nike Swoosh para Samsung A15'), f), g);
    if (g === 'Fitness') assert.equal(motivoRecusa(p(g, 'Capinha Nike para iPhone 15'), f), 'palavra bloqueada');
  }
  const fit = grupos.find((x) => x.nome === 'Fitness').filtros;
  for (const bom of ['Óculos de Natação Profissional Decathlon Nabaiji', 'Meia New Balance Cano Longo Kit 3 Pares', 'Relógio Smartwatch compatível com celular Nike Run']) assert.equal(motivoRecusa(p('Fitness', bom), fit), null, bom);
});

test('Shopee no máximo 1 a cada 4 posts: ML e Awin primeiro; só Shopee na fila = 1 a cada 12 min (não trava)', async () => {
  const { shopeeLiberada } = await import('../src/pipeline.js');
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  const agora = Date.parse('2026-10-26T15:00:00Z');
  const enviado = (id, loja, minAtras) => {
    store.upsert({ id, grupo: 'G', nome: id, status: 'PRONTO', loja, linkAfiliado: 'x' });
    store.setStatus(store.list((p) => p.id === id)[0], 'ENVIADO', { enviadoEm: new Date(agora - minAtras * 60_000).toISOString() });
  };
  assert.equal(shopeeLiberada(store, 'G', 4, 3, agora), true, 'grupo novo');
  enviado('S1', 'shopee', 3);
  assert.equal(shopeeLiberada(store, 'G', 4, 3, agora), false, 'acabou de sair uma da Shopee');
  enviado('M1', undefined, 2);
  enviado('A1', 'awin', 1);
  assert.equal(shopeeLiberada(store, 'G', 4, 3, agora), false, 'ainda está entre as 3 últimas');
  enviado('M2', undefined, 0.5);
  assert.equal(shopeeLiberada(store, 'G', 4, 3, agora), true, 'saiu das 3 últimas: libera');
  // só Shopee: depois de 12 min libera mesmo sem outras lojas no meio
  const s2 = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  s2.upsert({ id: 'S', grupo: 'G', nome: 'S', status: 'PRONTO', loja: 'shopee', linkAfiliado: 'x' });
  s2.setStatus(s2.list()[0], 'ENVIADO', { enviadoEm: new Date(agora - 11 * 60_000).toISOString() });
  assert.equal(shopeeLiberada(s2, 'G', 4, 3, agora), false);
  assert.equal(shopeeLiberada(s2, 'G', 4, 3, agora + 60_000), true);
  assert.equal(shopeeLiberada(s2, 'G', 0, 3, agora), true, '0 = sem limite');
});

// Caso real (27/10/2026): "Kit de 1 Ate 2 Perfumes Lataffa Yara Arabe 100ml" a R$ 27,44 saiu no Perfumes (o original custa R$ 150+).
test('marca cara barata demais = suspeita de falso: fica de fora na busca e na hora de postar', async () => {
  const { motivoPrecoDaMarca } = await import('../src/marcas.js');
  const { loadGrupos } = await import('../src/config.js');
  const { motivoRecusa } = await import('../src/pipeline.js');
  const yara = { nome: 'Kit de 1 Ate 2 Perfumes  Lataffa Yara Arabe 100ml Feminino - Excelente fixa', precoAtual: 27.44, descontoPct: 48, nota: 4.5, loja: 'shopee' };
  assert.match(motivoPrecoDaMarca(yara), /barato demais para Lattafa/);
  assert.equal(motivoPrecoDaMarca({ ...yara, precoAtual: 149.9 }), null);
  assert.equal(motivoPrecoDaMarca({ nome: 'Maison Alhambra 30ml Perfume Arabe Feminino', precoAtual: 63.6 }), null, '30 ml original passa');
  assert.equal(motivoPrecoDaMarca({ nome: 'Perfume Natura Essencial Feminino', precoAtual: 30 }), null, 'marca sem preço mínimo');
  const perf = loadGrupos().find((g) => g.nome === 'Perfumes').filtros;
  assert.match(motivoRecusa(yara, perf), /suspeita de falso/);
  assert.equal(motivoRecusa({ ...yara, manual: true }, perf), null, 'link mandado pelo dono passa');

  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
  s.upsert({ id: 'Y', grupo: 'Perfumes', ...yara, url: 'https://shopee.com.br/product/1/2', imagem: 'i', linkAfiliado: 'https://s.shopee.com.br/abc' });
  const grupo = { nome: 'Perfumes', jid: '-1', mensagemAdicional: '', filtros: { diasSemRepetir: 5 } };
  assert.equal(await enviarProximo({ sendImage: async () => ({ comImagem: true }), sendText: async () => {} }, grupo, s), null, 'o que já estava na fila não sai');
  assert.equal(s.list()[0].status, 'REJEITADO');
});
