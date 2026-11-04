/**
 * Pedidos ao Claude pelo Telegram (pedido do dono, 04/11/2026: "passar uma instrução pelo telegram e que você acate e
 * use no robô e suba no git").
 *
 *   /pedir <o que quer>  no privado do bot -> vira uma issue no GitHub (rótulo "pedido-telegram"), com o token do dono
 *   (GITHUB_TOKEN no .env ou data/github-token.txt, gravado pelo /github <token>). A issue acorda a rotina do Claude na
 *   nuvem ("Pedidos do Telegram" em claude.ai/code/routines), que faz a mudança, roda os testes, anota em
 *   ml-afiliados/pedidos.md e sobe para o main num commit "Pedido #N: ...".
 *   O bot olha os commits do main a cada 5 min: achou o "Pedido #N", manda a resposta (o corpo do commit) para o dono e
 *   reinicia com calma para valer a versão nova.
 *
 * Só a conversa do dono chega aqui (src/espelho.js, comandos da caixa de entrada). O token nunca vai para o log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { log } from './util.js';

export const REPO = 'Pnda0/Achadinhos-vic';
export const ROTULO = 'pedido-telegram';
const API = 'https://api.github.com';
const ARQUIVO_TOKEN = path.join(DATA_DIR, 'github-token.txt');
const SEM_RESPOSTA_MS = 2 * 3_600_000;

export function tokenGitHub(env = process.env, arquivo = ARQUIVO_TOKEN) {
  if (env.GITHUB_TOKEN?.trim()) return env.GITHUB_TOKEN.trim();
  try {
    return fs.readFileSync(arquivo, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function guardarToken(token, arquivo = ARQUIVO_TOKEN) {
  fs.writeFileSync(arquivo, String(token).trim() + '\n', { mode: 0o600 });
}

const cabecalhos = (token) => ({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'achadinhos-bot',
  ...(token && { authorization: `Bearer ${token}` }),
});

async function github(caminho, { token, metodo = 'GET', corpo, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}${caminho}`, {
    method: metodo,
    headers: { ...cabecalhos(token), ...(corpo && { 'content-type': 'application/json' }) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${metodo} ${caminho.split('?')[0]}: HTTP ${res.status}${json?.message ? ` (${json.message})` : ''}`);
  return json;
}

/** O token é do dono e abre issue neste repositório? Devolve o login (ou lança o erro do GitHub). */
export async function conferirToken(token, { fetchImpl = fetch } = {}) {
  const repo = await github(`/repos/${REPO}`, { token, fetchImpl });
  if (!repo?.permissions?.push && !repo?.permissions?.triage) throw new Error('o token não tem acesso de escrita a este repositório');
  const eu = await github('/user', { token, fetchImpl }).catch(() => null);
  return eu?.login || 'ok';
}

/** Abre a issue do pedido. Devolve { numero, url }. */
export async function criarPedido(texto, { token, fetchImpl = fetch, agora = new Date() } = {}) {
  const titulo = `Pedido do Telegram: ${texto.replace(/\s+/g, ' ').slice(0, 70)}${texto.length > 70 ? '…' : ''}`;
  const corpo = `${texto}\n\n---\nPedido do dono pelo Telegram em ${agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Atendido pela rotina "Pedidos do Telegram" (ml-afiliados/src/pedidos.js).`;
  const r = await github(`/repos/${REPO}/issues`, { token, metodo: 'POST', corpo: { title: titulo, body: corpo, labels: [ROTULO] }, fetchImpl });
  return { numero: r.number, url: r.html_url };
}

/** Commits do main desde `desde` que respondem pedidos: { numero -> { mensagem, sha } }. */
export async function respostasNoMain(desde, { token, fetchImpl = fetch } = {}) {
  const lista = await github(`/repos/${REPO}/commits?sha=main&per_page=50&since=${encodeURIComponent(desde)}`, { token, fetchImpl });
  const saida = {};
  for (const c of lista || []) {
    const msg = String(c.commit?.message || '');
    const m = msg.match(/^Pedido #(\d+):/);
    if (m && !saida[m[1]]) saida[m[1]] = { mensagem: msg.replace(/\n*Co-Authored-By:.*$/gim, '').trim(), sha: c.sha };
  }
  return saida;
}

/** O texto que vai para o dono: o resumo do commit e a explicação (sem a linha "Pedido #N:"). */
export function textoDaResposta(numero, mensagem) {
  const [primeira, ...resto] = mensagem.split('\n');
  const resumo = primeira.replace(/^Pedido #\d+:\s*/, '');
  const corpo = resto.join('\n').trim();
  const naoFeito = /^n[aã]o feito/i.test(resumo);
  return `${naoFeito ? '⚠️' : '✅'} *Pedido #${numero}*: ${resumo}${corpo ? `\n\n${corpo}` : ''}${naoFeito ? '' : '\n\n🔁 Reiniciando para valer a versão nova.'}`.slice(0, 3900);
}

/**
 * Confere os pedidos em aberto (store.data.pedidos). Para cada um respondido no main: avisa o dono. Devolve true se
 * algum foi respondido com mudança (aí o bot reinicia). Pedido sem resposta em 2 h: avisa uma vez.
 */
export async function acompanharPedidos({ store, avisar, token = tokenGitHub(), fetchImpl = fetch, agora = Date.now() }) {
  const abertos = Object.entries(store.data.pedidos || {}).filter(([, p]) => !p.respondidoEm);
  if (!abertos.length) return false;
  const desde = abertos.map(([, p]) => p.criadoEm).sort()[0];
  const respostas = await respostasNoMain(desde, { token, fetchImpl });
  let mudou = false;
  for (const [numero, p] of abertos) {
    const r = respostas[numero];
    if (r) {
      p.respondidoEm = new Date(agora).toISOString();
      p.sha = r.sha;
      const texto = textoDaResposta(numero, r.mensagem);
      if (!texto.startsWith('⚠️')) mudou = true;
      await avisar(texto);
      log(`📝 Pedido #${numero} respondido (${r.sha.slice(0, 7)}).`);
    } else if (!p.avisadoDemora && agora - Date.parse(p.criadoEm) > SEM_RESPOSTA_MS) {
      p.avisadoDemora = true;
      await avisar(`⏳ O pedido #${numero} ainda não foi atendido (2 h). Veja em ${p.url}`);
    }
  }
  store.save();
  return mudou;
}
