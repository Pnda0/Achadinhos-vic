import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export function loadCategorias() {
  return readJson('config/categorias.json');
}

/** Marcas que saem primeiro (config/marcas.json, src/marcas.js). Sem o arquivo: nenhuma. */
export function loadMarcas() {
  try {
    return readJson('config/marcas.json');
  } catch {
    return {};
  }
}

/**
 * Nichos (config/nichos.json): listas de palavras e títulos por tema. Sem arquivo = sem nichos.
 * As marcas de config/marcas.json entram nas palavras do nicho delas ("nichos": cabelo -> beleza...): um produto
 * Elseve vai para o Beleza mesmo sem "shampoo" no nome (pedido do dono, 15/10/2026).
 */
export function loadNichos() {
  let nichos;
  try {
    nichos = readJson('config/nichos.json');
  } catch {
    return {};
  }
  const marcas = loadMarcas();
  for (const [lista, nicho] of Object.entries(marcas.nichos || {})) {
    if (!nichos[nicho] || !Array.isArray(marcas[lista])) continue;
    const termos = marcas[lista].flatMap((m) => (typeof m === 'string' ? [m] : m.termos?.length ? m.termos : [m.marca])).filter((t) => t && !String(t).startsWith('re:'));
    nichos[nicho].obrigatorias = [...new Set([...(nichos[nicho].obrigatorias || []), ...termos])];
  }
  return nichos;
}

/**
 * Canais do Telegram ligados sozinhos pelo bot (grupo -> chat id), guardados em data/ para sobreviver
 * aos deploys. Valem quando o grupo não tem "telegram" preenchido em config/grupos.json.
 */
const CANAIS_FILE = path.join(DATA_DIR, 'canais-telegram.json');

export function canaisVinculados() {
  try {
    return JSON.parse(fs.readFileSync(CANAIS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function vincularCanal(grupo, chatId) {
  fs.writeFileSync(CANAIS_FILE, JSON.stringify({ ...canaisVinculados(), [grupo]: String(chatId) }, null, 2) + '\n', 'utf8');
}

export function loadGrupos() {
  const cfg = readJson('config/grupos.json');
  const nichos = loadNichos();
  const vinculados = canaisVinculados();
  return cfg.grupos.map((g) => {
    const nicho = (g.nicho && nichos[g.nicho]) || null;
    const telegram = g.telegram || vinculados[g.nome] || '';
    // Grupo ligado mas sem canal/grupo de destino fica "em espera": nada é buscado nem enviado para ele.
    const temDestino = settings.sender === 'console' || Boolean(settings.sender === 'telegram' ? telegram : g.jid && !g.jid.startsWith('COLE_AQUI'));
    const filtros = { ...cfg.filtrosPadrao, ...(g.filtros || {}) };
    if (nicho) {
      filtros.palavrasObrigatorias = [
        ...(nicho.obrigatorias || []),
        ...(nicho.extras || []),
        ...(filtros.palavrasObrigatorias || []),
      ];
      filtros.palavrasBloqueadas = [...(filtros.palavrasBloqueadas || []), ...(nicho.bloqueadas || [])];
    }
    return {
      ...g,
      // No Telegram o destino é o chat id do campo "telegram"; o JID do WhatsApp fica guardado em jidWhats.
      jidWhats: g.jid,
      jid: settings.sender === 'telegram' ? telegram || 'COLE_AQUI_O_CHAT_ID_DO_TELEGRAM' : g.jid,
      telegram,
      ativo: Boolean(g.ativo) && temDestino,
      emEspera: Boolean(g.ativo) && !temDestino,
      // O texto de exemplo ("SEU_CONVITE") nunca vai para o grupo.
      mensagemAdicional: /SEU_CONVITE/.test(g.mensagemAdicional || '') ? '' : g.mensagemAdicional || '',
      filtros,
      titulos: g.titulos || nicho?.titulos || null,
      tema: g.tema || nicho?.tema || null,
      // Só produtos do tema (nicho.obrigatorias) usam os títulos do tema; os "extras" usam os gerais.
      termosTema: nicho?.extras?.length ? nicho.obrigatorias || [] : null,
    };
  });
}

/** Grupos-fonte do espelho (config/fontes.json). Sem arquivo = espelho desligado. */
export function loadFontes() {
  try {
    const cfg = readJson('config/fontes.json');
    return { ativo: cfg.ativo !== false, fontes: (cfg.fontes || []).filter((f) => f && (f.nome || f.jid)), cfg };
  } catch {
    return { ativo: false, fontes: [], cfg: {} };
  }
}

const env = process.env;
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|sim|yes)$/i.test(v));

export const settings = {
  affiliateTag: env.ML_AFFILIATE_TAG?.trim() || '',
  cookiesEnv: env.ML_COOKIES?.trim() || '',
  csrfToken: env.ML_CSRF_TOKEN?.trim() || '',
  sender: (env.SENDER || 'console').toLowerCase(),
  evolution: { url: env.EVOLUTION_URL, instance: env.EVOLUTION_INSTANCE, apikey: env.EVOLUTION_APIKEY },
  wuzapi: { url: env.WUZAPI_URL, token: env.WUZAPI_TOKEN },
  simularDigitando: bool(env.SIMULAR_DIGITANDO, true),
  whatsappJanela: bool(env.WHATSAPP_JANELA, true),
  // Espelho no WhatsApp (src/whatsapp-espelho.js): o que sai no Telegram vai também, 1 mensagem a cada N minutos.
  whatsappEspelho: bool(env.WHATSAPP_ESPELHO, false),
  whatsappIntervaloMin: Number(env.WHATSAPP_INTERVALO_MIN) || 6,
  enviarSemImagem: bool(env.ENVIAR_SEM_IMAGEM, true),
  llm: { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL },
  cron: {
    coleta: env.CRON_COLETA || '0 7,12,17 * * *',
    envio: env.CRON_ENVIO || '*/8 8-21 * * *',
    limpeza: env.CRON_LIMPEZA || '0 0 * * *',
  },
  tz: env.TZ || 'America/Sao_Paulo',
  // Monitoramento externo (dead man's switch): URL de check (healthchecks.io, UptimeRobot heartbeat, Better Stack...).
  // O bot faz um GET nela de tempos em tempos; se os pings pararem, o serviço te avisa que o bot caiu.
  heartbeat: { url: env.HEARTBEAT_URL?.trim() || '', cron: env.CRON_HEARTBEAT || '*/5 * * * *' },
  // Alertas e resumo diário: nome de um grupo do WhatsApp (ex.: "Avisos do bot") ou número com DDD (ex.: 5579999998888).
  avisos: {
    destino: (env.SENDER || '').toLowerCase() === 'telegram' ? env.AVISOS_DESTINO_TELEGRAM?.trim() || '' : env.AVISOS_DESTINO?.trim() || '',
    resumoCron: env.CRON_RESUMO || '58 21 * * *', // antes das 22h: o PC pode desligar às 22h
  },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};
