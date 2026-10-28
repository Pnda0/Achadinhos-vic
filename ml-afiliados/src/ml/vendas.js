/**
 * Regra de vendas do Mercado Livre: só entra na fila o produto com MAIS de `minimo` vendas (padrão 50).
 *
 * De onde vem o número: do rótulo do card de oferta ("| +10mil vendidos"), o mesmo que o site mostra.
 * O ML arredonda para baixo e escreve "+N"; o próprio card traduz isso como "Mais de N produtos vendidos"
 * (texto de acessibilidade, ver test/fixtures/ofertas-polycard.html). Então "+50 vendidos" = mais de 50.
 * A API pública de itens (campo sold_quantity) responde 403 sem login (conferido em 14/10/2026), por isso
 * não há número exato. Sem rótulo, ou com rótulo que não dá para ler, o produto NÃO entra na fila.
 */
export const VENDAS_MINIMAS = 50;

const MULT = { mil: 1e3, m: 1e6, mi: 1e6, milhao: 1e6, milhoes: 1e6 };

/**
 * Lê o rótulo de vendas. Devolve { minimo, exato } — `minimo` é o menor número de vendas garantido —
 * ou null se o texto não traz um número confiável.
 *   "+10mil vendidos" -> { minimo: 10001, exato: false }   (mais de 10 mil)
 *   "37 vendidos"     -> { minimo: 37, exato: true }
 */
export function lerVendas(rotulo) {
  if (typeof rotulo === 'number') return Number.isInteger(rotulo) && rotulo >= 0 ? { minimo: rotulo, exato: true } : null;
  const t = String(rotulo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const m = t.match(/(\+|mais de)?\s*(\d+(?:[.,]\d+)*)\s*(mil|milhao|milhoes|mi|m)?\s*(?:produtos?\s+)?vendid[oa]s?\b/);
  if (!m) return null;
  const [, mais, numero, sufixo] = m;
  let base;
  if (sufixo) {
    base = Math.round(parseFloat(numero.replace(/\./g, '').replace(',', '.')) * MULT[sufixo]); // "1,5mil" = 1500
  } else {
    if (/[.,]\d{1,2}$/.test(numero)) return null; // "12,5 vendidos" sem "mil": não é contagem
    base = parseInt(numero.replace(/[.,]/g, ''), 10); // "1.000" = mil
  }
  if (!Number.isFinite(base)) return null;
  return mais ? { minimo: base + 1, exato: false } : { minimo: base, exato: true };
}

/** O produto é do Mercado Livre? (Amazon e lojas da Awin não têm essa regra.) */
export const ehDoMercadoLivre = (p) => !p.loja || p.loja === 'ml' || p.loja === 'mercadolivre';

/** Motivo para barrar o produto pela regra de vendas, ou null se ele pode seguir. */
export function motivoVendas(p, minimo = VENDAS_MINIMAS) {
  if (!ehDoMercadoLivre(p)) return null;
  // Da API oficial (src/ml/api.js): entre os 20 mais vendidos de uma categoria grande. A API não dá o número.
  if (p.maisVendidoML) return null;
  const v = lerVendas(p.vendidos);
  if (!v) return p.vendidos == null || p.vendidos === '' ? 'sem dado de vendas' : 'vendas ilegíveis';
  return v.minimo > minimo ? null : `até ${minimo} vendas`;
}
