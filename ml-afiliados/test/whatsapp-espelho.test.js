import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { EspelhoWhatsApp, ligarPorNome, dentroDoHorario } = await import('../src/whatsapp-espelho.js');
const { Store } = await import('../src/store.js');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-wa-'));
const GRUPOS = [
  { nome: 'Geral', ativo: true, whatsapp: 'Achadinhos Vic' },
  { nome: 'Fitness', ativo: true, whatsapp: 'Achadinhos Vic Fitness 💪' },
  { nome: 'Beleza', ativo: true, whatsapp: 'Beleza da Vic' },
  { nome: 'Perfumes', ativo: true },
];
const MEIO_DIA = new Date('2026-10-15T12:00:00-03:00').getTime();

function montar({ falhar = false } = {}) {
  const store = new Store(path.join(pasta(), 'db.json'));
  const enviados = [];
  const sender = {
    typing: async () => {},
    listGroups: async () => [
      { jid: 'G@g.us', nome: 'Achadinhos Vic' },
      { jid: 'F@g.us', nome: 'achadinhos vic fitness 💪 ' },
      { jid: 'B@g.us', nome: 'Beleza da Vic' },
      { jid: 'X@g.us', nome: 'Promoções Geral' }, // tem "Geral" no nome, mas não é o grupo (o erro de 15/10/2026)
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

test('grupos do WhatsApp: só pelo nome EXATO configurado; sem nome ou com nome repetido não liga (nunca adivinha)', () => {
  const r = ligarPorNome(
    [{ nome: 'Geral', whatsapp: 'Achadinhos Vic' }, { nome: 'Fitness', whatsapp: 'Vic Fitness' }, { nome: 'Beleza' }, { nome: 'Perfumes', whatsapp: 'Perfumes' }],
    [
      { jid: 'G@g.us', nome: 'ACHADINHOS VIC' },
      { jid: 'X@g.us', nome: 'Achadinhos Vic Geral' },
      { jid: 'P1@g.us', nome: 'Perfumes' },
      { jid: 'P2@g.us', nome: 'perfumes' },
    ]
  );
  assert.deepEqual(r.ligados, { Geral: 'G@g.us' });
  assert.equal(r.problemas.length, 3);
  const texto = r.problemas.join(' | ');
  assert.match(texto, /Fitness: não achei o grupo "Vic Fitness"/);
  assert.match(texto, /Beleza: sem nome/);
  assert.match(texto, /Perfumes: há 2 grupos/);
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

test('espelho: mesmas regras do Telegram no WhatsApp — feminino e marca primeiro, 1 masculino a cada N, só marcas, bloqueadas', async () => {
  const store = new Store(path.join(pasta(), 'db.json'));
  const enviados = [];
  const sender = { typing: async () => {}, listGroups: async () => [{ jid: 'P@g.us', nome: 'Perfumes' }], sendImage: async (jid, img, t) => enviados.push(t), sendText: async (jid, t) => enviados.push(t) };
  const grupos = [{ nome: 'Perfumes', ativo: true, whatsapp: 'Perfumes', preferirFeminino: 3, soMarcas: true, filtros: { palavrasBloqueadas: ['refil'] } }];
  const e = new EspelhoWhatsApp({ sender, store, carregarGrupos: () => grupos, arquivoGrupos: path.join(pasta(), 'wa.json'), agora: () => MEIO_DIA, esperar: async () => {} });
  await e.ligarGrupos();
  let min = 1;
  const publicar = (id, nome) => {
    store.data.produtos[`Perfumes:${id}`] = { id, grupo: 'Perfumes', nome, status: 'ENVIADO', legenda: nome, imagem: null, enviadoEm: new Date(MEIO_DIA - min++ * 60_000).toISOString() };
  };
  publicar('M1', 'Perfume Rabanne Invictus Masculino'); // o mais novo
  publicar('M2', 'Perfume Carolina Herrera Bad Boy');
  publicar('X1', 'Perfume Genérico Floral Feminino'); // sem marca da lista
  publicar('R1', 'Refil Perfume Dior Feminino'); // palavra bloqueada
  publicar('F1', 'Perfume Lattafa Yara');
  publicar('N1', 'Perfume Dior Unissex');
  for (let i = 0; i < 4; i++) await e.enviarUma();
  assert.deepEqual(enviados, ['Perfume Lattafa Yara', 'Perfume Dior Unissex', 'Perfume Rabanne Invictus Masculino']);
  // o próximo masculino espera: já foi 1 nos últimos 2
  assert.equal(await e.enviarUma(), null);
});
