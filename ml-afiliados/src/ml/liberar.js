#!/usr/bin/env node
/**
 * npm run ml-liberar — quando o Mercado Livre pede verificação ao bot (desde 21/10/2026; em 27/10 até a página de
 * ofertas aberta sem o bot, desta internet, caía em "account-verification"): abre um Chrome/Edge COMUM (o ML recusa
 * login e verificação em janela de automação) com o perfil do bot (data/perfil-ml) na página de ofertas, para o dono
 * passar pela verificação uma vez (entrar na conta, código...). Assim que a janela mostra as ofertas, grava
 * data/.ml-liberado e fecha; na próxima busca o bot tira a pausa do ML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { log, sleep } from '../util.js';
import { abrirNavegadorComum } from './login.js';
import { VERIFICACAO } from './scraper.js';

const URL_OFERTAS = 'https://www.mercadolivre.com.br/ofertas';
export const ARQUIVO_LIBERADO = path.join(DATA_DIR, '.ml-liberado');
const MINUTOS = 20;

const chamar = abrirNavegadorComum(URL_OFERTAS);
log(`🧩 Abri o Mercado Livre numa janela do Chrome. Se pedir verificação, entre na sua conta e siga os passos ali — eu espero (até ${MINUTOS} min).`);
// Página carregada (o título vira "... | Mercado Livre"; carregando, ele é o próprio endereço) e sem verificação.
const ehOfertas = (a) => a.type === 'page' && /^https:\/\/www\.mercadolivre\.com\.br\/ofertas/.test(a.url) && !VERIFICACAO.test(a.url) && /mercado livre/i.test(a.title || '');
let ok = false;
let seguidas = 0; // a aba precisa ficar nas ofertas por duas conferidas (o redirecionamento leva um instante)
let conectou = false;
const inicio = Date.now();
while (!ok && Date.now() - inicio < MINUTOS * 60_000) {
  await sleep(5000);
  let abas;
  try {
    ({ targetInfos: abas } = await chamar('Target.getTargets'));
    conectou = true;
  } catch {
    if (conectou || Date.now() - inicio > 90_000) break; // janela fechada, ou o navegador não abriu
    continue;
  }
  seguidas = abas.some(ehOfertas) ? seguidas + 1 : 0;
  ok = seguidas >= 2;
}
if (ok) {
  fs.writeFileSync(ARQUIVO_LIBERADO, new Date().toISOString());
  log('✅ Mercado Livre liberado no navegador do bot. Na próxima busca ele volta a ler as ofertas.');
} else log(conectou ? '⏳ Não deu tempo (ou a verificação não terminou). Rode de novo quando puder: npm run ml-liberar' : '⚠️  O navegador não abriu (o bot pode estar usando: tente de novo em alguns minutos).');
await chamar('Browser.close').catch(() => {});
process.exit(ok ? 0 : 1);
