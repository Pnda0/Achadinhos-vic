/**
 * Amazon pela API oficial (Creators API, que substituiu a PA-API 5).
 *
 * Por que API e não "raspar" o site: o contrato do Amazon Associados não permite robôs/coleta automática
 * no site e só permite mostrar preço obtido pela API. Raspando, a conta pode ser encerrada e as comissões retidas.
 *
 * Credenciais (Associates Central > Ferramentas > Creators API > Create Application > Add New Credential):
 *   AMAZON_CREDENTIAL_ID      (começa com "amzn1.")
 *   AMAZON_CREDENTIAL_SECRET  (aparece uma vez só)
 *   AMAZON_PARTNER_TAG        (sua etiqueta, ex.: pandaofertas-20)
 * Acesso: a Amazon exige vendas qualificadas recentes (hoje ~10 nos últimos 30 dias); sem isso a API responde 403.
 *
 * Buscas em config/amazon.json. Cada produto vem com o link de afiliado pronto (detailPageURL já leva a etiqueta).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { log, sleep } from './util.js';

const env = process.env;
export const amazonCfg = () => ({
  credentialId: env.AMAZON_CREDENTIAL_ID?.trim() || '',
  credentialSecret: env.AMAZON_CREDENTIAL_SECRET?.trim() || '',
  partnerTag: env.AMAZON_PARTNER_TAG?.trim() || '',
  marketplace: env.AMAZON_MARKETPLACE?.trim() || 'www.amazon.com.br',
  tokenUrl: env.AMAZON_TOKEN_URL?.trim() || 'https://api.amazon.com/auth/o2/token', // região NA (inclui Brasil)
  apiUrl: (env.AMAZON_API_URL?.trim() || 'https://creatorsapi.amazon/catalog/v1').replace(/\/$/, ''),
});

export function loadBuscasAmazon() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/amazon.json'), 'utf8'));
    return { ...cfg, buscas: (cfg.buscas || []).filter((b) => b && b.ativo !== false) };
  } catch {
    return { ativo: false, buscas: [] };
  }
}

export const RECURSOS = [
  'images.primary.large',
  'itemInfo.title',
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.dealDetails',
  'offersV2.listings.isBuyBoxWinner',
  'offersV2.listings.merchantInfo',
  'customerReviews.starRating',
  'customerReviews.count',
];

/** Lê um campo aceitando camelCase (Creators API) ou PascalCase (PA-API antiga). */
const campo = (o, nome) => (o == null ? undefined : o[nome] ?? o[nome[0].toUpperCase() + nome.slice(1)]);
const caminho = (o, ...nomes) => nomes.reduce((acc, n) => campo(acc, n), o);
const numero = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Converte um item da API no formato de produto do bot (o mesmo do Mercado Livre). */
export function produtoDeItem(item, { grupo, categoria, consultadoEm = new Date() } = {}) {
  const asin = campo(item, 'asin') ?? item?.ASIN;
  const nome = caminho(item, 'itemInfo', 'title', 'displayValue');
  const listings = caminho(item, 'offersV2', 'listings') || [];
  const oferta = listings.find((l) => campo(l, 'isBuyBoxWinner')) || listings[0];
  const preco = numero(caminho(oferta, 'price', 'money', 'amount'));
  if (!asin || !nome || !preco) return null;
  let precoOriginal = numero(caminho(oferta, 'price', 'savingBasis', 'money', 'amount'));
  let descontoPct = numero(caminho(oferta, 'price', 'savings', 'percentage'));
  if (precoOriginal && precoOriginal <= preco) precoOriginal = null;
  if (descontoPct === null && precoOriginal) descontoPct = Math.round((1 - preco / precoOriginal) * 100);
  const deal = caminho(oferta, 'dealDetails');
  const disponibilidade = String(caminho(oferta, 'availability', 'type') || '').toUpperCase();
  return {
    id: `AMZ-${asin}`,
    asin,
    loja: 'amazon',
    grupo,
    categoria,
    nome: String(nome).replace(/\s+/g, ' ').trim(),
    url: campo(item, 'detailPageURL') || null,
    linkAfiliado: campo(item, 'detailPageURL') || null,
    imagem: caminho(item, 'images', 'primary', 'large', 'url') || caminho(item, 'images', 'primary', 'medium', 'url') || null,
    precoAtual: preco,
    precoOriginal,
    descontoPct,
    precoObs: null,
    parcelamento: null,
    cupom: null,
    frete: null,
    full: false,
    vendedor: caminho(oferta, 'merchantInfo', 'name') || null,
    lojaOficial: false,
    nota: numero(caminho(item, 'customerReviews', 'starRating', 'value')),
    vendidos: null,
    fimRelampago: Boolean(campo(deal, 'endTime')),
    selo: campo(deal, 'badge') || null,
    indisponivel: disponibilidade === 'OUT_OF_STOCK' || disponibilidade === 'UNAVAILABLE',
    precoConsultadoEm: consultadoEm.toISOString(),
  };
}

export class AmazonAPI {
  constructor(cfg = amazonCfg(), { fetchImpl = fetch, pausaMs = 1100 } = {}) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.pausaMs = pausaMs;
    this.token = null;
    this.expira = 0;
    this.ultimaChamada = 0;
  }

  configurada() {
    return Boolean(this.cfg.credentialId && this.cfg.credentialSecret && this.cfg.partnerTag);
  }

  async obterToken() {
    if (this.token && Date.now() < this.expira - 60_000) return this.token;
    const res = await this.fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.cfg.credentialId,
        client_secret: this.cfg.credentialSecret,
        scope: 'creatorsapi::default',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok || !corpo.access_token) {
      throw new Error(`Amazon recusou as credenciais (HTTP ${res.status}${corpo.error ? ` ${corpo.error}` : ''}). Confira AMAZON_CREDENTIAL_ID/SECRET no .env.`);
    }
    this.token = corpo.access_token;
    this.expira = Date.now() + (Number(corpo.expires_in) || 3600) * 1000;
    return this.token;
  }

  async chamar(operacao, corpo) {
    const espera = this.ultimaChamada + this.pausaMs - Date.now();
    if (espera > 0) await sleep(espera); // limite inicial da Amazon: 1 chamada por segundo
    this.ultimaChamada = Date.now();
    const token = await this.obterToken();
    const res = await this.fetch(`${this.cfg.apiUrl}/${operacao}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-marketplace': this.cfg.marketplace },
      body: JSON.stringify({ partnerTag: this.cfg.partnerTag, marketplace: this.cfg.marketplace, ...corpo }),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await res.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {}
    if (!res.ok) {
      const msg = json?.errors?.[0]?.message || json?.message || texto.slice(0, 200);
      const err = new Error(`Amazon ${operacao} HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      if (res.status === 401 || res.status === 403) {
        err.message += ' — a conta precisa de acesso à Creators API (vendas qualificadas recentes) e credenciais válidas.';
      }
      throw err;
    }
    return json || {};
  }

  /** Busca ofertas. `busca` = { keywords, searchIndex, browseNodeId, minSavingPercent, itemCount, paginas, sortBy }. */
  async buscar(busca, { grupo, minSavingPercent } = {}) {
    const itens = [];
    const paginas = Math.min(10, Math.max(1, Number(busca.paginas) || 1));
    for (let pagina = 1; pagina <= paginas; pagina++) {
      const corpo = {
        resources: RECURSOS,
        itemCount: Math.min(10, Number(busca.itemCount) || 10),
        itemPage: pagina,
      };
      if (busca.keywords) corpo.keywords = busca.keywords;
      if (busca.searchIndex) corpo.searchIndex = busca.searchIndex;
      if (busca.browseNodeId) corpo.browseNodeId = String(busca.browseNodeId);
      if (busca.sortBy) corpo.sortBy = busca.sortBy;
      const minimo = busca.minSavingPercent ?? minSavingPercent;
      if (minimo) corpo.minSavingPercent = Number(minimo);
      const r = await this.chamar('searchItems', corpo);
      const lista = caminho(r, 'searchResult', 'items') || [];
      const agora = new Date();
      for (const it of lista) {
        const p = produtoDeItem(it, { grupo, categoria: `Amazon: ${busca.nome || busca.keywords}`, consultadoEm: agora });
        if (p && !p.indisponivel) itens.push(p);
      }
      if (lista.length < corpo.itemCount) break;
    }
    return itens;
  }
}

/** Uma rodada de coleta na Amazon. Devolve { encontrados, categorias } no formato das estatísticas do ML. */
export async function buscarOfertasAmazon(api = new AmazonAPI(), cfg = loadBuscasAmazon(), { gruposAtivos = null } = {}) {
  if (!cfg.ativo) return { produtos: [], categorias: {}, motivo: 'desligada em config/amazon.json' };
  if (!api.configurada()) return { produtos: [], categorias: {}, motivo: 'faltam AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET ou AMAZON_PARTNER_TAG no .env' };
  const produtos = [];
  const categorias = {};
  for (const busca of cfg.buscas) {
    const nome = `Amazon: ${busca.nome || busca.keywords}`;
    const grupo = busca.grupo || cfg.grupo || 'Geral';
    if (gruposAtivos && !gruposAtivos.has(grupo)) continue; // grupo desligado ou ainda sem canal: não gasta chamada
    try {
      const achados = await api.buscar(busca, { grupo, minSavingPercent: cfg.minSavingPercent });
      categorias[nome] = { encontrados: achados.length, aceitos: 0 };
      produtos.push(...achados);
    } catch (e) {
      categorias[nome] = { encontrados: 0, aceitos: 0 };
      if (e.status === 401 || e.status === 403) throw e; // credencial/acesso: não adianta tentar as outras buscas
      log(`  ⚠️  ${nome}: ${String(e.message).split('\n')[0]}`);
    }
  }
  return { produtos, categorias };
}

export const lojaDoProduto = (p) => (p?.loja === 'amazon' ? 'Amazon' : 'Mercado Livre');
