import test from 'node:test';
import assert from 'node:assert/strict';
import { Espelho } from '../src/espelho.js';

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
