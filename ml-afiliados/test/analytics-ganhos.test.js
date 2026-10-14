import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrarAwin, lerAwin } from '../src/analytics/ganhos.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-gn-'));
const LINHA = {
  advertiserId: 17648, advertiserName: 'C&A BR', publisherId: 1694399, publisherName: 'PF - Nome do Titular', currency: 'BRL', clicks: 12,
  pendingNo: 2, pendingComm: 10.5, confirmedNo: 1, confirmedComm: 4.25, bonusNo: 0, bonusComm: 0, declinedNo: 1, declinedComm: 3,
};
const awinFalsa = (falhar = false) => {
  const pedidos = [];
  return {
    pedidos,
    configurada: () => true,
    publisher: async () => '1694399',
    chamar: async (metodo, caminho) => {
      pedidos.push([metodo, caminho]);
      if (falhar) throw new Error('Awin /publishers HTTP 500: erro');
      return [LINHA];
    },
  };
};

test('Awin: comissão pendente, aprovada e recusada separadas; sem nome do titular; só GET', async () => {
  const base = pasta();
  const awin = awinFalsa();
  const agora = new Date('2026-10-14T21:52:00-03:00');
  const r = await registrarAwin({ awin, base, agora });
  // 1ª vez: os 7 dias de trás + hoje (8) + o total de 30 dias
  assert.equal(awin.pedidos.length, 9);
  assert.ok(awin.pedidos.every(([m, c]) => m === 'GET' && /\/reports\/advertiser\?startDate=\d{4}-\d{2}-\d{2}&endDate=/.test(c)));
  const hoje = r.dias['2026-10-14'];
  assert.deepEqual(hoje.total, { cliques: 12, pendentes: { vendas: 2, comissao: 10.5 }, aprovadas: { vendas: 1, comissao: 4.25 }, recusadas: { vendas: 1, comissao: 3 } });
  assert.equal(r.periodo30.inicio, '2026-09-15');
  const texto = fs.readFileSync(path.join(base, 'awin.json'), 'utf8');
  assert.doesNotMatch(texto, /Titular|1694399|publisher/i);
  // 2ª vez no dia seguinte: só hoje, ontem e o total de 30 dias
  awin.pedidos.length = 0;
  await registrarAwin({ awin, base, agora: new Date('2026-10-15T21:52:00-03:00') });
  assert.equal(awin.pedidos.length, 3);
  assert.ok(lerAwin(base).dias['2026-10-15']);
});

test('Awin: API fora do ar ou sem token não derruba e não apaga o que já estava guardado', async () => {
  const base = pasta();
  await registrarAwin({ awin: awinFalsa(), base, agora: new Date('2026-10-14T21:52:00-03:00') });
  assert.equal(await registrarAwin({ awin: awinFalsa(true), base }), null);
  assert.ok(lerAwin(base).dias['2026-10-14']);
  assert.equal(await registrarAwin({ awin: { configurada: () => false }, base }), null);
  assert.equal(await registrarAwin({ base }), null);
});
