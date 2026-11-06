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
  { command: 'env', description: 'Muda uma chave do .env do servidor (/env NOME=valor)' },
  { command: 'fila', description: 'Por que um grupo não está postando (/fila Fitness)' },
  { command: 'ajuda', description: 'Lista os comandos' },
];

export const AJUDA = [
  '*Comandos do bot* 🤖',
  ...MENU.map((c) => `/${c.command} — ${c.description}`),
  '',
  'Mandar um link da Amazon, do Mercado Livre ou da Shopee aqui continua pondo a oferta na fila (e ela sai primeiro).',
  'Para escolher o grupo, escreva o nome dele numa linha da mensagem (ex.: fitness).',
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

const NOME_LOJA = { ml: 'ML', shopee: 'Shopee', amazon: 'Amazon', awin: 'Awin' };
const topo = (contagem, n = 3) => Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(' · ');

/**
 * /fila <grupo> (04/11/2026, o dono: "preciso entender por que o Fitness não tá saindo nada desde meio-dia"): o que tem
 * na fila, o que está segurando o próximo post agora e o que foi recusado/barrado desde o último post (ou 6 h).
 * `agoraPode` = { ritmo, shopee, awin, masculino } do momento (calculado em index.js com as regras do pipeline).
 * `genero(p)` = 'f' | 'm' | null.
 */
export function textoDaFila({ store, grupo, eventos = [], agora = Date.now(), tz = 'America/Sao_Paulo', agoraPode = {}, genero = () => null, nota = null }) {
  const nome = grupo.nome;
  const fila = store.list((p) => p.grupo === nome && (p.status === 'PRONTO' || p.status === 'PENDENTE'));
  const enviados = store.list((p) => p.grupo === nome && (p.status === 'ENVIADO' || p.status === 'INCERTO') && p.enviadoEm).sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)));
  const ultimo = enviados[0];
  const desde = Math.max(ultimo ? Date.parse(ultimo.enviadoEm) : 0, agora - 6 * 3_600_000);
  const porLoja = {};
  const porGenero = { femininos: 0, neutros: 0, masculinos: 0 };
  for (const p of fila) {
    const loja = p.tipo === 'cupom' ? 'cupom' : String(p.id).startsWith('AWF-') ? 'Awin (catálogo)' : NOME_LOJA[p.loja] || p.loja || 'ML';
    porLoja[loja] = (porLoja[loja] || 0) + 1;
    porGenero[{ f: 'femininos', m: 'masculinos' }[genero(p)] || 'neutros']++;
  }
  const recusas = {};
  const barradas = {};
  let entraram = 0;
  for (const e of eventos) {
    if (e?.grupo !== nome || !e.t || Date.parse(e.t) < desde) continue;
    if (e.tipo === 'na_fila') entraram++;
    else if (e.tipo === 'recusado' || e.tipo === 'sem_link') recusas[e.detalhe || e.tipo] = (recusas[e.detalhe || e.tipo] || 0) + 1;
    else if (e.tipo === 'barrado' || e.tipo === 'link_invalido' || e.tipo === 'duplicado') barradas[e.detalhe || e.tipo] = (barradas[e.detalhe || e.tipo] || 0) + 1;
  }
  // O que segura o grupo inteiro (nada sai) e o que segura só um tipo de oferta (as outras saem normalmente).
  // 05/11/2026, o dono: "Tem 55 na fila, mas está esperando: catálogo da Awin no limite do dia — vai postar ou não?"
  // O limite da Awin só segura os produtos do catálogo da Awin; os outros 50 e tantos saem.
  const tudo = [
    !grupo.ativo && 'o grupo está pausado em config/grupos.json',
    store.data.pausado && 'os posts estão pausados (/voltar)',
    agoraPode.ritmo === false && `limite do dia (${grupo.maxPorDia} posts) ou ainda não é a hora do próximo`,
  ].filter(Boolean);
  const ehAwin = (p) => String(p.id).startsWith('AWF-');
  const presos = (p) =>
    [
      agoraPode.shopee === false && p.loja === 'shopee' && 'Shopee esperando a vez (1 a cada N posts)',
      agoraPode.awin === false && ehAwin(p) && 'catálogo da Awin no limite do dia',
      agoraPode.masculino === false && genero(p) === 'm' && 'masculino esperando a vez (1 a cada N posts)',
    ].filter(Boolean);
  const livres = fila.filter((p) => !presos(p).length).length;
  const porque = [...new Set(fila.flatMap(presos))];
  const total = Object.values(recusas).reduce((s, n) => s + n, 0);
  let conclusao;
  if (!fila.length) conclusao = total ? `👉 *A fila está vazia*: as buscas acharam ${total} ofertas, mas nenhuma passou nas regras do grupo (motivos acima).` : '👉 *A fila está vazia* e as buscas não trouxeram nada novo para este grupo.';
  else if (tudo.length) conclusao = `👉 *Tem ${fila.length} na fila, mas nada sai agora*: ${tudo.join('; ')}.`;
  else if (!livres) conclusao = `👉 *Tem ${fila.length} na fila, mas todas estão esperando*: ${porque.join('; ')}.`;
  else conclusao = `👉 *Vai postar*: ${livres} de ${fila.length} podem sair no próximo horário de envio${porque.length ? ` (as outras ${fila.length - livres} esperam: ${porque.join('; ')})` : ''}.`;
  const recentes = enviados.slice(0, 3);
  const comNota = nota && ((p) => nota(p, { ultimo, recentes, agora }));
  const listaDaFila = () => {
    const podem = fila.filter((p) => !presos(p).length);
    const esperam = fila.filter((p) => presos(p).length);
    const linhas = ['', comNota ? '*Próximos a sair* (nota de 0 a 100, na ordem):' : '*Itens na fila:*', ...(podem.length ? itensDaFila(podem, 25, comNota) : ['(nenhum pode sair agora)'])];
    if (esperam.length) {
      const motivos = {};
      for (const p of esperam) for (const m of presos(p)) motivos[m] = (motivos[m] || 0) + 1;
      linhas.push('', `*Esperando a vez* (${esperam.length}): ${Object.entries(motivos).map(([m, n]) => `${n} — ${m}`).join('; ')}`, ...itensDaFila(esperam, 5, comNota));
    }
    return linhas;
  };
  const desdeTxt = new Date(desde).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return [
    `*Fila do ${nome}* 🔎`,
    `📦 Na fila: ${fila.length}${fila.length ? ` (${topo(porLoja, 5)}) — ${porGenero.femininos} femininos, ${porGenero.neutros} neutros, ${porGenero.masculinos} masculinos` : ''}`,
    ultimo ? `🕒 Último post: ${hhmm(ultimo.enviadoEm, tz)} (há ${duracao(agora - Date.parse(ultimo.enviadoEm))}) ${String(ultimo.nome).slice(0, 45)}` : '🕒 Nenhum post registrado',
    `📥 Desde ${desdeTxt}: ${entraram} entraram na fila, ${total} recusadas${total ? ` (${topo(recusas)})` : ''}`,
    ...(Object.keys(barradas).length ? [`🚫 Barradas na hora de postar: ${topo(barradas)}`] : []),
    '',
    conclusao,
    // O dono, 05/11/2026: "quando eu der um /fila, me exibe os itens, só o nome mesmo pra eu dar uma olhada".
    // Com a nota da oferta (src/ranking.js), na ordem em que vão sair: "78 · Whey Growth...".
    // 05/11/2026, o dono: "o que chega no grupo não é isso" — a lista mostrava no topo 40 Nike do catálogo da Awin, que
    // estavam presas no limite do dia. Agora a lista é só do que pode sair; as presas vêm depois, contadas por motivo.
    ...(fila.length ? listaDaFila() : []),
  ].join('\n');
}

/** Os nomes da fila (no máximo `max`; o resto vira "e mais N"), sem os caracteres que quebram o Markdown do Telegram. */
export function itensDaFila(fila, max = 40, nota = null) {
  const nomeLimpo = (p) => String(p.nome || p.id).replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
  // `nota(p)` = { nota, bruta } (src/ranking.js) ou um número: a ordem segue a soma, o texto mostra a nota de 0 a 100.
  const ler = (p) => { const r = nota(p); return typeof r === 'number' ? { nota: r, bruta: r } : r; };
  const ordem = nota ? fila.map((p) => [p, ler(p)]).sort((a, b) => b[1].bruta - a[1].bruta) : fila.map((p) => [p, null]);
  const linhas = ordem.slice(0, max).map(([p, n]) => (n == null ? `• ${nomeLimpo(p)}` : `${n.nota} · ${nomeLimpo(p)}`));
  return fila.length > max ? [...linhas, `… e mais ${fila.length - max}`] : linhas;
}
