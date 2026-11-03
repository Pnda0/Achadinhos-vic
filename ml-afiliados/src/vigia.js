#!/usr/bin/env node
/**
 * Vigia do bot no servidor Linux (pedido do dono, 03/11/2026: "ligar ou reiniciar o bot pelo celular"). O timer do
 * systemd (linux/ml-afiliados-vigia.timer) a roda a cada 2 min como o usuário bot, à parte do bot — funciona com ele
 * parado ou travado (com o bot ligado, quem responde aos comandos do Telegram é ele mesmo: src/comandos.js).
 *  - Bot travado: serviço ligado, mas sem responder na porta da trava (src/instancia.js) em 2 rodadas seguidas,
 *    passados 5 min desde que o serviço ligou (o git pull e o npm install contam). Reinicia e avisa o dono — no
 *    máximo 3 vezes em 6 h; depois só avisa (algo além de um travamento: precisa de alguém olhar).
 *  - Serviço parado de propósito (systemctl stop): só liga se o dono mandar /ligar no privado do bot. Parado, o bot
 *    não lê o Telegram: a vigia espia as mensagens SEM confirmá-las (o bot as lê quando ligar).
 *  - Serviço fora do início automático (systemctl disable — o bot voltou para o PC de casa): não faz nada.
 * Estado em data/vigia.json. `npm run vigia` roda uma rodada.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR } from './config.js';
import { botRodando } from './instancia.js';
import { ATUALIZACOES, TelegramSender } from './telegram.js';

const SERVICO = 'ml-afiliados';
const CARENCIA = 5 * 60_000; // ligando: git pull + npm install antes de o bot abrir a porta
const MAX_REINICIOS = 3;
const JANELA_REINICIOS = 6 * 3_600_000;
export const PEDIDO_LIGAR = /^\/ligar(?:@\w+)?$/i;

const arquivoEstado = (dir) => path.join(dir, 'vigia.json');
export function lerEstado(dir = DATA_DIR) {
  try {
    return JSON.parse(fs.readFileSync(arquivoEstado(dir), 'utf8')) || {};
  } catch {
    return {};
  }
}

/** O /ligar mais novo do dono (no privado do bot) depois do último atendido (`depoisDe`, em segundos). */
export function pedidoDeLigar(updates, dono, depoisDe = 0) {
  const m = (updates || [])
    .map((u) => u.message)
    .filter((m) => m && String(m.chat?.id) === String(dono) && Number(m.date) > depoisDe && PEDIDO_LIGAR.test(String(m.text || '').trim()));
  return m.at(-1) || null;
}

/**
 * Uma rodada. Tudo o que mexe fora daqui (systemctl, porta, Telegram) vem em `p`, para os testes. Mexe em `p.estado`
 * (gravado depois em data/vigia.json) e devolve o que fez:
 * 'fora' | 'ligado' | 'ligando' | 'sem-resposta' | 'reiniciou' | 'limite' | 'ocupado' | 'desligado' | 'ligou'.
 */
export async function rodadaDaVigia(p) {
  const { agora = Date.now(), estado, dono } = p;
  if (!(await p.habilitado())) return 'fora';
  const s = await p.servico();

  const reiniciar = async (motivo) => {
    estado.travado = 0;
    estado.reinicios = (estado.reinicios || []).filter((t) => agora - Date.parse(t) < JANELA_REINICIOS);
    if (estado.reinicios.length >= MAX_REINICIOS) {
      if (!estado.avisouLimite) {
        estado.avisouLimite = true;
        await p.avisar(`⚠️ O bot ${motivo} de novo. Já reiniciei ${MAX_REINICIOS} vezes nas últimas 6 horas, então parei de tentar: precisa de alguém olhar o servidor (peça ao Claude).`);
      }
      return 'limite';
    }
    estado.reinicios.push(new Date(agora).toISOString());
    await p.reiniciar();
    await p.avisar(`⚠️ O bot ${motivo} e eu reiniciei ele sozinho. Em 1 ou 2 minutos chega o "Bot ligado".`);
    return 'reiniciou';
  };

  if (s.estado === 'active') {
    if (await p.responde()) {
      estado.travado = 0;
      delete estado.avisouLimite;
      return 'ligado';
    }
    if (agora - s.desde < CARENCIA) return 'ligando';
    estado.travado = (estado.travado || 0) + 1;
    return estado.travado < 2 ? 'sem-resposta' : reiniciar('travou (não respondia havia uns 4 minutos)');
  }
  estado.travado = 0;
  if (s.estado === 'failed') return reiniciar('parou com erro');
  if (s.estado !== 'inactive') return 'ocupado'; // ligando ou desligando agora

  const pedido = pedidoDeLigar(await p.mensagens(), dono, estado.ultimoPedido || 0);
  if (!pedido) return 'desligado';
  estado.ultimoPedido = Number(pedido.date);
  await p.ligar();
  await p.avisar('🔌 Ligando o bot. Em 1 ou 2 minutos chega o "Bot ligado".');
  return 'ligou';
}

// Perguntas ao systemctl: a resposta vale mesmo com código de saída diferente de 0 (is-enabled de serviço desligado).
const consultar = (args) => new Promise((resolve) => execFile('systemctl', args, { timeout: 30_000 }, (e, saida) => resolve(String(saida || '').trim())));
// Ligar/reiniciar: erro (sudo negado, por exemplo) sobe e aparece no log da vigia.
const executar = (args) => new Promise((resolve, reject) => execFile('sudo', ['-n', 'systemctl', ...args], { timeout: 60_000 }, (e) => (e ? reject(e) : resolve())));

/** Estado do serviço: 'active' | 'inactive' | 'failed' | 'activating' | ..., e desde quando (ms). */
async function servico() {
  const saida = await consultar(['show', SERVICO, '-p', 'ActiveState', '-p', 'ActiveEnterTimestamp', '--timestamp=unix']);
  const v = Object.fromEntries(saida.split('\n').map((l) => l.split('=')));
  return { estado: v.ActiveState || 'desconhecido', desde: Number(String(v.ActiveEnterTimestamp || '').replace('@', '')) * 1000 || 0 };
}

async function main() {
  const dono = process.env.AVISOS_DESTINO_TELEGRAM?.trim();
  const tg = new TelegramSender();
  if (!dono || !tg.token) return console.log('Vigia: sem TELEGRAM_BOT_TOKEN ou AVISOS_DESTINO_TELEGRAM no .env.');
  const estado = lerEstado();
  const acao = await rodadaDaVigia({
    estado,
    dono,
    habilitado: async () => (await consultar(['is-enabled', SERVICO])) === 'enabled',
    servico,
    responde: () => botRodando({ timeoutMs: 5000 }),
    // Sem "offset": só espia, não confirma nada (o bot lê as mesmas mensagens quando ligar). Mesma lista de tipos do
    // bot: o Telegram guarda a última lista pedida, e uma menor faria o bot perder posts dos canais.
    mensagens: () => tg.call('getUpdates', { allowed_updates: ATUALIZACOES, timeout: 0 }),
    reiniciar: () => executar(['restart', SERVICO]),
    ligar: () => executar(['start', SERVICO]),
    avisar: (texto) => tg.sendText(dono, `🤖 ${texto}`).catch(() => {}),
  });
  fs.writeFileSync(arquivoEstado(DATA_DIR), JSON.stringify(estado, null, 1));
  if (!['ligado', 'fora', 'desligado'].includes(acao)) console.log(`Vigia: ${acao}`); // o normal não enche o log
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Sem internet, Telegram fora etc.: tenta de novo na próxima rodada.
  main().catch((e) => console.log(`Vigia: ${String(e.message || e).split('\n')[0]}`));
}
