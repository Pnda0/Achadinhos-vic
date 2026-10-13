/**
 * Canais PÚBLICOS do Telegram como fonte do espelho (config/fontes.json > "canaisTelegram").
 *
 * Bot do Telegram não consegue ler canal dos outros, mas todo canal público tem uma página aberta
 * (https://t.me/s/<canal>) com as últimas mensagens. Lemos essa página — não a Amazon — e o espelho
 * troca o link pela etiqueta do dono e monta a oferta no nosso formato.
 */
import { settings } from './config.js';
import { log } from './util.js';

const PREFIXO = 'canal:';
export const jidDoCanal = (nome) => PREFIXO + String(nome).trim().replace(/^(https?:\/\/)?t\.me\/(s\/)?/i, '').replace(/^@/, '').replace(/\/.*$/, '');

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodificar = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (tudo, e) => {
    if (e[0] !== '#') return ENTIDADES[e.toLowerCase()] ?? tudo;
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : tudo;
  });

/** Mensagens da página t.me/s/<canal>: [{ id, jid, t (segundos), tipo, texto, foto }]. */
export function parseCanal(html, canal) {
  const saida = [];
  for (const bloco of String(html || '').split('<div class="tgme_widget_message_wrap').slice(1)) {
    const post = bloco.match(/data-post="([^"]+)"/)?.[1];
    const corpo = bloco.match(/<div class="tgme_widget_message_text js-message_text[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (!post || !corpo) continue;
    const links = [...corpo.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => decodificar(m[1]));
    const texto = decodificar(corpo.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    const data = bloco.match(/tgme_widget_message_date[^>]*><time datetime="([^"]+)"/)?.[1];
    const foto = bloco.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/)?.[1] || null;
    saida.push({
      id: `tgc-${post}`,
      jid: PREFIXO + canal,
      t: data ? Math.floor(new Date(data).getTime() / 1000) : 0,
      tipo: foto ? 'image' : 'chat',
      texto: [...new Set([texto, ...links])].join('\n').slice(0, 4000),
      foto,
    });
  }
  return saida;
}

/** "Sender" só de leitura para o Espelho: lê os canais pedidos; canal fora do ar não derruba os outros. */
export class LeitorDeCanais {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async lerMensagens(jids) {
    const saida = [];
    for (const jid of jids) {
      const canal = jid.slice(PREFIXO.length);
      try {
        const res = await this.fetch(`https://t.me/s/${canal}`, { headers: { 'user-agent': settings.userAgent }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const msgs = parseCanal(await res.text(), canal);
        if (!msgs.length) log(`  🪞 canal @${canal}: nenhuma mensagem (o canal existe e é público?)`);
        saida.push(...msgs);
      } catch (e) {
        log(`  🪞 canal @${canal} não abriu (${String(e.message).split('\n')[0]})`);
      }
    }
    return saida;
  }
}
