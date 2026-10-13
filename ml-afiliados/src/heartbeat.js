/**
 * Monitoramento externo (dead man's switch).
 *
 * O bot faz um GET em HEARTBEAT_URL de tempos em tempos. Se os pings pararem
 * (processo caiu, PC desligou, Render fora do ar), o serviço de monitoramento
 * (healthchecks.io, UptimeRobot heartbeat, Better Stack, cronitor...) avisa por
 * e-mail/Telegram — algo que o próprio bot não consegue fazer depois de morto.
 */
import cron from 'node-cron';
import { settings } from './config.js';
import { log } from './util.js';

let falhas = 0;

export async function pingHeartbeat(fetchImpl = fetch) {
  const url = settings.heartbeat.url;
  if (!url) return false;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (falhas) log('💓 Heartbeat voltou a responder.');
    falhas = 0;
    return true;
  } catch (e) {
    falhas++;
    // Só loga a 1ª falha e depois a cada 12 (≈1h no padrão) para não poluir o log.
    if (falhas === 1 || falhas % 12 === 0) log(`⚠️  Heartbeat falhou (${falhas}x): ${String(e.message).split('\n')[0]}`);
    return false;
  }
}

export function iniciarHeartbeat() {
  if (!settings.heartbeat.url) {
    log('💓 Heartbeat desligado (preencha HEARTBEAT_URL no .env para ser avisado se o bot cair).');
    return null;
  }
  const task = cron.schedule(settings.heartbeat.cron, () => pingHeartbeat(), { timezone: settings.tz });
  pingHeartbeat();
  log(`💓 Heartbeat ligado: "${settings.heartbeat.cron}"`);
  return task;
}
