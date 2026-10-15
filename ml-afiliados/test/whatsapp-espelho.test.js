import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { EspelhoWhatsApp, ligarPorNome, dentroDoHorario } = await import('../src/whatsapp-espelho.js');
const { Store } = await import('../src/store.js');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-wa-'));
const GRUPOS = [{ nome: 'Geral', ativo: true }, { nome: 'Fitness', ativo: true }, { nome: 'Beleza', ativo: true }, { nome: 'Perfumes', ativo: true }];
const MEIO_DIA = new Date('2026-10-15T12:00:00-03:00').getTime();

function montar({ falhar = false } = {}) {
  const store = new Store(path.join(pasta(), 'db.json'));
  const enviados = [];
  const sender = {
    typing: async () => {},
    listGroups: async () => [
      { jid: 'G@g.us', nome: 'Achadinhos da Vic · Geral' },
      { jid: 'F@g.us', nome: 'Achadinhos da Vic Fitness 💪' },
      { jid: 'B@g.us', nome: 'Beleza da Vic' },
      { jid: 'X@g.us', nome: 'Família' },
    ],
    sendImage: async (jid, img, txt) => {
      if (falhar) throw new Error('Evaluation failed');
      enviados.push([jid, img, txt]);
    },
    sendText: async (jid, txt) => enviados.push([jid, null, txt]),
  };
  const e = new EspelhoWhatsApp({ sender, store, carregarGrupos: () => GRUPOS, arquivoGrupos: path.join(pasta(), 'wa.json'), agora: () => MEIO_DIA, esperar: async () => {} });
  const publicar = (id, grupo, minutosAtras, extra = {}) => {
    store.data.produtos[`${grupo}:${id}`] = { id, grupo, nome: `Oferta ${id}`, status: 'ENVIADO', legenda: `*OFERTA ${id}*\nhttps://meli.la/${id}`, imagem: `https://img/${id}.jpg`, enviadoEm: new Date(MEIO_DIA - minutosAtras * 60_000).toISOString(), ...extra };
  };
  return { store, enviados, e, publicar };
}

test('grupos do WhatsApp achados pelo nome (só quando é um único grupo)', () => {
  const r = ligarPorNome(GRUPOS, [
    { jid: 'G@g.us', nome: 'Achadinhos da Vic · Geral' },
    { jid: 'P1@g.us', nome: 'Perfumes da Vic' },
    { jid: 'P2@g.us', nome: 'Perfume importado' },
    { jid: 'B@g.us', nome: 'Beleza' },
  ]);
  assert.deepEqual(r, { Geral: 'G@g.us', Beleza: 'B@g.us' }); // Perfumes: 2 grupos parecidos, não liga sozinho
});

test('espelho: revezando os grupos, a oferta mais recente de cada um, igual ao Telegram, nunca repetida', async () => {
  const { e, enviados, publicar } = montar();
  const r = await e.ligarGrupos();
  assert.deepEqual(r.faltando, ['Perfumes']);
  publicar('A1', 'Geral', 30);
  publicar('A2', 'Geral', 5);
  publicar('F1', 'Fitness', 10);
  publicar('V1', 'Geral', 90); // saiu há mais de 1 hora: não vai
  publicar('P1', 'Perfumes', 1); // Perfumes sem grupo no WhatsApp
  await e.enviarUma();
  await e.enviarUma();
  await e.enviarUma();
  await e.enviarUma();
  assert.deepEqual(enviados.map(([jid, , t]) => [jid, t.split('\n')[0]]), [
    ['G@g.us', '*OFERTA A2*'],
    ['F@g.us', '*OFERTA F1*'],
    ['G@g.us', '*OFERTA A1*'],
  ]);
  assert.equal(enviados[0][1], 'https://img/A2.jpg');
});

test('espelho: falha não repete a oferta; fora do horário não posta; foto do Telegram (file_id) vira só texto', async () => {
  const a = montar({ falhar: true });
  await a.e.ligarGrupos();
  a.publicar('A1', 'Geral', 5);
  assert.equal(await a.e.enviarUma(), null);
  assert.ok(a.store.data.whatsapp['Geral:A1'], 'marcada antes de enviar');
  assert.equal(await a.e.enviarUma(), null);

  const b = montar();
  await b.e.ligarGrupos();
  b.publicar('C1', 'Beleza', 5, { imagem: 'AgACAgEAAx0file_id_do_telegram' });
  await b.e.enviarUma();
  assert.deepEqual(b.enviados[0].slice(0, 2), ['B@g.us', null]);

  assert.equal(dentroDoHorario(new Date('2026-10-15T07:59:00-03:00')), false);
  assert.equal(dentroDoHorario(new Date('2026-10-15T08:00:00-03:00')), true);
  assert.equal(dentroDoHorario(new Date('2026-10-15T22:00:00-03:00')), false);
});
