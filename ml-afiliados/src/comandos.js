/**
 * Comandos do dono no privado do @achadinhosvic_bot (pedido do dono, 03/11/2026: "ligar ou reiniciar o bot pelo
 * celular... e outras funções"). Só a conversa do dono é lida (src/espelho.js, fonte "manual"). O menu aparece no
 * botão "/" da conversa dele (setMyCommands só para o chat do dono). Com o bot desligado ou travado quem atende o
 * /ligar é a vigia do servidor (src/vigia.js).
 */
import { diaLocal } from './util.js';

export const MENU = [
  { command: 'status', description: 'Como o bot está agora' },
  { command: 'reiniciar', description: 'Reinicia o bot (já com a versão nova do GitHub)' },
  { command: 'pausar', description: 'Para de postar nos grupos até o /voltar' },
  { command: 'voltar', description: 'Volta a postar nos grupos' },
  { command: 'ligar', description: 'Liga o bot se ele estiver desligado' },
  { command: 'pedir', description: 'Pede uma mudança no bot ao Claude (ex.: /pedir mais Kerasys)' },
  { command: 'ajuda', description: 'Lista os comandos' },
];

export const AJUDA = [
  '*Comandos do bot* 🤖',
  ...MENU.map((c) => `/${c.command} — ${c.description}`),
  '',
  'Mandar um link da Amazon, do Mercado Livre ou da Shopee aqui continua pondo a oferta na fila.',
].join('\n');

const hhmm = (iso, tz) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const duracao = (ms) => {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  return d ? `${d} d ${h % 24} h` : h ? `${h} h ${min % 60} min` : `${min} min`;
};

/** O texto do /status: ligado desde quando, pausa, posts de hoje, WhatsApp, fila e o último post. */
export function textoDoStatus({ store, grupos, agora = Date.now(), ligadoDesde, whatsapp, tz = 'America/Sao_Paulo' }) {
  const hoje = diaLocal(new Date(agora), tz);
  const ativos = grupos.filter((g) => g.ativo);
  const deHoje = (iso) => iso && diaLocal(new Date(iso), tz) === hoje;
  const enviados = store.list((p) => p.status === 'ENVIADO' && deHoje(p.enviadoEm));
  const porGrupo = (lista, comLimite = false) => ativos.map((g) => `${g.nome} ${lista.filter((p) => p.grupo === g.nome).length}${comLimite && g.maxPorDia ? ` de ${g.maxPorDia}` : ''}`).join(' · ');
  const naFila = store.list((p) => p.status === 'PRONTO' || p.status === 'PENDENTE');
  const noWhats = Object.values(store.data.whatsapp || {}).filter(deHoje).length;
  const ultimo = enviados.sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)))[0];
  return [
    '*Status do bot* 🤖',
    `✅ Ligado desde ${new Date(ligadoDesde).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (há ${duracao(agora - ligadoDesde)})`,
    ...(store.data.pausado ? [`⏸️ *Posts pausados* desde as ${hhmm(store.data.pausado, tz)} — /voltar para retomar`] : []),
    `📤 Postados hoje: ${porGrupo(enviados, true)}`,
    `📲 WhatsApp: ${whatsapp === 'ligado' ? `conectado — ${noWhats} mensagem(ns) hoje` : whatsapp === 'desligado' ? 'desligado no .env' : 'não conectado (/reiniciar manda um código novo)'}`,
    `📦 Na fila: ${porGrupo(naFila)}`,
    ...(ultimo ? [`🕒 Último post: ${hhmm(ultimo.enviadoEm, tz)} (${ultimo.grupo}) ${String(ultimo.nome).slice(0, 50)}`] : []),
  ].join('\n');
}
