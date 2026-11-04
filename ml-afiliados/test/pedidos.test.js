import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acompanharPedidos, criarPedido, guardarToken, respostasNoMain, textoDaResposta, tokenGitHub } from '../src/pedidos.js';

const resposta = (status, json) => ({ ok: status < 300, status, json: async () => json });

test('pedidos: a issue sai com o rótulo, o texto do dono e o token; o token vem do .env ou do arquivo', async () => {
  const chamadas = [];
  const fetchImpl = async (url, o) => (chamadas.push({ url, ...o, corpo: JSON.parse(o.body) }), resposta(201, { number: 7, html_url: 'https://github.com/Pnda0/Achadinhos-vic/issues/7' }));
  const r = await criarPedido('põe a Kerasys com mais destaque no Beleza', { token: 'tok123', fetchImpl });
  assert.deepEqual(r, { numero: 7, url: 'https://github.com/Pnda0/Achadinhos-vic/issues/7' });
  assert.equal(chamadas[0].url, 'https://api.github.com/repos/Pnda0/Achadinhos-vic/issues');
  assert.deepEqual(chamadas[0].corpo.labels, ['pedido-telegram']);
  assert.match(chamadas[0].corpo.title, /^Pedido do Telegram: põe a Kerasys/);
  assert.match(chamadas[0].corpo.body, /^põe a Kerasys com mais destaque no Beleza\n/);
  assert.equal(chamadas[0].headers.authorization, 'Bearer tok123');

  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-ped-')), 'github-token.txt');
  assert.equal(tokenGitHub({}, arq), null);
  guardarToken(' github_pat_x ', arq);
  assert.equal(tokenGitHub({}, arq), 'github_pat_x');
  assert.equal(tokenGitHub({ GITHUB_TOKEN: 'do-env' }, arq), 'do-env');
});

test('pedidos: a resposta é o commit "Pedido #N:" do main; feito avisa e reinicia, não feito só avisa; demora avisa 1 vez', async () => {
  const commits = [
    { sha: 'aaa1111', commit: { message: 'Pedido #7: Kerasys com peso 3 no Beleza\n\nA Kerasys agora passa na frente de todas as marcas.\n\nCo-Authored-By: Claude <noreply@anthropic.com>' } },
    { sha: 'bbb2222', commit: { message: 'Pedido #8: não feito — precisa do seu login\n\nIsso exige entrar na sua conta da Shopee.' } },
    { sha: 'ccc3333', commit: { message: 'Outro commit qualquer' } },
  ];
  const fetchImpl = async () => resposta(200, commits);
  const r = await respostasNoMain('2026-11-04T10:00:00Z', { fetchImpl });
  assert.deepEqual(Object.keys(r).sort(), ['7', '8']);
  assert.doesNotMatch(r['7'].mensagem, /Co-Authored-By/);
  assert.match(textoDaResposta(7, r['7'].mensagem), /^✅ \*Pedido #7\*: Kerasys com peso 3 no Beleza\n\nA Kerasys agora passa[\s\S]*Reiniciando/);
  assert.match(textoDaResposta(8, r['8'].mensagem), /^⚠️ \*Pedido #8\*: não feito/);

  const agora = Date.parse('2026-11-04T15:00:00Z');
  const salvos = [];
  const store = { data: { pedidos: {
    7: { criadoEm: '2026-11-04T14:50:00Z', url: 'u7' },
    8: { criadoEm: '2026-11-04T14:55:00Z', url: 'u8' },
    9: { criadoEm: '2026-11-04T12:00:00Z', url: 'u9' },
  } }, save: () => salvos.push(1) };
  const avisos = [];
  const mudou = await acompanharPedidos({ store, avisar: async (t) => avisos.push(t), token: null, fetchImpl, agora });
  assert.equal(mudou, true);
  assert.equal(avisos.length, 3);
  assert.match(avisos[2], /pedido #9 ainda não foi atendido/);
  assert.ok(store.data.pedidos[7].respondidoEm && store.data.pedidos[8].respondidoEm && !store.data.pedidos[9].respondidoEm);
  // Na rodada seguinte não repete nada.
  avisos.length = 0;
  assert.equal(await acompanharPedidos({ store, avisar: async (t) => avisos.push(t), token: null, fetchImpl, agora: agora + 60_000 }), false);
  assert.equal(avisos.length, 0);
});
