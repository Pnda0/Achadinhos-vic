/**
 * Espelho no WhatsApp: o que sai no Telegram também vai para os grupos do WhatsApp — devagar, para o número não
 * ser banido (pedido do dono, 15/10/2026). Um número só para o bot (chip separado), 4 grupos novos.
 *
 *  - No máximo 1 mensagem a cada WHATSAPP_INTERVALO_MIN minutos (padrão 6) NO TOTAL, com alguns segundos de
 *    variação, só das 8h às 21h59; os grupos se revezam (Geral → Fitness → Beleza → Perfumes → ...).
 *  - Em cada vez: a oferta mais recente daquele grupo que já saiu no Telegram (na última hora) e ainda não foi
 *    para o WhatsApp — mesmo texto e mesma foto. Grupo sem oferta nova é pulado e a vez passa para o próximo.
 *  - Nunca repete no mesmo grupo: a oferta é marcada ANTES de enviar (sem resposta = não reenvia).
 *  - Cada grupo do bot só posta no grupo do WhatsApp com o nome EXATO de "whatsapp" em config/grupos.json
 *    (maiúsculas e acentos não importam). Sem nome configurado ou sem grupo com esse nome, não posta — nunca
 *    adivinha (em 15/10/2026 a adivinhação pelo nome mandou para o grupo errado).
 * Liga com WHATSAPP_ESPELHO=true no .env. Na 1ª vez abre o WhatsApp Web para escanear o QR code com o chip do bot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from './config.js';
import { evento } from './eventos.js';
import { log, normalizar, sleep } from './util.js';

const ARQUIVO_GRUPOS = path.join(DATA_DIR, 'whatsapp-grupos.json');
const UMA_HORA = 3_600_000;

export function lerGruposWhats(arquivo = ARQUIVO_GRUPOS) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
  } catch {
    return {};
  }
}

/**
 * Liga cada grupo do bot ao grupo do WhatsApp com o nome exato de `g.whatsapp` (maiúsculas, acentos e espaços
 * sobrando não importam; emoji conta). Só liga se houver UM grupo com esse nome. Devolve { ligados, problemas }.
 */
export function ligarPorNome(gruposBot, gruposWhats) {
  const chave = (t) => normalizar(t).replace(/\s+/g, ' ').trim();
  const ligados = {};
  const problemas = [];
  for (const g of gruposBot) {
    if (!g.whatsapp) {
      problemas.push(`${g.nome}: sem nome de grupo do WhatsApp em config/grupos.json ("whatsapp")`);
      continue;
    }
    const achados = gruposWhats.filter((w) => chave(w.nome) === chave(g.whatsapp));
    if (achados.length === 1) ligados[g.nome] = achados[0].jid;
    else problemas.push(achados.length ? `${g.nome}: há ${achados.length} grupos chamados "${g.whatsapp}"` : `${g.nome}: não achei o grupo "${g.whatsapp}" no WhatsApp do bot`);
  }
  return { ligados, problemas };
}

/** Horário em que o WhatsApp pode postar (o mesmo do envio do Telegram: 8h às 21h59, fuso do bot). */
export function dentroDoHorario(agora = new Date()) {
  const h = Number(agora.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: settings.tz }).slice(0, 2));
  return h >= 8 && h < 22;
}

export class EspelhoWhatsApp {
  constructor({ sender, store, carregarGrupos, avisos = null, intervaloMin = 6, arquivoGrupos = ARQUIVO_GRUPOS, agora = () => Date.now(), esperar = sleep }) {
    this.sender = sender;
    this.store = store;
    this.carregarGrupos = carregarGrupos;
    this.avisos = avisos;
    this.intervaloMs = Math.max(3, intervaloMin) * 60_000;
    this.arquivoGrupos = arquivoGrupos;
    this.agora = agora;
    this.esperar = esperar;
    this.vez = 0; // de qual grupo é a vez
    this.jids = {}; // só depois de ligarGrupos() (nome exato), nunca de uma lista antiga
  }

  /** Acha os grupos no WhatsApp pelo nome exato configurado (refeito a cada vez, nada velho fica). */
  async ligarGrupos() {
    const ativos = this.carregarGrupos().filter((g) => g.ativo !== false);
    const { ligados, problemas } = ligarPorNome(ativos, await this.sender.listGroups());
    this.jids = ligados;
    fs.mkdirSync(path.dirname(this.arquivoGrupos), { recursive: true });
    fs.writeFileSync(this.arquivoGrupos, JSON.stringify(this.jids, null, 2) + '\n');
    return { ligados: Object.keys(this.jids), problemas, faltando: ativos.map((g) => g.nome).filter((n) => !this.jids[n]) };
  }

  /** Links de convite dos grupos ligados (para o site), guardados em data/whatsapp-convites.json. */
  async convites(arquivo = path.join(path.dirname(this.arquivoGrupos), 'whatsapp-convites.json')) {
    const links = {};
    for (const [nome, jid] of Object.entries(this.jids)) {
      try {
        links[nome] = await this.sender.conviteDoGrupo(jid);
      } catch (e) {
        log(`  ⚠️  convite do WhatsApp ${nome}: ${String(e.message || e).split('\n')[0]} (o número do bot é admin?)`);
      }
    }
    fs.writeFileSync(arquivo, JSON.stringify(links, null, 2) + '\n');
    return links;
  }

  /** A próxima oferta a espelhar, revezando os grupos. Null se nenhum grupo tem oferta nova. */
  proxima() {
    const grupos = this.carregarGrupos().filter((g) => g.ativo !== false && this.jids[g.nome]);
    const ja = (this.store.data.whatsapp ??= {});
    for (let i = 0; i < grupos.length; i++) {
      const g = grupos[(this.vez + i) % grupos.length];
      const p = this.store
        .list((x) => x.grupo === g.nome && x.status === 'ENVIADO' && x.legenda && x.enviadoEm && this.agora() - new Date(x.enviadoEm).getTime() < UMA_HORA && !ja[`${g.nome}:${x.id}`])
        .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)))[0];
      if (p) {
        this.vez = (this.vez + i + 1) % grupos.length;
        return { grupo: g, p };
      }
    }
    return null;
  }

  /** Uma postagem (se houver). Devolve a oferta enviada, ou null. */
  async enviarUma() {
    if (!dentroDoHorario(new Date(this.agora()))) return null;
    const alvo = this.proxima();
    if (!alvo) return null;
    const { grupo, p } = alvo;
    const jid = this.jids[grupo.nome];
    // Marca ANTES de enviar: se o WhatsApp não responder, não reenvia (melhor perder uma do que repetir).
    this.store.data.whatsapp[`${grupo.nome}:${p.id}`] = new Date(this.agora()).toISOString();
    this.store.save();
    try {
      await this.sender.typing?.(jid, 4 + Math.random() * 6).catch(() => {});
      const temFoto = /^https?:\/\//.test(p.imagem || '') || /^assets\//.test(p.imagem || '');
      if (temFoto) await this.sender.sendImage(jid, p.imagem, p.legenda);
      else await this.sender.sendText(jid, p.legenda);
      evento('whatsapp', p);
      log(`📲 [WhatsApp ${grupo.nome}] ${String(p.nome).slice(0, 60)}`);
      return p;
    } catch (e) {
      const msg = String(e.message || e).split('\n')[0];
      evento('whatsapp_falhou', p, msg);
      log(`⚠️  [WhatsApp ${grupo.nome}] não foi (${msg}) — não vou repetir esta oferta.`);
      await this.avisos?.avisar('whatsapp', `*WhatsApp com problema* ⚠️\n${msg}`).catch(() => {});
      return null;
    }
  }

  /** Limpa as marcas de mais de 30 dias (chamado na limpeza diária). */
  podar(dias = 30) {
    const limite = this.agora() - dias * 86_400_000;
    for (const [k, t] of Object.entries(this.store.data.whatsapp || {})) if (new Date(t).getTime() < limite) delete this.store.data.whatsapp[k];
  }

  /** Laço: uma postagem, espera o intervalo (com até 60 s de variação), de novo. Nunca derruba o bot. */
  async rodar({ parar = () => false } = {}) {
    while (!parar()) {
      try {
        await this.enviarUma();
      } catch (e) {
        log(`⚠️  espelho do WhatsApp: ${String(e.message || e).split('\n')[0]}`);
      }
      await this.esperar(this.intervaloMs + Math.floor(Math.random() * 60_000));
    }
  }
}

