import { settings } from '../config.js';
import { parseOffersPage } from './parser.js';
import { loadCookies } from './affiliate.js';
import { findBrowserPath, sessaoNavegador } from '../browser.js';
import { log, randomDelay } from '../util.js';

/**
 * O ML marcou o acesso como suspeito ("account-verification" / "negative_traffic", visto em 21/10/2026): toda página
 * cai na verificação, até pelo navegador. Insistir só piora — quem recebe este erro para de pedir páginas ao ML.
 */
export class ErroBloqueioML extends Error {}
export const VERIFICACAO = /gz\/account-verification|negative_traffic|captcha\/wall/;

/** Monta a URL da página N de uma listagem de ofertas. */
export function pageUrl(url, page) {
  if (page <= 1) return url;
  const u = new URL(url);
  u.hash = '';
  u.searchParams.set('page', String(page));
  return u.toString();
}

/** Como fetchHtml, mas devolve também a URL final (depois dos redirecionamentos). */
export async function fetchPage(url, { cookies } = {}) {
  const res = await fetch(url, {
    headers: {
      'user-agent': settings.userAgent,
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      accept: 'text/html,application/xhtml+xml',
      ...(cookies ? { cookie: cookies } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  });
  return { status: res.status, url: res.url, html: await res.text() };
}

export async function fetchHtml(url, { cookies } = {}) {
  const res = await fetch(url, {
    headers: {
      'user-agent': settings.userAgent,
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      accept: 'text/html,application/xhtml+xml',
      ...(cookies ? { cookie: cookies } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao abrir ${url}`);
  return res.text();
}

/**
 * Baixa e interpreta uma página de ofertas.
 * 1ª tentativa: HTTP direto (rápido, como o nó "CARREGA HTML" do curso, que também manda os cookies).
 * Plano B: se o ML bloquear ou devolver uma página sem produtos, abre no Chrome/Edge do bot.
 */
// Leitura direta (HTTP) barrada pela verificação: até esta hora vai direto pelo navegador, sem insistir no HTTP
// (cada pedido barrado reforça a marca de "suspeito").
let httpBarradoAte = 0;
const HTTP_BARRADO_MS = 6 * 3_600_000;
export const _zerarHttpBarrado = () => (httpBarradoAte = 0); // testes

export async function obterProdutos(url, { http = fetchHtml, navegador = sessaoNavegador, temNavegador = !!findBrowserPath(), agora = Date.now() } = {}) {
  let motivo;
  if (agora < httpBarradoAte && temNavegador) motivo = 'leitura direta barrada pelo ML';
  else {
    try {
      const html = await http(url, { cookies: loadCookies() });
      if (VERIFICACAO.test(html)) {
        httpBarradoAte = agora + HTTP_BARRADO_MS;
        throw new ErroBloqueioML('o Mercado Livre pediu verificação (marcou o acesso como suspeito)');
      }
      const r = parseOffersPage(html);
      if (r.produtos.length) return r;
      motivo = 'página sem produtos via HTTP';
    } catch (e) {
      // Verificação na leitura direta: tenta uma vez pelo navegador (plano B de sempre); barrado lá também = pausa.
      if (e instanceof ErroBloqueioML && !temNavegador) throw e;
      motivo = e.message;
    }
  }
  if (!temNavegador) throw new Error(motivo);
  log(`  ↪ ${motivo} — tentando pelo navegador...`);
  let html;
  try {
    html = await navegador.html(url);
  } catch (e) {
    // 403 também no navegador = bloqueio, não página quebrada
    if (/HTTP 403/.test(e.message)) throw new ErroBloqueioML(`o Mercado Livre recusou também pelo navegador (${e.message.split('\n')[0]})`);
    throw e;
  }
  if (VERIFICACAO.test(html)) throw new ErroBloqueioML('o Mercado Livre pediu verificação também no navegador');
  const r = parseOffersPage(html);
  return { ...r, fonte: `${r.fonte}, navegador` };
}

/** Coleta os produtos de uma categoria (todas as páginas configuradas). */
export async function scrapeCategoria(cat) {
  const paginas = Math.max(1, cat.paginas || 1);
  const todos = [];
  for (let p = 1; p <= paginas; p++) {
    const url = pageUrl(cat.url, p);
    try {
      const { produtos, fonte } = await obterProdutos(url);
      log(`  ${cat.nome} p.${p}: ${produtos.length} produtos (via ${fonte})`);
      todos.push(...produtos.map((x) => ({ ...x, grupo: cat.grupo, categoria: cat.nome })));
      if (!produtos.length) break;
    } catch (e) {
      if (e instanceof ErroBloqueioML) throw e; // a coleta para de pedir páginas ao ML (pipeline.js)
      log(`  ⚠️  ${cat.nome} p.${p}: ${e.message}`);
      break;
    }
    if (p < paginas) await randomDelay(3, 8);
  }
  return todos;
}
