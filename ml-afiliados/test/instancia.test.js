import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { botRodando, outrosBots, pedirParada, travarInstancia } from '../src/instancia.js';

const PORTA = 47999; // porta só dos testes (o bot usa a 47831)

test('trava de cópia única: a 2ª cópia é recusada e a trava volta a valer quando a 1ª sai', async () => {
  const a = await travarInstancia({ porta: PORTA });
  assert.equal(a.ok, true);
  const b = await travarInstancia({ porta: PORTA });
  assert.deepEqual(b, { ok: false, ocupada: true });
  a.soltar();
  await new Promise((r) => setTimeout(r, 50));
  const c = await travarInstancia({ porta: PORTA });
  assert.equal(c.ok, true);
  c.soltar();
});

test('trava de cópia única: porta ocupada por OUTRO programa não impede o bot de ligar', async () => {
  const outroPrograma = net.createServer((c) => c.end('HTTP/1.1 200 OK\r\n\r\n'));
  await new Promise((r) => outroPrograma.listen(PORTA, '127.0.0.1', r));
  try {
    const r = await travarInstancia({ porta: PORTA, timeoutMs: 500 });
    assert.equal(r.ok, true);
    assert.match(r.semTrava, /outro programa/);
  } finally {
    outroPrograma.close();
  }
  // programa que aceita a conexão e não responde nada: também não é o bot (tempo limite)
  const mudo = net.createServer(() => {});
  await new Promise((r) => mudo.listen(PORTA, '127.0.0.1', r));
  try {
    const r = await travarInstancia({ porta: PORTA, timeoutMs: 300 });
    assert.equal(r.ok, true);
  } finally {
    mudo.close();
  }
});

test('trava de cópia única: vale entre PROCESSOS (duas janelas do bot) e o sistema solta quando o processo morre', async () => {
  const a = await travarInstancia({ porta: PORTA });
  assert.equal(a.ok, true);
  const modulo = new URL('../src/instancia.js', import.meta.url).href;
  // outro processo (assíncrono: este aqui precisa continuar respondendo a assinatura da trava)
  const rodar = (codigo) =>
    new Promise((resolve) => {
      let out = '';
      const p = spawn(process.execPath, ['-e', codigo]);
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => resolve(out.trim()));
    });
  const outro = await rodar(`import('${modulo}').then(async (m) => { const r = await m.travarInstancia({ porta: ${PORTA} }); console.log(JSON.stringify(r)); process.exit(0); })`);
  assert.deepEqual(JSON.parse(outro), { ok: false, ocupada: true });
  a.soltar();
  // um processo que pega a trava e morre sem soltar: a porta é liberada pelo sistema
  await rodar(`import('${modulo}').then(async (m) => { await m.travarInstancia({ porta: ${PORTA} }); process.exit(0); })`);
  await new Promise((r) => setTimeout(r, 50));
  const depois = await travarInstancia({ porta: PORTA });
  assert.equal(depois.ok, true);
  depois.soltar();
});

test('reinício com calma: "npm run reiniciar" pede pela porta e o bot recebe; sem bot, ninguém responde', async () => {
  const porta = 47998;
  assert.equal(await pedirParada({ porta, timeoutMs: 500 }), false);
  assert.equal(await botRodando({ porta, timeoutMs: 500 }), false);
  let pedidos = 0;
  const t = await travarInstancia({ porta, aoPedirParada: () => pedidos++ });
  try {
    assert.equal(await botRodando({ porta }), true);
    assert.equal(pedidos, 0, 'só perguntar quem é não pede parada');
    assert.equal(await pedirParada({ porta }), true);
    assert.equal(pedidos, 1);
  } finally {
    t.soltar();
  }
});

test('"desligar" (npm run migrar) pede parada SEM religar; "parar" (npm run reiniciar) religa', async () => {
  const porta = 47997;
  const pedidos = [];
  const t = await travarInstancia({ porta, aoPedirParada: (op) => pedidos.push(op) });
  try {
    assert.equal(await pedirParada({ porta, religar: false }), true);
    assert.equal(await pedirParada({ porta }), true);
    assert.deepEqual(pedidos, [{ religar: false }, { religar: true }]);
  } finally {
    t.soltar();
  }
});

test('outras cópias do bot pelos processos do Windows (bot travado segurando a porta, 27/10/2026)', async () => {
  const saida = [
    '3676\tnode  src/index.js',
    '20124\tnode  src/index.js',
    String.raw`10244	"node" "C:\npx\build\src\bin\chrome-devtools-mcp.js"`,
    '999\tnode src/index.js',
    String.raw`55	"C:\nodejs\node.exe" D:\Github\ml-afiliados\src\index.js`,
    String.raw`77	"C:\nodejs\node.exe" "C:\nodejs\node_modules\npm\bin\npm-cli.js" start --silent`,
    '',
  ].join('\r\n');
  const executar = (cmd, args, opcoes, cb) => cb(null, saida);
  assert.deepEqual(await outrosBots({ plataforma: 'win32', eu: 999, executar }), [3676, 20124, 55], 'sem ele mesmo, sem outros programas node');
  assert.deepEqual(await outrosBots({ plataforma: 'win32', executar: (c, a, o, cb) => cb(new Error('sem powershell')) }), []);
  assert.deepEqual(await outrosBots({ plataforma: 'linux' }), []);
});
