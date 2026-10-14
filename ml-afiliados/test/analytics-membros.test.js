import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrarMembros, lerMembros, membrosDoDia, variacaoMembros } from '../src/analytics/membros.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-mb-'));
const grupos = [
  { nome: 'Fitness', jid: '-1001', ativo: true },
  { nome: 'Beleza', jid: '-1002', ativo: true },
  { nome: 'Desligado', jid: '-1003', ativo: false },
  { nome: 'SemCanal', jid: '', ativo: true },
];

test('membros: conta cada canal ativo; falha de um canal vira null e não derruba', async () => {
  const base = pasta();
  const pedidos = [];
  const sender = {
    tipo: 'telegram',
    call: async (metodo, corpo) => {
      pedidos.push([metodo, corpo.chat_id]);
      if (corpo.chat_id === '-1002') throw Object.assign(new Error('Telegram getChatMemberCount: sem resposta (tempo esgotado)'), { incerto: true });
      return 120;
    },
  };
  const r = await registrarMembros({ sender, grupos, base, agora: new Date('2026-10-14T21:50:00-03:00') });
  assert.deepEqual(r, { Fitness: 120, Beleza: null });
  assert.deepEqual(pedidos.map((p) => p[1]), ['-1001', '-1002']);
  assert.deepEqual(membrosDoDia('2026-10-14', base), { Fitness: 120, Beleza: null });
  // WhatsApp/console: não conta nada
  assert.equal(await registrarMembros({ sender: { tipo: 'wwebjs' }, grupos, base }), null);
});

test('membros: variação no dia, na semana e desde o início (dia sem registro usa o anterior)', () => {
  const todos = { '2026-10-01': { Fitness: 50 }, '2026-10-07': { Fitness: 80 }, '2026-10-13': { Fitness: 100, Beleza: null }, '2026-10-14': { Fitness: 110 } };
  assert.deepEqual(variacaoMembros(todos, 'Fitness', '2026-10-14'), { atual: 110, dia: 10, semana: 30, inicio: 60, desde: '2026-10-01' });
  assert.equal(variacaoMembros(todos, 'Beleza', '2026-10-14'), null);
  assert.deepEqual(lerMembros(pasta()), {});
});

test('membros: 2ª leitura no mesmo dia regrava; canal que falhou agora mantém o número de mais cedo', async () => {
  const base = pasta();
  const agora = new Date('2026-10-14T12:30:00-03:00');
  await registrarMembros({ sender: { tipo: 'telegram', call: async () => 10 }, grupos, base, agora });
  let n = 0;
  const call = async (m, c) => {
    if (c.chat_id === '-1002') throw new Error('falhou');
    return 12 + n++;
  };
  await registrarMembros({ sender: { tipo: 'telegram', call }, grupos, base, agora: new Date('2026-10-14T21:50:00-03:00') });
  assert.deepEqual(membrosDoDia('2026-10-14', base), { Fitness: 12, Beleza: 10 });
});
