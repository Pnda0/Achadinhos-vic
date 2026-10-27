/**
 * Uma cópia só do bot por vez. Duas cópias carregam o data/db.json na memória e cada uma posta a mesma
 * oferta — foi a causa das postagens duplicadas em 14/10/2026 (o 3-iniciar.bat aberto duas vezes).
 *
 * A trava é uma porta local (127.0.0.1:47831): só um processo consegue ocupá-la, e o Windows a libera
 * sozinho quando o processo morre (até em queda de energia) — não sobra arquivo de trava velho.
 * Quem segura a trava responde "ml-afiliados" a quem se conectar: se outro programa qualquer estiver usando
 * a porta, o bot percebe que não é ele e liga mesmo assim (só sem essa proteção).
 * Quem mandar "parar" pela porta (só do próprio PC: `npm run reiniciar`) pede um reinício com calma (index.js).
 */
import { execFile } from 'node:child_process';
import net from 'node:net';

export const PORTA_TRAVA = Number(process.env.BOT_PORTA_TRAVA) || 47831;
const ASSINATURA = 'ml-afiliados';

/** Quem está na porta é o bot? (conecta e lê a assinatura, com tempo limite) */
function ehOBot(porta, timeoutMs) {
  return new Promise((resolve) => {
    let lido = '';
    const s = net.connect({ port: porta, host: '127.0.0.1' });
    const fim = (r) => {
      s.destroy();
      resolve(r);
    };
    s.setTimeout(timeoutMs, () => fim(false));
    s.on('data', (d) => {
      lido += d;
      if (lido.includes(ASSINATURA)) fim(true);
    });
    s.on('end', () => fim(lido.includes(ASSINATURA)));
    s.on('error', () => fim(false));
  });
}

/**
 * Pega a trava. Devolve { ok: true, soltar } ou { ok: false, ocupada: true } se outra cópia do bot está rodando.
 * Se a porta não puder ser usada por outro motivo (outro programa nela, porta reservada pelo Windows), devolve
 * { ok: true, semTrava: motivo } — o bot liga mesmo assim, só sem essa proteção.
 */
export function travarInstancia({ porta = PORTA_TRAVA, timeoutMs = 1500, aoPedirParada = null } = {}) {
  return new Promise((resolve) => {
    const servidor = net.createServer((conexao) => {
      conexao.on('error', () => {}); // quem perguntou pode desconectar antes de ler: não derruba o bot
      conexao.setTimeout(3000, () => conexao.end());
      conexao.write(`${ASSINATURA}\n`);
      let lido = '';
      conexao.on('data', (d) => {
        lido += d;
        // "parar" = reiniciar com calma; "desligar" = parar sem religar (mudança para o servidor: npm run migrar).
        const pedido = lido.match(/\b(parar|desligar)\b/)?.[1];
        if (!pedido) return;
        conexao.end('ok\n');
        aoPedirParada?.({ religar: pedido === 'parar' });
      });
    });
    servidor.once('error', async (e) => {
      if (e.code !== 'EADDRINUSE') return resolve({ ok: true, semTrava: e.code || e.message, soltar: () => {} });
      if (await ehOBot(porta, timeoutMs)) return resolve({ ok: false, ocupada: true });
      resolve({ ok: true, semTrava: `porta ${porta} usada por outro programa`, soltar: () => {} });
    });
    servidor.listen(porta, '127.0.0.1', () => {
      servidor.unref(); // não segura o processo aberto sozinha
      resolve({ ok: true, soltar: () => servidor.close() });
    });
  });
}

/** Pede ao bot que está rodando neste PC para reiniciar com calma. true = havia um bot e ele recebeu o pedido. */
export function pedirParada({ porta = PORTA_TRAVA, timeoutMs = 3000, religar = true } = {}) {
  return new Promise((resolve) => {
    let lido = '';
    let pediu = false;
    const s = net.connect({ port: porta, host: '127.0.0.1' });
    const fim = (r) => {
      s.destroy();
      resolve(r);
    };
    s.setTimeout(timeoutMs, () => fim(false));
    s.on('data', (d) => {
      lido += d;
      if (lido.includes(ASSINATURA) && !pediu) {
        pediu = true;
        s.write(religar ? 'parar\n' : 'desligar\n');
      }
      if (/\bok\b/.test(lido)) fim(true);
    });
    s.on('end', () => fim(/\bok\b/.test(lido)));
    s.on('error', () => fim(false));
  });
}

/** O bot está rodando neste PC? */
export const botRodando = ({ porta = PORTA_TRAVA, timeoutMs = 1500 } = {}) => ehOBot(porta, timeoutMs);

export const MSG_OUTRA_COPIA =
  'Já tem um bot rodando neste PC (outra janela do 3-iniciar.bat). Feche ESTA janela — duas cópias postariam cada oferta duas vezes.';

/**
 * Outras cópias do bot rodando neste PC (Windows): os processos "node src/index.js" além deste. A porta não basta
 * quando um bot congela sem responder (27/10/2026: a janela parou às 8h02 segurando a porta) — o "reiniciar"
 * achava que não havia bot e abria uma segunda cópia. Devolve os números dos processos; [] fora do Windows ou se
 * não der para perguntar ao Windows.
 */
export function outrosBots({ plataforma = process.platform, executar = execFile, eu = process.pid } = {}) {
  if (plataforma !== 'win32') return Promise.resolve([]);
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
  return new Promise((resolve) => {
    executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 20_000, windowsHide: true }, (erro, saida) => {
      if (erro) return resolve([]);
      const linhas = String(saida || '').split(/\r?\n/).map((l) => l.split('\t'));
      resolve(linhas.filter(([pid, cmd]) => Number(pid) && Number(pid) !== eu && /(^|[\s"\\/])src[\\/]index\.js\b/.test(cmd || '')).map(([pid]) => Number(pid)));
    });
  });
}

export const MSG_BOT_TRAVADO = (pids) =>
  `Já tem um bot rodando neste PC (processo ${pids.join(', ')}) que não responde — provavelmente travado (um clique dentro da janela preta congela o bot até apertar uma tecla). Não ligo uma segunda cópia (cada oferta sairia duas vezes): feche a janela dele e ligue de novo.`;
