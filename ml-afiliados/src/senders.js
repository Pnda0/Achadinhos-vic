/**
 * Formas de enviar para o WhatsApp. Todas têm a mesma interface:
 *   init()  sendImage(jid, imageUrl, legenda)  typing(jid, segundos)  listGroups()  close()
 *
 *  - wwebjs     -> whatsapp-web.js (o mesmo do seu promo-bot; lê QR code no terminal)
 *  - evolution  -> Evolution API (usada em um dos workflows do curso)
 *  - wuzapi     -> WuzAPI (a usada na versão v3 do curso)
 *  - console    -> não envia nada, só mostra a mensagem (para testar)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, settings } from './config.js';
import { requireBrowserPath } from './browser.js';
import { garantirPatchWwebjs } from './patch-wwebjs.js';
import { log, sleep } from './util.js';
import { TelegramSender } from './telegram.js';

/** Descobre o formato real da imagem pelos primeiros bytes (a extensão da URL nem sempre diz a verdade). */
export function detectarImagem(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { mimetype: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 4).toString('latin1') === '\x89PNG') return { mimetype: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mimetype: 'image/webp', ext: 'webp' };
  }
  return null;
}

async function downloadImage(url) {
  // Arte do próprio bot (pasta assets/, ex.: a do cupom): lê o arquivo, não baixa.
  if (/^assets\/[\w.-]+\.(jpe?g|png)$/i.test(url)) {
    const buf = fs.readFileSync(path.resolve(ROOT, url));
    buf.tipo = detectarImagem(buf);
    if (!buf.tipo) throw new Error(`a arte ${url} não é uma imagem`);
    return buf;
  }
  const res = await fetch(url, {
    headers: { 'user-agent': settings.userAgent, accept: 'image/jpeg,image/png;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`imagem HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tipo = detectarImagem(buf);
  if (!tipo) throw new Error(`a URL da imagem não devolveu uma imagem (${res.headers.get('content-type')}, ${buf.length} bytes)`);
  buf.tipo = tipo;
  return buf;
}

/** Erros de upload de mídia do WhatsApp Web — costumam passar sozinhos numa nova tentativa. */
const primeiraLinha = (e) => String(e?.message || e).split('\n')[0].slice(0, 160);

export const erroDeUpload = (e) => /upload|media entry|media-fault|mediaEntry/i.test(e?.message || '');

class ConsoleSender {
  async init() {}
  async typing() {}
  async sendImage(jid, imageUrl, legenda) {
    console.log('\n' + '─'.repeat(50));
    console.log(`📤 [TESTE] para ${jid}\n🖼️  ${imageUrl}\n`);
    console.log(legenda);
    console.log('─'.repeat(50) + '\n');
  }
  async sendText(jid, texto) {
    console.log(`\n📨 [TESTE] para ${jid}\n${texto}\n`);
  }
  async listGroups() {
    log('SENDER=console não conecta no WhatsApp. Troque SENDER no .env para listar grupos.');
    return [];
  }
  async close() {}
}

class WWebJsSender {
  async init() {
    // Precisa vir ANTES de carregar o whatsapp-web.js (veja src/patch-wwebjs.js).
    const patch = garantirPatchWwebjs();
    if (patch === 'aplicado') log('🩹 Correção de envio de imagem aplicada no whatsapp-web.js.');
    else if (patch !== 'ja-corrigido') log(`⚠️  Não consegui aplicar a correção de envio de imagem (${patch}). Se a imagem falhar, a oferta vai só com texto.`);
    const { default: wweb } = await import('whatsapp-web.js');
    const { default: qrcode } = await import('qrcode-terminal');
    this.MessageMedia = wweb.MessageMedia;
    this.client = new wweb.Client({
      authStrategy: new wweb.LocalAuth({ clientId: 'ml-afiliados' }),
      puppeteer: {
        executablePath: requireBrowserPath(), // Chrome/Edge já instalado no PC
        headless: !settings.whatsappJanela,
        args: process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : [],
      },
    });
    this.client.on('qr', (qr) => {
      log('📱 Escaneie o QR code com o WhatsApp do celular (Aparelhos conectados > Conectar um aparelho).');
      if (settings.whatsappJanela) log('   Ele aparece na janela do WhatsApp Web que abriu — e também aqui embaixo:');
      qrcode.generate(qr, { small: true });
    });
    this.client.on('disconnected', (motivo) => log(`⚠️  WhatsApp desconectou: ${motivo}`));
    const ready = new Promise((resolve, reject) => {
      this.client.once('ready', resolve);
      this.client.once('auth_failure', (m) => reject(new Error('Falha na autenticação do WhatsApp: ' + m)));
      setTimeout(() => reject(new Error('WhatsApp não conectou em 5 minutos (QR code não escaneado?).')), 5 * 60_000).unref();
    });
    await Promise.all([this.client.initialize(), ready]);
    log('✅ WhatsApp conectado');
  }
  /**
   * Mostra "digitando..." no grupo. Chama o estado direto na página do WhatsApp Web:
   * o client.getChatById() carrega os detalhes do grupo e vinha falhando (erro "r") nesta conta.
   */
  async typing(jid, segundos) {
    const estado = (s) => this.client.pupPage.evaluate((s, id) => window.WWebJS.sendChatstate(s, id), s, jid);
    await estado('typing');
    await sleep(segundos * 1000);
    await estado('stop');
  }
  /**
   * Envia a imagem com a legenda. Se o WhatsApp recusar o upload da imagem (acontece logo depois de
   * conectar, ou em redes que bloqueiam os servidores de mídia), tenta de novo duas vezes e, por
   * último, manda só o texto com o link (ENVIAR_SEM_IMAGEM=false desliga esse último recurso).
   */
  async sendImage(jid, imageUrl, legenda, { esperas = [0, 10, 25] } = {}) {
    const img = await downloadImage(imageUrl);
    const media = new this.MessageMedia(img.tipo.mimetype, img.toString('base64'), `oferta.${img.tipo.ext}`);
    // sendSeen:false = não marca as mensagens do grupo como lidas (e evita um erro comum do whatsapp-web.js)
    let erro;
    for (const espera of esperas) {
      if (espera) {
        log(`  ↪ a imagem não subiu (${primeiraLinha(erro)}) — nova tentativa em ${espera}s...`);
        await sleep(espera * 1000);
      }
      try {
        await this.client.sendMessage(jid, media, { caption: legenda, sendSeen: false });
        return { comImagem: true };
      } catch (e) {
        erro = e;
        if (!erroDeUpload(e)) break; // outro tipo de erro: esperar não resolve
      }
    }
    if (!settings.enviarSemImagem) throw erro;
    log(`  ↪ não deu para enviar com a imagem (${primeiraLinha(erro)}). Enviando só o texto com o link.`);
    try {
      await this.client.sendMessage(jid, legenda, { sendSeen: false });
    } catch (e2) {
      // Nem o texto foi: o problema não é a imagem. Mostra os dois erros.
      throw new Error(`${primeiraLinha(e2)} (com imagem: ${primeiraLinha(erro)})`, { cause: e2 });
    }
    return { comImagem: false };
  }
  async sendText(jid, texto) {
    await this.client.sendMessage(jid, texto, { sendSeen: false, linkPreview: true });
  }
  /** Link de convite do grupo (o número do bot precisa ser admin). */
  async conviteDoGrupo(jid) {
    const chat = await this.client.getChatById(jid);
    return `https://chat.whatsapp.com/${await chat.getInviteCode()}`;
  }
  /** JID de um número de telefone (só dígitos, com DDI 55). Null se o número não tiver WhatsApp. */
  async jidDoNumero(numero) {
    const r = await this.client.getNumberId(numero);
    return r?._serialized || null;
  }
  /**
   * Lista só os grupos (nome + JID). Usa uma leitura leve da lista de conversas:
   * o client.getChats() carrega os detalhes de TODAS as conversas e costuma falhar
   * ou demorar minutos em contas pessoais com muitas conversas.
   */
  async listGroups() {
    await sleep(3000); // dá um tempo para o WhatsApp terminar de carregar as conversas
    try {
      const grupos = await this.client.pupPage.evaluate(() => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        return chats
          .filter((c) => c.id && c.id.server === 'g.us')
          .map((c) => ({
            jid: c.id._serialized,
            nome: c.formattedTitle || c.name || (c.groupMetadata && c.groupMetadata.subject) || c.id.user,
          }));
      });
      if (grupos.length) return grupos;
      log('  (a lista rápida não trouxe grupos — tentando o modo completo, pode demorar)');
    } catch (e) {
      log(`  (lista rápida de grupos falhou: ${e.message} — tentando o modo completo, pode demorar)`);
    }
    const chats = await this.client.getChats();
    return chats.filter((c) => c.isGroup).map((c) => ({ nome: c.name, jid: c.id._serialized }));
  }
  /**
   * Últimas mensagens RECEBIDAS em cada grupo informado (para o espelho). Lê direto a lista de
   * conversas da página do WhatsApp Web, sem carregar detalhes do grupo nem baixar mídia.
   * Devolve [{ id, jid, t (segundos), tipo, texto }] — texto = legenda da foto ou corpo da mensagem.
   */
  async lerMensagens(jids, limite = 15) {
    return this.client.pupPage.evaluate(
      (jids, limite) => {
        const { Chat } = window.require('WAWebCollections');
        const { createWid } = window.require('WAWebWidFactory');
        const saida = [];
        for (const jid of jids) {
          let chat = null;
          try {
            chat = Chat.get(createWid(jid));
          } catch (e) {}
          const msgs = chat && chat.msgs && chat.msgs.getModelsArray ? chat.msgs.getModelsArray().slice(-limite) : [];
          for (const m of msgs) {
            if (!m || !m.id || m.id.fromMe) continue;
            const partes = [m.caption, m.type === 'chat' ? m.body : null, m.matchedText, m.canonicalUrl].filter((x) => typeof x === 'string' && x);
            saida.push({
              id: m.id._serialized || String(m.id),
              jid,
              t: Number(m.t) || 0,
              tipo: m.type,
              texto: [...new Set(partes)].join('\n').slice(0, 4000),
            });
          }
        }
        return saida;
      },
      jids,
      limite
    );
  }

  async close() {
    await sleep(3000); // deixa o WhatsApp Web gravar a sessão antes de fechar (senão pede o QR de novo)
    await this.client?.destroy();
  }
}

class EvolutionSender {
  constructor({ url, instance, apikey }) {
    this.base = url?.replace(/\/$/, '');
    this.instance = instance;
    this.apikey = apikey;
  }
  async call(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { apikey: this.apikey, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Evolution ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  async init() {
    if (!this.base || !this.instance || !this.apikey) throw new Error('Configure EVOLUTION_URL, EVOLUTION_INSTANCE e EVOLUTION_APIKEY');
  }
  async typing(jid, segundos) {
    await this.call('POST', `/chat/sendPresence/${this.instance}`, { number: jid, presence: 'composing', delay: segundos * 1000 });
  }
  async sendImage(jid, imageUrl, legenda) {
    await this.call('POST', `/message/sendMedia/${this.instance}`, {
      number: jid,
      mediatype: 'image',
      mimetype: 'image/jpeg',
      fileName: 'oferta.jpg',
      caption: legenda,
      media: imageUrl,
    });
  }
  async sendText(jid, texto) {
    await this.call('POST', `/message/sendText/${this.instance}`, { number: jid, text: texto });
  }
  async listGroups() {
    const r = await this.call('GET', `/group/fetchAllGroups/${this.instance}?getParticipants=false`);
    return (r || []).map((g) => ({ nome: g.subject, jid: g.id }));
  }
  async close() {}
}

class WuzapiSender {
  constructor({ url, token }) {
    this.base = url?.replace(/\/$/, '');
    this.token = token;
  }
  async call(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Token: this.token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`WuzAPI ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  async init() {
    if (!this.base || !this.token) throw new Error('Configure WUZAPI_URL e WUZAPI_TOKEN');
  }
  async typing(jid, segundos) {
    await this.call('POST', '/chat/presence', { Phone: jid, State: 'composing' });
    await sleep(segundos * 1000);
    await this.call('POST', '/chat/presence', { Phone: jid, State: 'paused' });
  }
  async sendImage(jid, imageUrl, legenda) {
    const img = await downloadImage(imageUrl);
    await this.call('POST', '/chat/send/image', {
      Phone: jid,
      Image: `data:${img.tipo.mimetype};base64,${img.toString('base64')}`,
      Caption: legenda,
    });
  }
  async sendText(jid, texto) {
    await this.call('POST', '/chat/send/text', { Phone: jid, Body: texto });
  }
  async listGroups() {
    const r = await this.call('GET', '/group/list');
    return (r?.data?.Groups || []).map((g) => ({ nome: g.Name, jid: g.JID }));
  }
  async close() {}
}

export function createSender(tipo = settings.sender) {
  switch (tipo) {
    case 'wwebjs':
      return new WWebJsSender();
    case 'evolution':
      return new EvolutionSender(settings.evolution);
    case 'wuzapi':
      return new WuzapiSender(settings.wuzapi);
    case 'telegram':
      return new TelegramSender();
    case 'console':
      return new ConsoleSender();
    default:
      throw new Error(`SENDER desconhecido: ${tipo}`);
  }
}
