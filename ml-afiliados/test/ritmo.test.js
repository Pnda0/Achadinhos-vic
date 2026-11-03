import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
process.env.SIMULAR_DIGITANDO = 'false';
const { ritmoLiberado, copiadaVencida, horasDeEnvio, enviarProximo } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');

const CRON = '*/3 8-21 * * *';
const novaStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-ritmo-')), 'db.json'));
const enviar = (s, grupo, id, quando) => {
  s.upsert({ id, grupo, nome: `Produto ${id}`, status: 'PRONTO', loja: 'ml', linkAfiliado: 'x' });
  s.setStatus(s.list((p) => p.id === id)[0], 'ENVIADO', { enviadoEm: new Date(quando).toISOString() });
};

test('ritmo: as horas do CRON_ENVIO viram a janela do dia', () => {
  assert.deepEqual(horasDeEnvio(CRON), [8, 21]);
  assert.deepEqual(horasDeEnvio('*/3 * * * *'), [0, 23]);
});

test('ritmo: com 40 por dia, 1 a cada 21 min (com folga de segundos do cron) e nunca mais de 40 no dia', () => {
  const B = { nome: 'Beleza', maxPorDia: 40 };
  const s = novaStore();
  const t0 = Date.parse('2026-11-03T10:00:05-03:00'); // o post sai uns segundos depois da hora do cron
  assert.equal(ritmoLiberado(s, B, t0, CRON), true, 'nada hoje: libera');
  enviar(s, 'Beleza', 'a', t0);
  assert.equal(ritmoLiberado(s, B, Date.parse('2026-11-03T10:18:00-03:00'), CRON), false, '18 min depois: ainda não');
  assert.equal(ritmoLiberado(s, B, Date.parse('2026-11-03T10:21:00-03:00'), CRON), true, '21 min depois: sai');
  assert.equal(ritmoLiberado(s, { nome: 'Beleza' }, t0 + 60_000, CRON), true, 'grupo sem limite: sempre libera');

  const s2 = novaStore();
  const ontem = Date.parse('2026-11-02T21:00:00-03:00');
  for (let i = 0; i < 39; i++) enviar(s2, 'Beleza', `h${i}`, Date.parse('2026-11-03T08:00:00-03:00') + i * 60_000);
  for (let i = 0; i < 10; i++) enviar(s2, 'Beleza', `o${i}`, ontem + i * 60_000); // ontem não conta
  enviar(s2, 'Fitness', 'f', Date.parse('2026-11-03T08:00:00-03:00')); // outro grupo não conta
  const tarde = Date.parse('2026-11-03T20:00:00-03:00');
  assert.equal(ritmoLiberado(s2, B, tarde, CRON), true, '39 hoje: ainda cabe 1');
  enviar(s2, 'Beleza', 'h39', Date.parse('2026-11-03T19:00:00-03:00'));
  assert.equal(ritmoLiberado(s2, B, tarde, CRON), false, '40 hoje: acabou o dia');
});

test('ritmo: copiada que esperou mais de 3 h na fila de um grupo com limite não sai; a da madrugada conta a partir das 8h', () => {
  const B = { nome: 'Beleza', maxPorDia: 40 };
  const copiada = (coletadoEm, extra = {}) => ({ origem: 'espelho', coletadoEm, ...extra });
  const meioDia = Date.parse('2026-11-03T12:00:00-03:00');
  assert.equal(copiadaVencida(copiada('2026-11-03T10:00:00-03:00'), B, meioDia, CRON), null, '2 h: ainda vale');
  assert.match(copiadaVencida(copiada('2026-11-03T08:30:00-03:00'), B, meioDia, CRON), /mais de 3 h/);
  assert.equal(copiadaVencida(copiada('2026-11-03T02:00:00-03:00'), B, Date.parse('2026-11-03T10:30:00-03:00'), CRON), null, 'da madrugada: conta desde as 8h');
  assert.match(copiadaVencida(copiada('2026-11-03T02:00:00-03:00'), B, Date.parse('2026-11-03T11:30:00-03:00'), CRON), /mais de 3 h/);
  assert.equal(copiadaVencida(copiada('2026-11-03T08:30:00-03:00', { manual: true }), B, meioDia, CRON), null, 'a que o dono mandou sempre sai');
  assert.equal(copiadaVencida({ origem: 'shopee', coletadoEm: '2026-11-03T08:00:00-03:00' }, B, meioDia, CRON), null, 'busca própria não vence');
  assert.equal(copiadaVencida(copiada('2026-11-03T08:30:00-03:00'), { nome: 'Fitness' }, meioDia, CRON), null, 'grupo sem limite: sai na hora, não precisa');
});

test('ritmo: no envio, o grupo com limite espera a vez sem avisar fila vazia', async () => {
  const s = novaStore();
  const grupo = { nome: 'Beleza', jid: '-1', mensagemAdicional: '', maxPorDia: 40, filtros: { diasSemRepetir: 5 } };
  const add = (id, nome) =>
    s.upsert({ id, grupo: 'Beleza', nome, loja: 'awin', url: `https://www.loja.com.br/${id}`, imagem: 'i', precoAtual: 100, precoOriginal: 200, descontoPct: 50, linkAfiliado: `https://www.awin1.com/pclick.php?p=${id}&a=1694399&m=17652` });
  add('AWP-1', 'Kit Shampoo Wella Invigo Feminino');
  add('AWP-2', 'Máscara Wella Invigo Feminina');
  const enviados = [];
  const sender = { sendImage: async (jid, img, legenda) => (enviados.push(legenda), { comImagem: true }), sendText: async () => {} };
  const p = await enviarProximo(sender, grupo, s);
  assert.equal(p?.status, 'ENVIADO');
  assert.deepEqual(await enviarProximo(sender, grupo, s), { esperando: true }, 'logo depois: espera a vez');
  assert.equal(enviados.length, 1);
});
