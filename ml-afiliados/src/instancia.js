/**
 * Uma cópia só do bot por vez. Duas cópias carregam o data/db.json na memória e cada uma posta a mesma
 * oferta — foi a causa das postagens duplicadas em 14/10/2026 (o 3-iniciar.bat aberto duas vezes).
 *
 * A trava é uma porta local (127.0.0.1:47831): só um processo consegue ocupá-la, e o Windows a libera
 * sozinho quando o processo morre (até em queda de energia) — não sobra arquivo de trava velho.
 * Quem segura a trava responde "ml-afiliados" a quem se conectar: se outro programa qualquer estiver usando
 * a porta, o bot percebe que não é ele e liga mesmo assim (só sem essa proteção).
 */
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
export function travarInstancia({ porta = PORTA_TRAVA, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const servidor = net.createServer((conexao) => {
      conexao.on('error', () => {}); // quem perguntou pode desconectar antes de ler: não derruba o bot
      conexao.end(`${ASSINATURA}\n`);
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

export const MSG_OUTRA_COPIA =
  'Já tem um bot rodando neste PC (outra janela do 3-iniciar.bat). Feche ESTA janela — duas cópias postariam cada oferta duas vezes.';
