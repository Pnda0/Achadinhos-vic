/**
 * Cliques por produto (pedido do dono, 03/11/2026: "ranking de produtos mais clicados"). As lojas não contam cliques
 * por produto, então o link do post passa pelo site: https://achadinhos-vic.pages.dev/p/<caminho>. O _worker.js do
 * site ("Vic Site/_worker.js") conta o clique no banco D1 "achadinhos-cliques" e manda para a loja na hora (302).
 *
 * O caminho diz tudo, sem cadastro: canal (t = Telegram, w = WhatsApp), grupo (uma letra), loja e o código do link
 * curto de afiliado — m = meli.la, s = s.shopee.com.br, a = tidd.ly (Awin). Ex.: /p/tbm2AbCdE -> https://meli.la/2AbCdE.
 * O site só manda para esses três endereços (não é um redirecionador aberto).
 * Amazon e link longo seguem direto: a Amazon não aceita link de afiliado escondido atrás de outro endereço.
 * RASTREIO_CLIQUES=false no .env desliga (os posts voltam a sair com o link da loja).
 */
export const SITE = 'https://achadinhos-vic.pages.dev';

const LOJAS = { m: 'meli.la', s: 's.shopee.com.br', a: 'tidd.ly' };
const LETRA_GRUPO = { Beleza: 'b', Fitness: 'f', Perfumes: 'p', Geral: 'g' };
const CODIGO = /^[A-Za-z0-9_-]{3,40}$/;

/** Ligado por padrão. Nos testes (NODE_TEST_CONTEXT) só com RASTREIO_CLIQUES=true: os outros testes conferem o link da loja. */
export function ligado(env = process.env) {
  const v = String(env.RASTREIO_CLIQUES ?? '').trim();
  if (env.NODE_TEST_CONTEXT && !v) return false;
  return !/^(false|0|nao|não|off)$/i.test(v);
}

export const letraDoGrupo = (nome) => LETRA_GRUPO[nome] || 'x';

/** Loja + código do link curto ("m2AbCdE"), ou null quando o link não pode passar pelo site. */
export function codigoDoLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const codigo = u.pathname.slice(1);
  if (u.protocol !== 'https:' || u.search || !CODIGO.test(codigo)) return null;
  const loja = Object.entries(LOJAS).find(([, host]) => u.hostname.toLowerCase() === host)?.[0];
  return loja ? loja + codigo : null;
}

/**
 * A oferta com o link do site no lugar do link da loja (também dentro de um texto pronto) e o `codigoClique` para o
 * histórico. Sem como rastrear, devolve a oferta como veio.
 */
export function comLinkRastreado(p, grupo, { canal = 't', env = process.env } = {}) {
  const codigo = ligado(env) && p?.loja !== 'amazon' ? codigoDoLink(p?.linkAfiliado) : null;
  if (!codigo) return p;
  const link = `${SITE}/p/${canal}${letraDoGrupo(grupo)}${codigo}`;
  return { ...p, linkAfiliado: link, codigoClique: codigo, ...(p.textoPronto && { textoPronto: p.textoPronto.split(p.linkAfiliado).join(link) }) };
}

/** O texto que foi para o Telegram, com os links do site marcados como WhatsApp (o clique conta no canal certo). */
export const paraWhatsApp = (texto) => String(texto ?? '').split(`${SITE}/p/t`).join(`${SITE}/p/w`);
