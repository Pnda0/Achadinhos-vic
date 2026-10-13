import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pingHeartbeat } from '../src/heartbeat.js';
import { settings } from '../src/config.js';

test('heartbeat: sem HEARTBEAT_URL não faz ping', async () => {
  settings.heartbeat.url = '';
  let chamou = false;
  assert.equal(await pingHeartbeat(async () => { chamou = true; return { ok: true }; }), false);
  assert.equal(chamou, false);
});

test('heartbeat: faz GET na URL configurada e reporta sucesso/falha sem lançar', async () => {
  settings.heartbeat.url = 'https://hc-ping.com/uuid-teste';
  const urls = [];
  assert.equal(await pingHeartbeat(async (u) => { urls.push(u); return { ok: true, status: 200 }; }), true);
  assert.deepEqual(urls, ['https://hc-ping.com/uuid-teste']);
  assert.equal(await pingHeartbeat(async () => ({ ok: false, status: 503 })), false);
  assert.equal(await pingHeartbeat(async () => { throw new Error('rede caiu'); }), false);
  assert.equal(await pingHeartbeat(async () => ({ ok: true, status: 200 })), true);
  settings.heartbeat.url = '';
});
