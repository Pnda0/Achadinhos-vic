/**
 * Busca própria na Shopee (config/shopee.json), junto com a busca do ML: para cada grupo, procura as marcas da
 * lista (config/marcas.json) e as palavras extras pela API oficial de afiliados, os mais vendidos primeiro, e
 * devolve os produtos já com o link de afiliado do dono (offerLink). Os filtros do grupo (nicho, só marcas,
 * não repetir) são aplicados depois, em coletar() (pipeline.js), como para o ML e a Amazon.
 */
import { loadMarcas, loadShopee } from './config.js';
import { Shopee } from './shopee.js';
import { parecido } from './store.js';
import { log, normalizar, sleep } from './util.js';

/**
 * As buscas do grupo: uma por marca das listas pedidas + as palavras extras, sem repetir. "prefixo" (ex.: "perfume")
 * vai na frente da busca que não tem a palavra: buscar só "Dior" trouxe rack de TV e roupa (16/10/2026).
 */
export function buscasDoGrupo(cfgGrupo = {}, marcas = loadMarcas()) {
  const daMarca = (cfgGrupo.marcas || []).flatMap((lista) => (marcas[lista] || []).map((m) => (typeof m === 'string' ? m : m.marca)));
  const prefixo = cfgGrupo.prefixo ? String(cfgGrupo.prefixo) : '';
  const comPrefixo = (t) => (prefixo && !normalizar(t).split(' ').includes(normalizar(prefixo)) ? `${prefixo} ${t}` : t);
  return [...new Set([...daMarca, ...(cfgGrupo.buscas || [])].filter(Boolean).map(comPrefixo))];
}

/**
 * Uma coleta: { produtos, categorias, motivo }. `vez` guarda onde parou a lista de cada grupo (revezamento),
 * para cada coleta procurar outras marcas. Produto fraco (poucas vendas, nota baixa, pouco desconto) fica de fora.
 */
export async function buscarOfertasShopee({ grupos, api = new Shopee(), cfg = loadShopee(), vez = {}, esperar = sleep } = {}) {
  if (cfg.ativo === false) return { produtos: [], categorias: {}, motivo: 'Shopee desligada (config/shopee.json)' };
  if (!api.ligada()) return { produtos: [], categorias: {}, motivo: 'falta SHOPEE_APP_ID/SHOPEE_SECRET no .env' };
  const produtos = [];
  const categorias = {};
  const marcas = loadMarcas();
  for (const g of grupos.filter((x) => x.ativo && cfg.grupos?.[x.nome] && cfg.grupos[x.nome].ativo !== false)) {
    const lista = buscasDoGrupo(cfg.grupos[g.nome], marcas);
    if (!lista.length) continue;
    const n = Math.min(lista.length, cfg.buscasPorColeta || 12);
    // Cada volta completa na lista usa a página seguinte de resultados (1, 2, 3, 1...): a página 1 de sempre só trazia o
    // que já tinha saído ("enviado recentemente") e a fila do Perfumes e do Fitness ficava vazia (27/10/2026).
    const ciclo = lista.length * Math.max(1, cfg.paginas ?? 3);
    const inicio = (vez[g.nome] || 0) % ciclo;
    vez[g.nome] = (inicio + n) % ciclo;
    const c = (categorias[`Shopee: ${g.nome}`] = { encontrados: 0, aceitos: 0 });
    for (let i = 0; i < n; i++) {
      const k = (inicio + i) % ciclo;
      const termo = lista[k % lista.length];
      let itens;
      try {
        itens = await api.buscar(termo, { limite: cfg.porBusca || 20, pagina: Math.floor(k / lista.length) + 1 });
      } catch (e) {
        log(`  🛍️  Shopee "${termo}": ${String(e.message).split('\n')[0]}`);
        if (/signature|credential|10020|10031|auth/i.test(e.message)) throw e; // credencial errada: não adianta seguir
        continue;
      }
      const desta = []; // a mesma busca traz o mesmo produto de vários vendedores: um de cada, até "maxPorBusca"
      for (const it of itens) {
        c.encontrados++;
        if (desta.length >= (cfg.maxPorBusca ?? 4)) continue;
        if (!it.itemId || !it.linkAfiliado || !it.nome) continue;
        if (it.vendas < (cfg.vendasMinimas ?? 50)) continue;
        if (it.nota && it.nota < (cfg.notaMinima ?? 4.5)) continue;
        if ((it.descontoPct || 0) < (cfg.descontoMinimo ?? 15)) continue;
        if (desta.some((x) => parecido(x.nome, it.nome))) continue;
        desta.push(it);
        const { itemId, shopId, vendas, ...resto } = it;
        produtos.push({ ...resto, id: `SHP-${itemId}`, loja: 'shopee', grupo: g.nome, categoria: `Shopee: ${g.nome}`, busca: termo });
      }
      await esperar(1000);
    }
  }
  return { produtos, categorias };
}
