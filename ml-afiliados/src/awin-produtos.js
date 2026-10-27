/**
 * Produtos das lojas da Awin (catálogo oficial "product feed", pedido do dono em 22/10/2026: "faz uma alternância...
 * só tem anúncio da Shopee"). Cada loja aprovada (C&A, Nike, Dafiti, Renner, Riachuelo, StudioZ...) publica o seu
 * catálogo; o bot baixa uma vez por dia, guarda só o que tem desconto de verdade e serve aos grupos nas buscas.
 * O link (aw_deep_link) já vem com o id de afiliado do dono. Os filtros do grupo (nicho, só marcas, feminino, não
 * repetir, histórico de preço) são aplicados depois, em coletar() (pipeline.js), como para a Shopee.
 *
 * Precisa da chave dos catálogos (AWIN_FEED_KEY no .env) — NÃO é a mesma do API_KEY_AWIN: Awin → Toolbox →
 * Create-a-Feed. Sem ela, a busca fica desligada e o bot avisa no log.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { DATA_DIR } from './config.js';
import { marcaDoProduto } from './marcas.js';
import { casaTermo, log, normalizar } from './util.js';

const BASE = 'https://productdata.awin.com/datafeed';
const COLUNAS = [
  'aw_deep_link', 'product_name', 'aw_product_id', 'merchant_image_url', 'aw_image_url', 'search_price', 'rrp_price',
  'product_price_old', 'savings_percent', 'brand_name', 'in_stock', 'merchant_category', 'category_name', 'merchant_deep_link', 'currency',
];

export function chaveDosCatalogos(env = process.env) {
  const chaves = Object.keys(env);
  for (const n of ['AWIN_FEED_KEY', 'AWIN_DATAFEED_KEY', 'AWIN_FEED_API_KEY', 'API_KEY_AWIN_FEED', 'AWIN_CATALOGO']) {
    const k = chaves.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && env[k]?.trim()) return env[k].trim();
  }
  return '';
}

/** Uma linha de CSV (aspas com vírgula dentro; "" = aspas). Sem quebra de linha dentro de campo (não pedimos descrição). */
export function lerLinhaCsv(linha) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') (atual += '"'), i++;
      else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') campos.push(atual), (atual = '');
    else atual += c;
  }
  campos.push(atual);
  return campos;
}

const numero = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.,-]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Um produto do catálogo no formato do bot (null se faltar o essencial). */
export function produtoDoCatalogo(linha, loja) {
  const preco = numero(linha.search_price);
  const antigo = [numero(linha.rrp_price), numero(linha.product_price_old)].find((v) => v && preco && v > preco) || null;
  const pct = numero(linha.savings_percent) || (antigo ? Math.round(((antigo - preco) / antigo) * 100) : null);
  if (!linha.aw_product_id || !linha.product_name || !linha.aw_deep_link || !preco) return null;
  return {
    id: `AWF-${linha.aw_product_id}`,
    loja: 'awin',
    lojaNome: loja.nome,
    nome: linha.product_name.trim(),
    url: linha.merchant_deep_link || linha.aw_deep_link,
    linkAfiliado: linha.aw_deep_link,
    imagem: linha.merchant_image_url || linha.aw_image_url || null,
    precoAtual: preco,
    precoOriginal: antigo,
    descontoPct: pct ? Math.round(pct) : null,
    marca: linha.brand_name || null,
    emEstoque: !/^(0|false|no|nao|não)$/i.test(String(linha.in_stock ?? '1').trim()),
    categoria: `Awin: ${loja.nome}`,
  };
}

/** Catálogos disponíveis na conta: [{ lojaId, loja, feedId, idioma, regiao, produtos }]. */
export async function listarCatalogos(chave, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${BASE}/list/apikey/${encodeURIComponent(chave)}`, { signal: AbortSignal.timeout(60_000) });
  if (res.status === 401 || res.status === 403) throw new Error('a Awin recusou a chave dos catálogos (AWIN_FEED_KEY): confira em Toolbox → Create-a-Feed');
  if (!res.ok) throw new Error(`lista de catálogos da Awin: HTTP ${res.status}`);
  const [cab, ...linhas] = (await res.text()).split(/\r?\n/).filter(Boolean);
  const nomes = lerLinhaCsv(cab).map((c) => c.trim().toLowerCase());
  const col = (n) => nomes.findIndex((c) => c.includes(n));
  const [iId, iNome, iFeed, iIdioma, iRegiao, iQtd] = ['advertiser id', 'advertiser name', 'feed id', 'language', 'region', 'no of products'].map(col);
  return linhas.map(lerLinhaCsv).map((c) => ({
    lojaId: Number(c[iId]),
    loja: c[iNome],
    feedId: c[iFeed],
    idioma: iIdioma >= 0 ? c[iIdioma] : '',
    regiao: iRegiao >= 0 ? c[iRegiao] : '',
    produtos: iQtd >= 0 ? Number(c[iQtd]) || 0 : 0,
  }));
}

export const urlDoCatalogo = (chave, feedId) =>
  `${BASE}/download/apikey/${encodeURIComponent(chave)}/fid/${encodeURIComponent(feedId)}/columns/${COLUNAS.join(',')}/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/`;

/**
 * Baixa um catálogo (planilha compactada) lendo linha a linha — catálogo de loja grande tem dezenas de milhares de
 * itens — e guarda só os que `aceitar` deixar (até `limite`).
 */
export async function baixarCatalogo(chave, feed, loja, { aceitar = () => true, limite = 3000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(urlDoCatalogo(chave, feed.feedId), { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`catálogo ${loja.nome}: HTTP ${res.status}`);
  const linhas = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let cab = null;
  const guardados = [];
  for await (const l of linhas) {
    if (!l) continue;
    const campos = lerLinhaCsv(l);
    if (!cab) {
      cab = campos.map((c) => c.trim());
      continue;
    }
    const p = produtoDoCatalogo(Object.fromEntries(cab.map((n, i) => [n, campos[i]])), loja);
    if (p && aceitar(p)) guardados.push(p);
    if (guardados.length >= limite) break;
  }
  linhas.close();
  return guardados;
}

/**
 * Uma busca: { produtos, categorias, motivo }. Os catálogos são baixados no máximo 1x a cada `renovarHoras` e ficam
 * em data/awin-catalogos/<feed>.json (só os candidatos). Cada busca entrega até `porGrupo` produtos por grupo,
 * revezando o catálogo para não repetir sempre os mesmos.
 */
export async function buscarProdutosAwin({ grupos, api, cfg = {}, chave = chaveDosCatalogos(), pasta = path.join(DATA_DIR, 'awin-catalogos'), vez = {}, agora = Date.now(), fetchImpl = fetch } = {}) {
  if (cfg.ativo === false) return { produtos: [], categorias: {}, motivo: 'produtos da Awin desligados (config/awin.json)' };
  if (!chave) return { produtos: [], categorias: {}, motivo: 'falta AWIN_FEED_KEY no .env (Awin → Toolbox → Create-a-Feed)' };
  const lojas = await api.anunciantes();
  const porId = new Map(lojas.map((l) => [Number(l.id), l]));
  const descontoMin = cfg.descontoMinimo ?? 15;
  const aceitar = (p) => p.emEstoque && (p.descontoPct || 0) >= descontoMin && p.precoAtual >= (cfg.precoMinimo ?? 15);
  const feeds = (await listarCatalogos(chave, { fetchImpl })).filter((f) => porId.has(f.lojaId) && (!f.idioma || /^(pt|portug)/i.test(f.idioma))); // a lista da Awin diz "Portuguese" (27/10/2026)
  fs.mkdirSync(pasta, { recursive: true });
  const candidatos = [];
  const categorias = {};
  for (const f of feeds) {
    const loja = porId.get(f.lojaId);
    const arq = path.join(pasta, `${f.feedId}.json`);
    let cache = null;
    try {
      cache = JSON.parse(fs.readFileSync(arq, 'utf8'));
    } catch {}
    if (!cache || agora - Date.parse(cache.baixadoEm) > (cfg.renovarHoras ?? 20) * 3_600_000) {
      try {
        const produtos = await baixarCatalogo(chave, f, loja, { aceitar, fetchImpl });
        cache = { baixadoEm: new Date(agora).toISOString(), loja: loja.nome, produtos };
        fs.writeFileSync(arq, JSON.stringify(cache));
        log(`🛍️  Awin: catálogo da ${loja.nome} — ${produtos.length} produto(s) com ${descontoMin}%+ de desconto.`);
      } catch (e) {
        log(`  ⚠️  Awin: catálogo da ${loja.nome} não baixou (${String(e.message).split('\n')[0]})`);
        if (!cache) continue;
      }
    }
    candidatos.push(...cache.produtos);
    (categorias[`Awin: ${loja.nome}`] ??= { encontrados: 0, aceitos: 0 }).encontrados += cache.produtos.length; // loja com vários catálogos
  }
  // Cada grupo ligado recebe uma fatia, revezando (os filtros do grupo decidem depois em coletar()). A fatia sai só do
  // que é do assunto do grupo (e de marca da lista, se ele for "só marcas"): no meio de 16 mil roupas e tênis, o Beleza e
  // o Perfumes nunca recebiam os ~30 produtos de beleza e ~40 perfumes da Dafiti (27/10/2026).
  const produtos = [];
  const n = cfg.porGrupo ?? 8;
  for (const g of grupos.filter((x) => x.ativo)) {
    const termos = g.filtros?.palavrasObrigatorias || [];
    const doGrupo = candidatos.filter((p) => (!termos.length || termos.some((t) => casaTermo(normalizar(p.nome), t))) && (!g.filtros?.soMarcas || marcaDoProduto(p)));
    if (!doGrupo.length) continue;
    const inicio = (vez[g.nome] || 0) % doGrupo.length;
    const lote = Array.from({ length: Math.min(doGrupo.length, n * 6) }, (_, i) => doGrupo[(inicio + i) % doGrupo.length]);
    vez[g.nome] = (inicio + lote.length) % doGrupo.length;
    produtos.push(...lote.map((p) => ({ ...p, grupo: g.nome })));
  }
  return { produtos, categorias };
}
