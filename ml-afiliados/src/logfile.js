/**
 * Copia tudo o que aparece na tela (console.log / console.error) para data/bot.log,
 * com data e hora — assim dá para ver depois o que aconteceu, inclusive erros completos.
 */
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { DATA_DIR } from './config.js';

export const LOG_FILE = path.join(DATA_DIR, 'bot.log');
const MAX_BYTES = 2 * 1024 * 1024;

function escrever(nivel, args) {
  try {
    const texto = args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4 }))).join(' ');
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${nivel} ${texto}\n`);
  } catch {}
}

/** Erro completo (com a pilha) só no arquivo — na tela fica a mensagem curta. */
export function registrarErro(contexto, e) {
  escrever('ERRO', [`${contexto}: ${e?.stack || e}`]);
}

/**
 * Queda do bot (erro inesperado, ou sem internet por 30 min ao ligar): deixa data/.caiu para o 3-iniciar.bat ligar de
 * novo em 1 min. Em 28/10/2026 o bot ficou parado das 14h11 às 20h03 (sem internet ao ligar) e das 20h18 às 21h43
 * (erro de timeout), com a janela esperando uma tecla. Mais de 3 quedas seguidas com menos de 15 min entre elas é
 * algo que religar não resolve: aí não pede (a janela fica parada mostrando o erro). Devolve se pediu.
 */
export function pedirParaReligar({ dir = DATA_DIR, agora = Date.now() } = {}) {
  const arquivo = path.join(dir, '.quedas.json');
  let n = 1;
  try {
    const antes = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (agora - Date.parse(antes.em) < 15 * 60_000) n = antes.n + 1;
  } catch {}
  try {
    fs.writeFileSync(arquivo, JSON.stringify({ n, em: new Date(agora).toISOString() }));
    if (n > 3) return false;
    fs.writeFileSync(path.join(dir, '.caiu'), new Date(agora).toISOString());
    return true;
  } catch {
    return false;
  }
}

/** `aoCair`: chamado antes de sair por erro inesperado (o bot usa para pedir ao 3-iniciar.bat que o ligue de novo). */
export function instalarLogEmArquivo(nome = 'bot', { aoCair = null } = {}) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.antigo');
  } catch {}
  escrever('----', [`início: ${nome} (node ${process.version}, ${process.platform})`]);
  for (const [metodo, nivel] of [['log', 'INFO'], ['error', 'ERRO'], ['warn', 'AVISO']]) {
    const original = console[metodo].bind(console);
    console[metodo] = (...args) => {
      escrever(nivel, args);
      original(...args);
    };
  }
  process.on('unhandledRejection', (e) => registrarErro('unhandledRejection', e));
  process.on('uncaughtException', (e) => {
    registrarErro('uncaughtException', e);
    console.error(`❌ Erro inesperado: ${e?.message || e}`);
    try {
      aoCair?.(e);
    } catch {}
    process.exit(1);
  });
}
