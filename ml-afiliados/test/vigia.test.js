import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoDeLigar, rodadaDaVigia } from '../src/vigia.js';

const DONO = '2078974860';
const msg = (id, texto, date, chat = DONO) => ({ update_id: id, message: { chat: { id: Number(chat), type: 'private' }, date, text: texto } });
const AGORA = Date.UTC(2026, 10, 3, 15, 0);

test('pedido de ligar: só /ligar do dono, depois do último atendido', () => {
  const ups = [msg(1, '/ligar', 100), msg(2, '/ligar', 200, '999'), msg(3, 'oi', 300), msg(4, '/ligar@achadinhosvic_bot', 400), { update_id: 5, channel_post: { chat: { id: -100 }, text: '/ligar' } }];
  assert.equal(pedidoDeLigar(ups, DONO).date, 400);
  assert.equal(pedidoDeLigar(ups, DONO, 400), null);
  assert.equal(pedidoDeLigar([msg(1, '/reiniciar', 100), msg(2, 'ligar', 200)], DONO), null);
});

function cenario(extra = {}) {
  const feito = { reiniciou: 0, ligou: 0, avisos: [] };
  const p = {
    agora: AGORA,
    estado: {},
    dono: DONO,
    habilitado: async () => true,
    servico: async () => ({ estado: 'active', desde: AGORA - 3_600_000 }),
    responde: async () => true,
    mensagens: async () => [],
    reiniciar: async () => feito.reiniciou++,
    ligar: async () => feito.ligou++,
    avisar: async (t) => feito.avisos.push(t),
    ...extra,
  };
  return { p, feito };
}

test('vigia: bot respondendo não mexe em nada; fora do início automático (voltou para o PC) não faz nada', async () => {
  const { p, feito } = cenario();
  assert.equal(await rodadaDaVigia(p), 'ligado');
  const fora = cenario({ habilitado: async () => false, servico: async () => ({ estado: 'inactive', desde: 0 }), mensagens: async () => [msg(1, '/ligar', 100)] });
  assert.equal(await rodadaDaVigia(fora.p), 'fora');
  assert.deepEqual([feito.reiniciou, fora.feito.ligou], [0, 0]);
});

test('vigia: bot travado (sem responder 2 rodadas seguidas) é reiniciado e o dono é avisado; ligando há pouco, espera', async () => {
  const { p, feito } = cenario({ responde: async () => false });
  assert.equal(await rodadaDaVigia(p), 'sem-resposta');
  assert.equal(feito.reiniciou, 0, 'uma rodada só pode ser um engasgo');
  assert.equal(await rodadaDaVigia(p), 'reiniciou');
  assert.equal(feito.reiniciou, 1);
  assert.match(feito.avisos[0], /travou.*reiniciei/);

  const ligando = cenario({ responde: async () => false, servico: async () => ({ estado: 'active', desde: AGORA - 2 * 60_000 }) });
  assert.equal(await rodadaDaVigia(ligando.p), 'ligando');
  assert.equal(await rodadaDaVigia(ligando.p), 'ligando');
  assert.equal(ligando.feito.reiniciou, 0, 'git pull e npm install antes de o bot abrir a porta');
});

test('vigia: no máximo 3 reinícios em 6 h — depois avisa uma vez só e para de tentar', async () => {
  const { p, feito } = cenario({ responde: async () => false });
  for (let i = 0; i < 3; i++) {
    await rodadaDaVigia(p);
    assert.equal(await rodadaDaVigia(p), 'reiniciou');
    p.agora += 10 * 60_000;
  }
  await rodadaDaVigia(p);
  assert.equal(await rodadaDaVigia(p), 'limite');
  await rodadaDaVigia(p);
  assert.equal(await rodadaDaVigia(p), 'limite');
  assert.equal(feito.reiniciou, 3);
  assert.equal(feito.avisos.filter((t) => /parei de tentar/.test(t)).length, 1);
  // Passadas as 6 h, volta a poder reiniciar.
  p.agora += 7 * 3_600_000;
  await rodadaDaVigia(p);
  assert.equal(await rodadaDaVigia(p), 'reiniciou');
});

test('vigia: parado de propósito só liga com o /ligar do dono, uma vez por pedido', async () => {
  const parado = { servico: async () => ({ estado: 'inactive', desde: 0 }) };
  const { p, feito } = cenario(parado);
  assert.equal(await rodadaDaVigia(p), 'desligado');
  assert.equal(feito.ligou, 0, 'sem pedido, respeita a parada');

  p.mensagens = async () => [msg(7, '/ligar', 1000)];
  assert.equal(await rodadaDaVigia(p), 'ligou');
  assert.equal(feito.ligou, 1);
  assert.match(feito.avisos[0], /Ligando o bot/);
  // Ainda parado na rodada seguinte (a mensagem continua lá até o bot ler): não liga de novo pelo mesmo pedido.
  assert.equal(await rodadaDaVigia(p), 'desligado');
  assert.equal(feito.ligou, 1);

  const comErro = cenario({ servico: async () => ({ estado: 'failed', desde: 0 }) });
  assert.equal(await rodadaDaVigia(comErro.p), 'reiniciou');
  const mexendo = cenario({ servico: async () => ({ estado: 'activating', desde: AGORA }), mensagens: async () => [msg(7, '/ligar', 1000)] });
  assert.equal(await rodadaDaVigia(mexendo.p), 'ocupado');
  assert.equal(mexendo.feito.ligou, 0);
});
