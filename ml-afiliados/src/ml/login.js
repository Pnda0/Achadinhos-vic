/**
 * Login do Mercado Livre sem F12.
 * Abre uma janela do Chrome/Edge controlada pelo bot; você faz login normalmente (senha, código etc.)
 * e o bot guarda a sessão em data/cookies.txt + no perfil data/perfil-ml.
 * A senha é digitada por você direto no site do ML — o bot nunca a vê.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PERFIL_ML, launch, requireBrowserPath } from '../browser.js';
import { settings } from '../config.js';
import { COOKIE_FILE, extractCsrfToken } from './affiliate.js';
import { log, sleep } from '../util.js';

const LINKBUILDER = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
const LOGIN = `https://www.mercadolivre.com/jms/mlb/lgz/login?platform_id=ML&go=${encodeURIComponent(LINKBUILDER)}`;

/** Lê as etiquetas (tags) de afiliado que aparecem no HTML do Link Builder. */
export function extractTags(html) {
  const bloco = html.match(/"tags"\s*:\s*\[([^\]]*)\]/)?.[1] || '';
  return [...bloco.matchAll(/"tag"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export const cookiesToString = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');

/**
 * O bot só pode levar a janela de volta ao Link Builder quando você está "parado" numa página comum
 * do Mercado Livre (ex.: caiu na home depois de logar). Em qualquer tela de login/verificação — ou em
 * outro site (Google, etc.) — ele não mexe, senão interromperia o seu login no meio.
 */
export function emTelaDeLogin(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (!/(^|\.)mercadoli[vb]re\.com(\.br)?$/.test(u.hostname)) return true; // fora do ML: não interferir
  return /login|lgz|auth|security|registration|verif|challenge|captcha|signin|recover|password|otp|2fa|device|enter-/i.test(
    u.pathname + u.search
  );
}

/**
 * Página do Link Builder aberta de verdade (logada): tem o token CSRF e algum sinal de conta
 * (cookie de sessão "ssid" ou a lista de etiquetas no HTML). Sem login o ML responde 401.
 */
export function sessaoValida(html, cookies) {
  html = html || '';
  const temConta = cookies.some((c) => c.name === 'ssid' && c.value) || /"tags"\s*:\s*\[/.test(html);
  return !!extractCsrfToken(html) && temConta;
}

async function estado(page) {
  if (!page.url().startsWith(LINKBUILDER)) return { ok: false };
  const html = await page.content().catch(() => '');
  const cookies = await page.cookies(LINKBUILDER).catch(() => []);
  return { ok: sessaoValida(html, cookies), html, cookies };
}

/**
 * Cookies que o navegador mandaria para este endereço (mesmo critério de domínio do navegador).
 * `cookies` vem do DevTools: [{ name, value, domain }].
 */
export function cookiesParaHost(cookies, host = 'www.mercadolivre.com.br') {
  return cookies
    .filter((c) => {
      const d = String(c.domain || '').replace(/^\./, '').toLowerCase();
      return d && (host === d || host.endsWith(`.${d}`));
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Uma chamada ao DevTools do navegador (nível do navegador: não mexe em nenhuma página aberta). */
async function devtools(wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, erro) => {
    ws.onopen = ok;
    ws.onerror = () => erro(new Error('não consegui falar com o navegador'));
  });
  try {
    return await new Promise((ok, erro) => {
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === 1) m.error ? erro(new Error(m.error.message)) : ok(m.result);
      };
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    ws.close();
  }
}

/**
 * Abre um Chrome/Edge COMUM (sem automação: o ML recusa login e verificação em janela controlada por robô) com o
 * perfil do bot, no endereço pedido. Devolve `chamar(método)`, que fala com o navegador pelo DevTools sem mexer em
 * nenhuma página; falha enquanto o navegador ainda está subindo (e depois que a janela é fechada).
 */
export function abrirNavegadorComum(url, { perfil = PERFIL_ML, fetchImpl = fetch } = {}) {
  fs.mkdirSync(perfil, { recursive: true });
  const portaArq = path.join(perfil, 'DevToolsActivePort');
  fs.rmSync(portaArq, { force: true });
  for (const trava of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.rmSync(path.join(perfil, trava), { force: true });
  const navegador = spawn(
    requireBrowserPath(),
    [`--user-data-dir=${perfil}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--new-window', url],
    { detached: true, stdio: 'ignore' }
  );
  navegador.unref();
  let wsUrl = null;
  return async (method, params) => {
    try {
      if (!wsUrl) {
        const porta = fs.readFileSync(portaArq, 'utf8').split('\n')[0].trim();
        wsUrl = (await (await fetchImpl(`http://127.0.0.1:${porta}/json/version`)).json()).webSocketDebuggerUrl;
      }
      return await devtools(wsUrl, method, params);
    } catch (e) {
      wsUrl = null; // ainda subindo: tenta de novo
      throw e;
    }
  };
}

/**
 * Login com um Chrome/Edge COMUM (o Mercado Livre bloqueia janela controlada por automação).
 * O bot só abre o navegador com um perfil próprio e, de fora, confere de tempos em tempos se os
 * cookies da conta já existem; quando o Link Builder responde logado, guarda a sessão e fecha a janela.
 */
export async function loginMLNavegadorComum({ timeoutMin = 15, esperar = sleep, cookieFile = COOKIE_FILE, perfil = PERFIL_ML, fetchImpl = fetch } = {}) {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error('Aqui (Docker/servidor) não há tela para abrir a janela de login. Atualize os cookies pelo F12 do seu navegador e salve em data/cookies.txt (README, seção 3.2).');
  }
  const chamar = abrirNavegadorComum(LOGIN, { perfil, fetchImpl });
  log('👉 Abri o navegador: entre no Mercado Livre com a conta de afiliado. Pode demorar o quanto precisar (até 15 min) — a janela fecha sozinha no fim.');

  let conectou = false;
  const inicio = Date.now();
  const limite = inicio + timeoutMin * 60_000;
  while (Date.now() < limite) {
    await esperar(3000);
    let cookies;
    try {
      ({ cookies } = await chamar('Storage.getCookies'));
      conectou = true;
    } catch (e) {
      if (conectou) throw new Error('A janela foi fechada antes de concluir o login.');
      if (Date.now() - inicio > 90_000) throw new Error(`O navegador não abriu (${e.message}).`);
      continue;
    }
    if (!cookies.some((c) => c.name === 'ssid' && c.value && /mercadoli/.test(c.domain))) continue;
    // Tem sessão: confere que o Link Builder abre logado com esses cookies (como o bot vai usar).
    const cookieStr = cookiesParaHost(cookies);
    let html = '';
    try {
      const res = await fetchImpl(LINKBUILDER, { headers: { cookie: cookieStr, 'user-agent': settings.userAgent, accept: 'text/html' }, redirect: 'manual' });
      if (res.status === 200) html = await res.text();
    } catch {}
    if (!extractCsrfToken(html)) continue;
    fs.writeFileSync(cookieFile, cookieStr + '\n', 'utf8');
    const tags = extractTags(html);
    log(`✅ Login do ML salvo. Etiquetas da conta: ${tags.join(', ') || '(nenhuma encontrada)'}`);
    await chamar('Browser.close').catch(() => {});
    return { tags };
  }
  throw new Error('Tempo esgotado esperando o login do Mercado Livre.');
}

export async function loginML({ timeoutMin = 10, abrir = launch, esperar = sleep, cookieFile = COOKIE_FILE } = {}) {
  if (abrir === launch && process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error(
      'Aqui (Docker/servidor) não há tela para abrir a janela de login. Atualize os cookies pelo F12 do seu navegador e salve em data/cookies.txt (README, seção 3.2).'
    );
  }
  const browser = await abrir({ headless: false });
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(LINKBUILDER, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    if (!(await estado(page)).ok) {
      log('👉 Faça login no Mercado Livre na janela que abriu (tem 10 minutos). Não feche a janela.');
      await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    }

    const limite = Date.now() + timeoutMin * 60_000;
    let ultimaTentativa = 0;
    while (Date.now() < limite) {
      if (!browser.connected) throw new Error('A janela foi fechada antes de concluir o login.');
      const url = page.url();
      const e = await estado(page);
      if (e.ok) {
        fs.writeFileSync(cookieFile, cookiesToString(e.cookies) + '\n', 'utf8');
        const tags = extractTags(e.html);
        log(`✅ Login do ML salvo (${e.cookies.length} cookies). Etiquetas da conta: ${tags.join(', ') || '(nenhuma encontrada)'}`);
        return { tags };
      }
      if (!emTelaDeLogin(url) && Date.now() - ultimaTentativa > 20_000) {
        // Parado numa página comum do ML (home, por exemplo): tentar o Link Builder.
        ultimaTentativa = Date.now();
        await page.goto(LINKBUILDER, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
        if (!(await estado(page)).ok) {
          await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
        }
      }
      await esperar(2000);
    }
    throw new Error('Tempo esgotado esperando o login do Mercado Livre.');
  } finally {
    await browser.close().catch(() => {});
  }
}
