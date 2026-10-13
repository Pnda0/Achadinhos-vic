/**
 * Espelho da Amazon: quando um grupo-fonte posta um link da Amazon, o bot troca pela etiqueta do dono
 * (AMAZON_PARTNER_TAG) e monta a oferta no nosso formato.
 *
 * O que NÃO fazemos, de propósito: abrir a página do produto na Amazon. O contrato do Associados não
 * permite robôs no site. Usamos só o link (para achar o ASIN) e o que a própria mensagem diz
 * (nome, preço, cupom). Link curto (amzn.to / a.co / link.amazon) é resolvido lendo só o redirecionamento.
 * A foto e o título aparecem pela prévia de link do próprio WhatsApp.
 */
import { parseBRL } from './util.js';

const HOST_AMAZON = /(^|\.)(amazon\.com\.br|amzn\.to|a\.co|amzn\.com|link\.amazon|amzlinks\.in)$/i;
const HOST_CURTO = /^(amzn\.to|a\.co|amzn\.com|link\.amazon|amzlinks\.in)$/i;

/** Links da Amazon num texto (sem repetir, na ordem). */
export function extrairLinksAmazon(texto) {
  const achados = String(texto || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  const links = [];
  for (let u of achados) {
    u = u.replace(/[).,;!?\]*_~]+$/, '');
    try {
      if (HOST_AMAZON.test(new URL(u).hostname) && !links.includes(u)) links.push(u);
    } catch {}
  }
  return links;
}

/** ASIN (código de 10 caracteres do produto) a partir de um link longo da Amazon. */
export function asinDeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/amazon\./i.test(u.hostname)) return null;
  const m =
    u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i) ||
    u.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
  const asin = (m?.[1] || u.searchParams.get('asin') || '').toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
}

/** Segue só os redirecionamentos de um link curto (sem abrir a página do produto). */
export async function resolverLinkAmazon(url, { fetchImpl = fetch, maxSaltos = 4 } = {}) {
  let atual = url;
  for (let i = 0; i < maxSaltos; i++) {
    const asin = asinDeUrl(atual);
    if (asin) return asin;
    let host;
    try {
      host = new URL(atual).hostname;
    } catch {
      return null;
    }
    if (!HOST_CURTO.test(host)) return null; // link longo sem ASIN (lista, loja, busca): não serve
    let destino;
    for (const method of ['HEAD', 'GET']) {
      // o link.amazon só redireciona no GET
      const res = await fetchImpl(atual, { method, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      res.body?.cancel?.().catch(() => {});
      destino = res.headers?.get?.('location');
      if (destino) break;
    }
    if (!destino) return null;
    atual = new URL(destino, atual).toString();
  }
  return asinDeUrl(atual);
}

export const linkAfiliadoAmazon = (asin, tag) => `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(tag)}`;

// Com R$, ou sem ele depois de "por"/"de" quando tem centavos ("por 123,25 à vista").
const PRECO = /R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|R\$\s?\d+(?:,\d{2})?|\b(?:por|de)\s+\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/gi;
const TEM_PRECO = /R\$\s?\d|\b(?:por|de)\s+\d[\d.]*,\d{2}(?!\d)/i;
/** Condição do preço que a mensagem avisa — sem ela o preço anunciado engana. */
const CONDICOES = [
  [/programe e poupe/i, 'no Programe e Poupe'],
  [/exclusiv\w* para (?:assinantes|membros)[^\n]*prime/i, 'para assinantes Prime'],
  [/\bno pix\b/i, 'no Pix'],
];
const limpar = (l) =>
  l
    .replace(/[*_~`]/g, '')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Nome, preços, desconto e cupom a partir do texto da mensagem. */
export function dadosDoTexto(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const semLink = linhas.map((l) => l.replace(/https?:\/\/\S+/gi, '').trim()).filter(Boolean);

  // Preço "de" (riscado com ~ ou depois de "de") e preço "por".
  let original = null;
  let atual = null;
  for (const l of semLink) {
    const precos = (l.match(PRECO) || []).map(parseBRL).filter((n) => n > 0);
    if (!precos.length) continue;
    const riscado = /~[^~]*R\$[^~]*~/.test(l) || /\bde\s*:?\s*R\$/i.test(l) || /\bantes\b/i.test(l);
    if (precos.length >= 2) {
      original ??= Math.max(...precos);
      atual ??= Math.min(...precos);
    } else if (riscado && !/\bpor\b/i.test(l)) original ??= precos[0];
    else atual ??= precos[0];
  }
  if (original && atual && original <= atual) original = null;
  const pct = String(texto).match(/(\d{1,2})\s?%\s?(?:off|de desconto)/i);
  let descontoPct = pct ? Number(pct[1]) : null;
  if (descontoPct === null && original && atual) descontoPct = Math.round((1 - atual / original) * 100);

  const cupomM = String(texto).match(/cupom\s*:?\s*\*?([A-Z0-9]{4,20})\*?/i);
  const cupom = cupomM && /\d|[A-Z]{4,}/.test(cupomM[1]) && !/^(de|off|amazon)$/i.test(cupomM[1]) ? cupomM[1].toUpperCase() : null;

  // Nome: a primeira linha "de produto" (tem minúsculas, não é preço, cupom, chamada ou frete).
  const candidatas = semLink
    .map(limpar)
    .filter(
      (l) =>
        l.length >= 12 &&
        /[a-zà-ú]/.test(l) &&
        !TEM_PRECO.test(l) &&
        !/^(cupom|use o cupom|frete|link|compre|corre|aproveita|oferta|promo|🔥)/i.test(l) &&
        !/grupo|whatsapp|chat\.whatsapp|convide/i.test(l)
    );
  const nome = candidatas[0] || null;
  const precoObs = (atual && CONDICOES.find(([re]) => re.test(texto))?.[1]) || null;
  return { nome, precoAtual: atual, precoOriginal: original, descontoPct, cupom, precoObs };
}
