import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Espelho } from '../src/espelho.js';
import { AJUDA, MENU, textoDaFila, textoDoStatus } from '../src/comandos.js';
import { EspelhoWhatsApp } from '../src/whatsapp-espelho.js';
import { Store } from '../src/store.js';

function storeFalso() {
  const vistos = new Set();
  return { salvos: 0, jaViu: (id) => vistos.has(id), marcarVisto: (id) => vistos.add(id), save() { this.salvos++; }, contarFunil() {} };
}

test('comandos: /atualizar no privado do dono chama o comando (gravando o visto antes); em canal comum é ignorado', async () => {
  const agora = Date.now();
  const msgs = [
    { id: 'a', jid: 'dono', t: agora / 1000, texto: '/atualizar' },
    { id: 'b', jid: 'canal', t: agora / 1000, texto: '/atualizar' },
    { id: 'c', jid: 'dono', t: agora / 1000, texto: '/REINICIAR@achadinhosvic_bot' },
  ];
  const chamados = [];
  const store = storeFalso();
  const e = new Espelho({
    sender: { lerMensagens: async () => msgs, sendText: async () => {} },
    store,
    affiliate: null,
    fontes: [{ nome: 'Caixa de entrada', jid: 'dono', destino: 'Beleza', manual: true }, { nome: '@canal', jid: 'canal', destino: 'Beleza' }],
    grupos: [{ nome: 'Beleza' }],
    comandos: { '/atualizar': async (m) => chamados.push(m.id), '/reiniciar': async (m) => chamados.push(m.id) },
  });
  e.processar = async () => 'sem link do ML/Amazon';
  const r = await e.tick();
  assert.deepEqual(chamados, ['a', 'c']);
  assert.equal(r.novas, 1, 'o do canal segue o caminho normal');
  assert.ok(store.salvos >= 2, 'grava antes de reiniciar');
});

test('comandos: o menu do Telegram e a ajuda listam os mesmos comandos', () => {
  assert.deepEqual(MENU.map((c) => c.command), ['status', 'reiniciar', 'pausar', 'voltar', 'ligar', 'pedir', 'env', 'fila', 'ajuda']);
  for (const c of MENU) assert.match(AJUDA, new RegExp(`/${c.command} — `));
});

test('/status: ligado desde quando, posts e fila de hoje por grupo, WhatsApp, pausa e o último post', () => {
  const agora = new Date('2026-11-03T15:00:00-03:00').getTime();
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-cmd-')), 'db.json'));
  const p = (id, grupo, status, enviadoEm) => (store.data.produtos[`${grupo}:${id}`] = { id, grupo, nome: `Produto ${id}`, status, enviadoEm });
  p('a', 'Beleza', 'ENVIADO', '2026-11-03T13:10:00-03:00');
  p('b', 'Beleza', 'ENVIADO', '2026-11-03T14:40:00-03:00');
  p('c', 'Fitness', 'ENVIADO', '2026-11-02T20:00:00-03:00'); // ontem: não conta
  p('d', 'Fitness', 'PRONTO');
  p('e', 'Perfumes', 'PENDENTE');
  store.data.whatsapp = { 'Beleza:a': '2026-11-03T13:20:00-03:00', 'Fitness:c': '2026-11-02T20:10:00-03:00' };
  const grupos = [{ nome: 'Fitness', ativo: true }, { nome: 'Beleza', ativo: true, maxPorDia: 40 }, { nome: 'Perfumes', ativo: true }, { nome: 'Geral', ativo: false }];
  const texto = textoDoStatus({ store, grupos, agora, ligadoDesde: agora - 2 * 3_600_000 - 5 * 60_000, whatsapp: 'ligado' });
  assert.match(texto, /Ligado desde 03\/11.*12:55.*há 2 h 5 min/);
  assert.match(texto, /Postados hoje: Fitness 0 · Beleza 2 de 40 · Perfumes 0/);
  assert.match(texto, /WhatsApp: conectado — 1 mensagem/);
  assert.match(texto, /Na fila: Fitness 1 · Beleza 0 · Perfumes 1/);
  assert.match(texto, /Último post: 14:40 \(Beleza\) Produto b/);
  assert.doesNotMatch(texto, /pausados|Geral/);

  store.data.pausado = '2026-11-03T14:50:00-03:00';
  assert.match(textoDoStatus({ store, grupos, agora, ligadoDesde: agora, whatsapp: 'nao' }), /Posts pausados\* desde as 14:50[\s\S]*não conectado \(\/reiniciar/);
});

test('/fila: o que tem na fila, o que segura o post e por que as ofertas foram recusadas desde o último post', () => {
  const agora = new Date('2026-11-04T15:00:00-03:00').getTime();
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-fila-')), 'db.json'));
  const p = (id, status, extra = {}) => (store.data.produtos[`Fitness:${id}`] = { id, grupo: 'Fitness', nome: `Produto ${id}`, status, loja: 'ml', ...extra });
  p('ult', 'ENVIADO', { enviadoEm: '2026-11-04T12:02:00-03:00', nome: 'Legging Lupo' });
  p('AWF-1', 'PRONTO', { loja: 'awin', nome: 'Tênis Nike Masculino' });
  p('SHP-2', 'PRONTO', { loja: 'shopee', nome: 'Top Live Feminino' });
  const ev = (tipo, detalhe, t = '2026-11-04T13:00:00-03:00') => ({ t, tipo, grupo: 'Fitness', detalhe });
  const eventos = [ev('recusado', 'sem marca da lista'), ev('recusado', 'sem marca da lista'), ev('recusado', 'palavra bloqueada'), ev('na_fila'), ev('barrado', 'masculino'), ev('recusado', 'antigo', '2026-11-04T11:00:00-03:00'), { ...ev('recusado', 'outro grupo'), grupo: 'Beleza' }];
  const genero = (x) => (/masculino/i.test(x.nome) ? 'm' : /feminino/i.test(x.nome) ? 'f' : null);
  const texto = textoDaFila({ store, grupo: { nome: 'Fitness', ativo: true }, eventos, agora, genero, agoraPode: { ritmo: true, shopee: false, awin: true, masculino: false } });
  assert.match(texto, /Na fila: 2 \(Awin \(catálogo\) 1 · Shopee 1\) — 1 femininos, 0 neutros, 1 masculinos/);
  assert.match(texto, /Último post: 12:02 \(há 2 h 58 min\) Legging Lupo/);
  assert.match(texto, /Desde 12:02: 1 entraram na fila, 3 recusadas \(sem marca da lista 2 · palavra bloqueada 1\)/);
  assert.match(texto, /Barradas na hora de postar: masculino 1/);
  assert.match(texto, /Tem 2 na fila, mas está esperando\*: Shopee esperando a vez .*; masculino esperando a vez/);

  for (const x of Object.values(store.data.produtos)) if (x.status === 'PRONTO') x.status = 'REJEITADO';
  assert.match(textoDaFila({ store, grupo: { nome: 'Fitness', ativo: true }, eventos, agora, genero }), /A fila está vazia\*: as buscas acharam 3 ofertas, mas nenhuma passou/);
});

test('/pausar vale para o WhatsApp também: nada é espelhado até o /voltar', async () => {
  const meioDia = new Date('2026-11-03T12:00:00-03:00').getTime();
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-cmd-')), 'db.json'));
  store.data.produtos['Beleza:x'] = { id: 'x', grupo: 'Beleza', nome: 'Oferta x', status: 'ENVIADO', legenda: '*OFERTA*', enviadoEm: new Date(meioDia - 10 * 60_000).toISOString() };
  const enviados = [];
  const e = new EspelhoWhatsApp({
    sender: { listGroups: async () => [{ jid: 'B@g.us', nome: 'Beleza da Vic' }], sendText: async (jid, t) => enviados.push(t), typing: async () => {} },
    store, carregarGrupos: () => [{ nome: 'Beleza', ativo: true, whatsapp: 'Beleza da Vic' }],
    arquivoGrupos: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-cmd-')), 'wa.json'), agora: () => meioDia, esperar: async () => {},
  });
  await e.ligarGrupos();
  store.data.pausado = new Date(meioDia).toISOString();
  assert.equal(await e.enviarUma(), null);
  delete store.data.pausado;
  assert.equal((await e.enviarUma())?.id, 'x');
  assert.equal(enviados.length, 1);
});
