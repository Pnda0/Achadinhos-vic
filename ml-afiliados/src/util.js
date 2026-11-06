export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera aleatória entre min e max segundos (para não parecer robô). */
export const randomDelay = (minS, maxS) => sleep((minS + Math.random() * (maxS - minS)) * 1000);

export function log(...args) {
  const ts = new Date().toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Sao_Paulo' });
  console.log(`[${ts}]`, ...args);
}

/** 1234.5 -> "R$ 1.234,50" ; 69 -> "R$ 69" (sem centavos quando inteiro, igual ao ML) */
export function formatBRL(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const inteiro = Number.isInteger(n);
  return (
    'R$ ' +
    n.toLocaleString('pt-BR', {
      minimumFractionDigits: inteiro ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/** "R$ 1.234,56" -> 1234.56 */
export function parseBRL(text) {
  if (!text) return null;
  const n = parseFloat(String(text).replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function decodeHtml(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export const cleanText = (s) => decodeHtml(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "Pré-Treino 300g" -> "pre treino 300g" (sem acento, minúsculo, só letras/números separados por espaço). */
export function normalizar(t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const regexDoTermo = new Map();

/**
 * O texto (já normalizado) casa com o termo? Cada parte separada por "+" precisa aparecer como
 * palavra inteira (aceita plural simples): "tenis+corrida" casa com "Tênis de Corrida Masculino",
 * "top+fitness" NÃO casa com "Laptop Fitness".
 * "re:<expressão>" (06/11/2026): expressão regular sobre o texto JÁ NORMALIZADO (minúsculo, sem acento, só letras,
 * números e espaço), para o que o "a+b" não diz — ex.: nas bloqueadas do Fitness, "fonte" (de tomada) fica de fora,
 * mas "fonte de proteína" não. Expressão inválida não casa com nada (e não derruba o filtro).
 */
export function casaTermo(textoNorm, termo) {
  const t = String(termo);
  if (t.startsWith('re:')) {
    if (!regexDoTermo.has(t)) {
      let re = null;
      try {
        re = new RegExp(t.slice(3), 'i');
      } catch {
        console.warn(`⚠️  expressão inválida na configuração (ignorada): ${t}`);
      }
      regexDoTermo.set(t, re);
    }
    return regexDoTermo.get(t)?.test(textoNorm) ?? false;
  }
  const alvo = ` ${textoNorm} `;
  return t
    .split('+')
    .map(normalizar)
    .filter(Boolean)
    .every((parte) => alvo.includes(` ${parte} `) || alvo.includes(` ${parte}s `));
}

/** Data local no formato AAAA-MM-DD (padrão: horário de Brasília). */
export function diaLocal(data = new Date(), tz = 'America/Sao_Paulo') {
  return new Date(data).toLocaleDateString('sv-SE', { timeZone: tz });
}
