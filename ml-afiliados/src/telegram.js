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
    const arquivo = corpo instanceof FormData; // upload de arquivo: o fetch monta o multipart sozinho
    const res = await this.fetch(`https://api.telegram.org/bot${this.token}/${metodo}`, {
      method: 'POST',
      headers: arquivo ? {} : { 'content-type': 'application/json' },
      body: arquivo ? corpo : JSON.stringify(corpo),
      signal: AbortSignal.timeout(arquivo ? 60_000 : 30_000),
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

  /** Baixa a foto aqui e envia o arquivo (para quando o Telegram não consegue baixar a URL sozinho). */
  async enviarFotoBaixada(chatId, imageUrl, html) {
    const res = await this.fetch(imageUrl, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`imagem HTTP ${res.status}`);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', html);
    form.set('parse_mode', 'HTML');
    form.set('photo', new Blob([await res.arrayBuffer()]), 'oferta.jpg');
    await this.call('sendPhoto', form);
  }

  /**
   * Foto pela URL (o Telegram baixa) ou por file_id. Se o Telegram não conseguir baixar a URL (acontece com as
   * fotos dos canais públicos), baixamos e enviamos o arquivo. Legenda > 1024 caracteres ou foto que não foi de
   * jeito nenhum: vai como texto com prévia.
   */
  async sendImage(chatId, imageUrl, legenda) {
    const html = paraHTML(legenda);
    if (imageUrl && html.length <= 1024) {
      try {
        await this.call('sendPhoto', { chat_id: chatId, photo: imageUrl, caption: html, parse_mode: 'HTML' });
        return { comImagem: true };
      } catch (e) {
        try {
          if (!/^https?:\/\//.test(imageUrl)) throw e;
          await this.enviarFotoBaixada(chatId, imageUrl, html);
          return { comImagem: true };
        } catch (e2) {
          log(`  ↪ foto não foi (${String(e2.message).split('\n')[0]}) — enviando só o texto.`);
        }
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
      const antes = this.chats.size;
      this.anotarChat(u);
      // Canal/grupo novo (ex.: o bot acabou de virar administrador): mostra o chat id para pôr em config/grupos.json.
      if (this.chats.size > antes) {
        const c = [...this.chats.values()].at(-1);
        if (c.tipo !== 'private') log(`📋 Chat novo do Telegram: ${c.nome} [${c.tipo}] = ${c.jid}`);
      }
      // O bot virou administrador de um canal/grupo: quem escuta (src/index.js) pode ligar o canal a um grupo.
      const adm = u.my_chat_member;
      if (adm && adm.chat?.type !== 'private' && ['administrator', 'creator'].includes(adm.new_chat_member?.status)) {
        await this.aoVirarAdmin?.({ chatId: String(adm.chat.id), titulo: adm.chat.title || '', tipo: adm.chat.type, quem: String(adm.from?.id || '') });
      }
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

  /** Link de convite do canal (o bot precisa ser administrador com permissão de convidar). Null se não puder. */
  async conviteDoCanal(chatId) {
    try {
      return (await this.call('createChatInviteLink', { chat_id: chatId, name: 'Site' }))?.invite_link || null;
    } catch {
      return null;
    }
  }

  async close() {}
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Qual grupo "em espera" combina com o título de um canal: o nome do grupo aparece como palavra no título
 * ("Achadinhos da Vic · Perfumes" -> Perfumes; plural e acento não importam). Só vale se combinar com UM grupo.
 */
export function grupoDoTitulo(titulo, grupos) {
  const palavras = semAcento(titulo).split(' ').map((p) => p.replace(/s$/, ''));
  const candidatos = grupos.filter((g) => g.emEspera && palavras.includes(semAcento(g.nome).replace(/s$/, '')));
  return candidatos.length === 1 ? candidatos[0] : null;
}
