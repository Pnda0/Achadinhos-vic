/**
 * Mudar o .env do servidor pelo Telegram (pedido do dono, 04/11/2026: "não tô em casa e a atualização subiu sem o token
 * novo da Awin"). O .env não vai para o git (o repositório é público e o .env do PC está mais velho que o do
 * servidor), então quem muda uma chave é o dono, no privado do bot:
 *   /env                     -> lista os NOMES das chaves (nunca os valores)
 *   /env NOME=valor          -> grava (troca a linha ou acrescenta), apaga a mensagem e reinicia o bot
 * Só a conversa do dono chega aqui (comandos da caixa de entrada, src/espelho.js). O valor nunca vai para o log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const ARQUIVO_ENV = path.join(ROOT, '.env');
const NOME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** "NOME=valor" ou "NOME valor" -> { nome, valor } (null se não for isso). Aspas em volta do valor saem. */
export function lerAtribuicao(texto) {
  const m = String(texto || '').trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\s)\s*([\s\S]*)$/);
  if (!m || !NOME.test(m[1])) return null;
  const valor = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
  if (!valor || /[\r\n]/.test(valor)) return null;
  return { nome: m[1], valor };
}

/** Os nomes das chaves do .env, na ordem do arquivo. */
export function nomesDoEnv(arquivo = ARQUIVO_ENV) {
  let texto = '';
  try {
    texto = fs.readFileSync(arquivo, 'utf8');
  } catch {
    return [];
  }
  return texto.split(/\r?\n/).map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]).filter(Boolean);
}

/** Grava NOME=valor: troca a linha que já existe (a primeira) ou acrescenta no fim. Devolve 'trocado' ou 'novo'. */
export function gravarNoEnv(nome, valor, arquivo = ARQUIVO_ENV) {
  let texto = '';
  try {
    texto = fs.readFileSync(arquivo, 'utf8');
  } catch {}
  const quebra = texto.includes('\r\n') ? '\r\n' : '\n';
  const linhas = texto ? texto.split(/\r?\n/) : [];
  const i = linhas.findIndex((l) => new RegExp(`^\\s*${nome}\\s*=`).test(l));
  const linha = `${nome}=${valor}`;
  if (i >= 0) linhas[i] = linha;
  else {
    if (linhas.length && linhas.at(-1) === '') linhas.pop();
    linhas.push(linha, '');
  }
  fs.writeFileSync(arquivo + '.tmp', linhas.join(quebra), { mode: 0o600 });
  fs.renameSync(arquivo + '.tmp', arquivo);
  return i >= 0 ? 'trocado' : 'novo';
}

/** Para a resposta no Telegram: só o fim do valor, para o dono conferir que é o certo. */
export const finalDoValor = (valor) => (valor.length > 8 ? `…${valor.slice(-4)}` : '(curto)');
