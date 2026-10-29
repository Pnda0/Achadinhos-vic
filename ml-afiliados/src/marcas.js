/**
 * Marcas que saem primeiro (pedido do dono, 15/10/2026): lista em config/marcas.json, por assunto (cabelo,
 * maquiagem, skincare, perfumes, fitness), valendo em TODOS os grupos. A oferta com uma dessas marcas no nome do
 * anúncio ou no texto do post ganha `peso` a mais na fila (src/store.js > proximo), junto com a preferência feminina.
 */
import { loadMarcas } from './config.js';
import { casaTermo, normalizar } from './util.js';

let cache = { em: 0, lista: null };

/**
 * Lista plana [{ marca, termos, peso? }] do arquivo (termo "re:..." = expressão regular no texto original). Sem `cfg`:
 * relê o arquivo no máximo 1x por minuto. `peso` no item = prioridade própria da marca (foi da WePink de 27 a 29/10/2026; hoje nenhuma usa).
 */
export function listaDeMarcas(cfg) {
  if (!cfg) {
    if (!cache.lista || Date.now() - cache.em > 60_000) cache = { em: Date.now(), lista: listaDeMarcas(loadMarcas()) };
    return cache.lista;
  }
  const lista = [];
  for (const [chave, itens] of Object.entries(cfg || {})) {
    if (chave.startsWith('_') || !Array.isArray(itens)) continue;
    for (const item of itens) {
      const o = typeof item === 'string' ? { marca: item } : item;
      if (o?.marca) lista.push({ marca: o.marca, termos: o.termos?.length ? o.termos : [o.marca], ...(Number(o.peso) > 0 && { peso: Number(o.peso) }) });
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

let cachePreco = { em: 0, minimos: null };

/**
 * Marca cara vendida barata demais = falsificação (27/10/2026: "Lattafa Yara" de R$ 27 no Perfumes; o de verdade custa
 * R$ 150+). config/marcas.json > "precoMinimo": { "Marca": reais }. null = preço ok.
 */
export function motivoPrecoDaMarca(p, minimos) {
  if (!minimos) {
    if (!cachePreco.minimos || Date.now() - cachePreco.em > 60_000) cachePreco = { em: Date.now(), minimos: loadMarcas()?.precoMinimo || {} };
    minimos = cachePreco.minimos;
  }
  const marca = p.precoAtual != null && Object.keys(minimos).length ? marcaDoProduto(p) : null;
  return marca && p.precoAtual < Number(minimos[marca]) ? `barato demais para ${marca} (suspeita de falso)` : null;
}

/** Nota extra na fila para oferta de marca (0 sem marca; a marca com `peso` próprio usa o dela). Lê o arquivo uma vez por chamada de envio. */
export function preferenciaDeMarca(cfg = loadMarcas()) {
  const lista = listaDeMarcas(cfg);
  const peso = Number(cfg?.peso) || 1.5;
  const proprio = new Map(lista.filter((m) => m.peso).map((m) => [m.marca, m.peso]));
  return (p) => {
    const marca = lista.length ? marcaDoProduto(p, lista) : null;
    return marca ? proprio.get(marca) ?? peso : 0;
  };
}
