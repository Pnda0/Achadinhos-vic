/**
 * Envio pelo Telegram (Bot API) — bom para testar sem risco de banir número de WhatsApp.
 *
 * .env:
 *   SENDER=telegram
 *   TELEGRAM_BOT_TOKEN=123456:ABC...   (do @BotFather; não compartilhe)
 * config/grupos.json: cada grupo ganha "telegram": "<chat id>" (ex.: "-1001234567890" ou "@meucanal").
 * Para descobrir o chat id: adicione o bot ao canal/grupo, poste qualquer coisa lá e rode `npm run telegram`.
 */
import { log, sleep } from './util.js';

const ATUALIZACOES = ['message', 'channel_post', 'my_chat_member', 'chat_member'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Converte a formatação do WhatsApp (*negrito*, ~riscado~) para o HTML do Telegram. */
export function paraHTML(texto) {
  return esc(texto)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:]|$)/gm, '$1<b>$2</b>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:]|$)/gm, '$1<s>$2</s>');
}

export class TelegramSender {
  constructor({ token = process.env.TELEGRAM_BOT_TOKEN?.trim() || '', fetchImpl = fetch } = {}) {
    this.tipo = 'telegram';
    this.token = token;
    this.fetch = fetchImpl;
    this.chats = new Map();
    this.offset = undefined;
  }

  async call(metodo, corpo = {}, tentativa = 0) {
    if (!this.token) throw new Error('Preencha TELEGRAM_BOT_TOKEN no .env (token do @BotFather).');
    const res = await this.fetch(`https://api.telegram.org/bot${this.token}/${metodo}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => ({}));
    if (json.ok) return json.result;
    const espera = json.parameters?.retry_after;
    if (res.status === 429 && espera != null && tentativa < 2) {
      log(`  ↪ Telegram pediu para esperar ${espera}s...`);
      await sleep((espera + 1) * 1000);
      return this.call(metodo, corpo, tentativa + 1);
    }
    throw new Error(`Telegram ${metodo}: ${json.description || `HTTP ${res.status}`}`);
  }

  async init() {
    const eu = await this.call('getMe');
    this.eu = eu;
    log(`✅ Telegram conectado: @${eu.username}`);
  }

  async typing(chatId, segundos) {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
    await sleep(Math.min(segundos, 5) * 1000);
  }

  async sendText(chatId, texto) {
    await this.call('sendMessage', { chat_id: chatId, text: paraHTML(texto), parse_mode: 'HTML', link_preview_options: { is_disabled: false } });
  }

  /** Foto pela URL (o Telegram baixa). Legenda > 1024 caracteres ou foto recusada: vai como texto com prévia. */
  async sendImage(chatId, imageUrl, legenda) {
    const html = paraHTML(legenda);
    if (imageUrl && html.length <= 1024) {
      try {
        await this.call('sendPhoto', { chat_id: chatId, photo: imageUrl, caption: html, parse_mode: 'HTML' });
        return { comImagem: true };
      } catch (e) {
        log(`  ↪ foto não foi (${String(e.message).split('\n')[0]}) — enviando só o texto.`);
      }
    }
    await this.sendText(chatId, legenda);
    return { comImagem: false };
  }

  anotarChat(u) {
    const chat = (u.message || u.channel_post || u.my_chat_member || u.chat_member || u.edited_message || u.edited_channel_post)?.chat;
    if (!chat) return;
    const nome = chat.title || (chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(' ')) || String(chat.id);
    this.chats.set(String(chat.id), { nome, jid: String(chat.id), tipo: chat.type });
  }

  /** Canais, grupos e conversas privadas que o bot já "viu" (via getUpdates). */
  async listGroups() {
    const updates = await this.call('getUpdates', { allowed_updates: ATUALIZACOES });
    for (const u of updates) this.anotarChat(u);
    return [...this.chats.values()];
  }

  /**
   * Mensagens novas que chegaram nos chats informados (para a caixa de entrada do espelho).
   * Devolve [{ id, jid, t (segundos), tipo, texto, foto }] — texto inclui os links "escondidos" atrás de
   * palavras; foto = file_id da imagem da mensagem (dá para reenviar sem baixar).
   */
  async lerMensagens(chatIds) {
    const updates = await this.call('getUpdates', { offset: this.offset, allowed_updates: ATUALIZACOES });
    const saida = [];
    for (const u of updates) {
      this.offset = u.update_id + 1; // confirma: o Telegram não manda esta de novo
      this.anotarChat(u);
      const m = u.message;
      if (!m || !chatIds.includes(String(m.chat.id))) continue;
      const ocultos = [...(m.entities || []), ...(m.caption_entities || [])].map((e) => e.url).filter(Boolean);
      saida.push({
        id: `tg-${m.chat.id}-${m.message_id}`,
        jid: String(m.chat.id),
        t: Number(m.date) || 0,
        tipo: m.photo ? 'image' : 'chat',
        texto: [m.text || m.caption || '', ...ocultos].join('\n').slice(0, 4000),
        foto: m.photo?.at(-1)?.file_id || null,
      });
    }
    return saida;
  }

  async close() {}
}
