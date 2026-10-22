/**
 * Navegador controlado pelo bot (Puppeteer) usando o Chrome ou Edge JÁ INSTALADO no computador.
 * Serve para três coisas:
 *   1. login do Mercado Livre sem precisar copiar cookies pelo F12 (src/ml/login.js)
 *   2. plano B quando o ML recusar as chamadas HTTP diretas (baixar página / gerar link)
 *   3. o WhatsApp Web (whatsapp-web.js usa o mesmo executável)
 *
 * O perfil do navegador fica em data/perfil-ml — é ali que a sessão do ML permanece logada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// No Docker o perfil fica num volume próprio (ML_PERFIL_DIR): perfil do Chromium em pasta do Windows dá problema.
export const PERFIL_ML = process.env.ML_PERFIL_DIR || path.join(DATA_DIR, 'perfil-ml');
const LINKBUILDER = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';

/** Procura Chrome/Edge instalados. CHROME_PATH no .env tem prioridade. */
export function findBrowserPath(env = process.env, exists = fs.existsSync) {
  const pf = env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = env.LOCALAPPDATA || '';
  const candidatos = [
    env.CHROME_PATH,
    // Windows
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    local && `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  return candidatos.find((p) => exists(p)) || null;
}

export function requireBrowserPath() {
  const p = findBrowserPath();
  if (!p) {
    throw new Error(
      'Não encontrei Chrome nem Edge neste computador. Instale o Chrome ou informe o caminho em CHROME_PATH no .env.'
    );
  }
  return p;
}

/**
 * Opções que deixam o navegador mais leve (16/10/2026: o WhatsApp Web sozinho usava ~1 GB): sem GPU, sem
 * extensões nem tarefas de fundo, menos processos por site e cache de disco pequeno. No Linux, também sem sandbox
 * (servidor sem usuário gráfico) e sem a memória compartilhada /dev/shm (pequena em VPS/Docker).
 */
export const ARGS_LEVES = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-default-apps',
  '--disable-sync',
  '--mute-audio',
  '--disable-features=Translate,MediaRouter,OptimizationHints,site-per-process',
  '--renderer-process-limit=2',
  '--disk-cache-size=33554432',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : []),
];

export async function launch({ headless = true, userDataDir = PERFIL_ML } = {}) {
  const { default: puppeteer } = await import('puppeteer');
  fs.mkdirSync(userDataDir, { recursive: true });
  return puppeteer.launch({
    executablePath: requireBrowserPath(),
    headless,
    userDataDir,
    defaultViewport: null,
    args: [...ARGS_LEVES, ...(headless ? [] : ['--window-size=1100,800'])],
  });
}

/**
 * Sessão invisível reaproveitando o perfil logado no ML. Abre só quando precisa (plano B).
 */
export class BrowserSession {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  static disponivel() {
    return !!findBrowserPath() && fs.existsSync(PERFIL_ML);
  }

  async open() {
    if (this.browser) return;
    // Invisível, como sempre. Se o ML pedir verificação/captcha, o bot respeita e pausa (não tenta se disfarçar de pessoa).
    this.browser = await launch({ headless: true });
    this.page = (await this.browser.pages())[0] || (await this.browser.newPage());
  }

  /** HTML de uma página, como o navegador recebe do servidor. */
  async html(url) {
    await this.open();
    const res = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()} (navegador) em ${url}`);
    await this.page.waitForSelector('.poly-card, .ui-search-layout', { timeout: 10_000 }).catch(() => {});
    // A verificação do ML troca a URL: o scraper reconhece pelo endereço (ErroBloqueioML).
    const final = this.page.url();
    return (/account-verification/.test(final) ? `<!-- ${final} -->` : '') + (await this.page.content());
  }

  /** Gera links chamando o createLink de dentro da página do Link Builder (mesma sessão do login). */
  async createLinks(urls, tag) {
    await this.open();
    if (!this.page.url().startsWith(LINKBUILDER)) {
      const res = await this.page.goto(LINKBUILDER, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (!res || res.status() === 401 || !this.page.url().startsWith(LINKBUILDER)) {
        throw new Error('Sessão do Mercado Livre expirada no navegador do bot — rode: npm run login-ml');
      }
    }
    const r = await this.page.evaluate(
      async (urls, tag) => {
        const token = document.querySelector('meta[name="csrf-token"]')?.content;
        const res = await fetch('/affiliate-program/api/v2/affiliates/createLink', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/plain, */*',
            ...(token ? { 'x-csrf-token': token } : {}),
          },
          body: JSON.stringify({ urls, tag }),
        });
        return { status: res.status, text: await res.text() };
      },
      urls,
      tag
    );
    if (r.status !== 200) throw new Error(`createLink (navegador) HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    const out = new Map();
    for (const u of JSON.parse(r.text).urls || []) {
      if (u.origin_url && u.short_url) out.set(u.origin_url, u.short_url);
    }
    return out;
  }

  async close() {
    await this.browser?.close().catch(() => {});
    this.browser = this.page = null;
  }
}

/** Sessão compartilhada pelo processo (fechada no fim de cada tarefa). */
export const sessaoNavegador = new BrowserSession();
