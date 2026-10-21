#!/usr/bin/env node
/**
 * npm run ml-liberar — quando o Mercado Livre pede verificação/captcha ao bot (21/10/2026): abre o navegador do bot
 * (o mesmo perfil, data/perfil-ml) COM janela na página de ofertas, para o dono resolver o captcha uma vez.
 * Assim que a página mostra as ofertas, grava data/.ml-liberado e fecha; na próxima busca o bot tira a pausa do ML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { launch } from '../browser.js';
import { log, sleep } from '../util.js';
import { VERIFICACAO } from './scraper.js';

const URL_OFERTAS = 'https://www.mercadolivre.com.br/ofertas';
export const ARQUIVO_LIBERADO = path.join(DATA_DIR, '.ml-liberado');

const b = await launch({ headless: false });
const p = (await b.pages())[0] || (await b.newPage());
await p.bringToFront().catch(() => {});
await p.goto(URL_OFERTAS, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
log('🧩 Abri o Mercado Livre na janela do bot. Se aparecer captcha ou verificação, resolva ali — eu espero (até 15 min).');
let ok = false;
for (let i = 0; i < 180 && !ok; i++) {
  await sleep(5000);
  try {
    const url = p.url();
    const html = await p.content();
    ok = !VERIFICACAO.test(url + html) && /poly-card/.test(html);
    if (!ok && i % 12 === 0 && !/captcha|verification/.test(url)) await p.goto(URL_OFERTAS, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  } catch {}
}
if (ok) {
  fs.writeFileSync(ARQUIVO_LIBERADO, new Date().toISOString());
  log('✅ Mercado Livre liberado no navegador do bot. Na próxima busca ele volta a ler as ofertas.');
} else log('⏳ Não deu tempo (ou o captcha não foi resolvido). Rode de novo quando puder: npm run ml-liberar');
await b.close();
process.exit(ok ? 0 : 1);
