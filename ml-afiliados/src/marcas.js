/**
 * Marcas que saem primeiro (pedido do dono, 15/10/2026): lista em config/marcas.json, por assunto (cabelo,
 * maquiagem, skincare, perfumes, fitness), valendo em TODOS os grupos. A oferta com uma dessas marcas no nome do
 * anúncio ou no texto do post ganha `peso` a mais na fila (src/store.js > proximo), junto com a preferência feminina.
 */
import { loadMarcas } from './config.js';
import { casaTermo, normalizar } from './util.js';

/** Lista plana [{ marca, termos }] do arquivo (termo "re:..." = expressão regular no texto original). */
export function listaDeMarcas(cfg = loadMarcas()) {
  const lista = [];
  for (const [chave, itens] of Object.entries(cfg || {})) {
    if (chave.startsWith('_') || !Array.isArray(itens)) continue;
    for (const item of itens) {
      const o = typeof item === 'string' ? { marca: item } : item;
      if (o?.marca) lista.push({ marca: o.marca, termos: o.termos?.length ? o.termos : [o.marca] });
    }
  }
  return lista;
}

/** A marca da oferta (a primeira da lista que aparece no nome ou no texto do post), ou null. */
export function marcaDoProduto(p, lista = listaDeMarcas()) {
  const bruto = `${p.nome || ''} ${p.textoPronto || ''}`;
  const texto = normalizar(bruto);
  for (const { marca, termos } of lista) {
    const achou = termos.some((t) => (String(t).startsWith('re:') ? new RegExp(String(t).slice(3), 'i').test(bruto) : casaTermo(texto, t)));
    if (achou) return marca;
  }
  return null;
}

/** Nota extra na fila para oferta de marca (0 sem marca). Lê o arquivo uma vez por chamada de envio. */
export function preferenciaDeMarca(cfg = loadMarcas()) {
  const lista = listaDeMarcas(cfg);
  const peso = Number(cfg?.peso) || 1.5;
  return (p) => (lista.length && marcaDoProduto(p, lista) ? peso : 0);
}
