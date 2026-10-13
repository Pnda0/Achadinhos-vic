/**
 * Geração de links de afiliado (meli.la) — mesma técnica do workflow do curso:
 * usa a API interna do Link Builder do Mercado Livre com os cookies da SUA conta.
 *
 *  1. GET /afiliados/linkbuilder com os cookies -> o ML devolve cookies renovados (Set-Cookie)
 *     que são mesclados e salvos em data/cookies.txt (no curso isso ficava no Redis).
 *  2. POST /affiliate-program/api/v2/affiliates/createLink  { urls: [...], tag }
 *     -> { urls: [{ origin_url, short_url }] }
 *
 * Não é uma API oficial/documentada: se o ML mudar algo, é aqui que vai quebrar.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from '../config.js';
import { log } from '../util.js';

const BASE = 'https://www.mercadolivre.com.br';
const LINKBUILDER = `${BASE}/afiliados/linkbuilder`;
const CREATE_LINK = `${BASE}/affiliate-program/api/v2/affiliates/createLink`;
export const COOKIE_FILE = path.join(DATA_DIR, 'cookies.txt');

/** "a=1; b=2" -> Map */
export function parseCookieString(str) {
  const map = new Map();
  for (const part of String(str || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (k) map.set(k, part.slice(i + 1).trim());
  }
  return map;
}

/** Mescla os Set-Cookie da resposta na string de cookies atual (código "merge cookies" do curso). */
export function mergeCookies(cookieStr, setCookieHeaders = []) {
  const map = parseCookieString(cookieStr);
  for (const sc of setCookieHeaders) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i <= 0) continue;
    const k = first.slice(0, i).trim();
    const v = first.slice(i + 1).trim();
    const expired = /expires=Thu, 01 Jan 1970/i.test(sc) || /max-age=0\b/i.test(sc);
    if (expired || v === '' || v === 'deleted') map.delete(k);
    else map.set(k, v);
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Procura o token CSRF no HTML do Link Builder (o ML já usou formatos diferentes). */
export function extractCsrfToken(html) {
  const patterns = [
    /<meta\s+name="csrf-token"\s+content="([^"]+)"/i,
    /"csrfToken"\s*:\s*"([^"]+)"/,
    /"csrf_token"\s*:\s*"([^"]+)"/,
    /"_csrf"\s*:\s*"([^"]+)"/,
    /"csrf"\s*:\s*"([^"]+)"/,
    /name="_csrf"\s+value="([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1].length >= 16) return m[1];
  }
  return null;
}

/** Limpa o que foi colado do F12: BOM, prefixo "cookie:", aspas e quebras de linha. */
export function normalizeCookieText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n/g, ' ')
    .trim()
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

/**
 * Cookies salvos: data/cookies.txt (ou "cookies.txt.txt" — o Bloco de Notas do Windows
 * costuma acrescentar um .txt escondido) e, por último, ML_COOKIES do .env.
 *
 * Na nuvem (Render) não dá para editar o cookies.txt: renovar a sessão é colar os cookies novos
 * em ML_COOKIES. Por isso guardamos a "impressão digital" do ML_COOKIES já usado — quando ele
 * muda, o valor novo passa na frente do cookies.txt (que ficou com a sessão vencida).
 */
export function loadCookies(arquivos = [COOKIE_FILE, COOKIE_FILE + '.txt'], doEnv = settings.cookiesEnv) {
  let salvo = '';
  for (const arq of arquivos) {
    try {
      salvo = normalizeCookieText(fs.readFileSync(arq, 'utf8'));
      if (salvo) break;
    } catch {}
  }
  const env = normalizeCookieText(doEnv);
  if (!env) return salvo;

  const arqMarca = path.join(path.dirname(arquivos[0]), 'ml-cookies-env.sha256');
  const marca = crypto.createHash('sha256').update(env).digest('hex');
  let anterior = null;
  try {
    anterior = fs.readFileSync(arqMarca, 'utf8').trim();
  } catch {}
  if (anterior === marca) return salvo || env;
  try {
    fs.writeFileSync(arqMarca, marca + '\n', 'utf8');
  } catch {}
  // 1ª vez com um cookies.txt já salvo (login-ml ou renovação): ele é mais novo que o do .env.
  if (anterior === null && salvo) return salvo;
  try {
    fs.writeFileSync(arquivos[0], env + '\n', 'utf8');
  } catch {}
  return env;
}

function saveCookies(str) {
  fs.writeFileSync(COOKIE_FILE, str + '\n', 'utf8');
}

export class MLAffiliate {
  constructor({ tag = settings.affiliateTag, cookies = loadCookies(), csrfToken = settings.csrfToken, fetchImpl = fetch } = {}) {
    this.tag = tag;
    this.cookies = cookies;
    this.csrf = csrfToken || null;
    this.fetch = fetchImpl;
  }

  validate() {
    const faltando = [];
    if (!this.tag) faltando.push('ML_AFFILIATE_TAG');
    if (!this.cookies) faltando.push('ML_COOKIES (ou data/cookies.txt)');
    if (faltando.length) throw new Error(`Configure no .env: ${faltando.join(', ')}`);
  }

  headers(extra = {}) {
    return {
      'user-agent': settings.userAgent,
      'accept-language': 'pt-BR,pt;q=0.9',
      cookie: this.cookies,
      ...extra,
    };
  }

  /** Renova cookies e descobre o CSRF. Lança erro claro se a sessão expirou. */
  async refresh() {
    this.validate();
    const res = await this.fetch(LINKBUILDER, { headers: this.headers({ accept: 'text/html' }), redirect: 'manual' });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (setCookies.length) {
      this.cookies = mergeCookies(this.cookies, setCookies);
      saveCookies(this.cookies);
    }
    const location = res.headers.get('location') || '';
    // Sem login o ML responde 401 (testado em out/2026) ou redireciona para a tela de login.
    if (res.status === 401 || (res.status >= 300 && res.status < 400 && /login|lgz/i.test(location))) {
      throw new Error('Sessão do Mercado Livre expirada: faça login no navegador e pegue os cookies de novo (README → "Pegando os cookies").');
    }
    if (res.status === 200) {
      const html = await res.text();
      const token = extractCsrfToken(html);
      if (token) this.csrf = token;
    }
    if (!this.csrf) {
      log('⚠️  Não achei o x-csrf-token automaticamente. Se der erro 403, preencha ML_CSRF_TOKEN no .env (README).');
    }
    return { status: res.status, csrf: !!this.csrf };
  }

  /**
   * Gera links de afiliado para até ~20 URLs por chamada.
   * @returns {Promise<Map<string,string>>} urlOriginal -> link curto (meli.la)
   */
  async createLinks(urls) {
    this.validate();
    const res = await this.fetch(CREATE_LINK, {
      method: 'POST',
      headers: this.headers({
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        origin: BASE,
        referer: LINKBUILDER,
        ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
      }),
      body: JSON.stringify({ urls, tag: this.tag }),
    });
    const text = await res.text();
    if (!res.ok) {
      const dica = res.status === 401 || res.status === 403 ? ' (cookies expirados ou x-csrf-token inválido)' : '';
      throw new Error(`createLink HTTP ${res.status}${dica}: ${text.slice(0, 300)}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Resposta inesperada do createLink: ${text.slice(0, 300)}`);
    }
    const out = new Map();
    for (const u of data.urls || []) {
      const link = u.short_url || u.url || u.long_url;
      if (u.origin_url && link) out.set(u.origin_url, link);
    }
    return out;
  }
}
