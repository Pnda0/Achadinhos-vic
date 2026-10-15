/**
 * Shopee — API oficial de afiliados (https://affiliate.shopee.com.br > Open API). Pedido do dono, 15/10/2026:
 * os posts copiados dos canais que têm link da Shopee passam a sair com o link de afiliado DO DONO (antes o link
 * da Shopee era apagado do post).
 *
 * No .env: SHOPEE_APP_ID e SHOPEE_SECRET (o "AppID" e a "Senha"/"Secret" da página Open API da Shopee Afiliados).
 *
 * A API é GraphQL e cada chamada é assinada: SHA256(AppID + Timestamp + corpo + Secret).
 *  - generateShortLink: o link curto de afiliado (https://s.shopee.com.br/...) para a página do produto;
 *  - productOfferV2:    nome, preço, foto e vendas do produto (para o nome da oferta e o filtro do grupo).
 */
import crypto from 'node:crypto';
import { settings } from './config.js';

const API = 'https://open-api.affiliate.shopee.com.br/graphql';
const HOST_SHOPEE = /(^|\.)(shopee\.com\.br|shope\.ee|shp\.ee)$/;
const HOST_CURTO = /^(s\.shopee\.com\.br|shope\.ee|br\.shp\.ee|shp\.ee)$/;

export function credenciaisShopee(env = process.env) {
  // Maiúsculas não importam; "shope_appID" e "Senha_shopee" são os nomes que o dono usou no .env (15/10/2026).
  const chaves = Object.keys(env);
  const um = (...nomes) => nomes.map((n) => env[chaves.find((k) => k.toLowerCase() === n.toLowerCase())]?.trim()).find(Boolean) || '';
  return {
    appId: um('SHOPEE_APP_ID', 'SHOPEE_APPID', 'SHOPE_APPID', 'SHOPEE_PARTNER_ID', 'SHOPEE_ID'),
    secret: um('SHOPEE_SECRET', 'SHOPEE_APP_SECRET', 'SHOPEE_API_KEY', 'SHOPEE_KEY', 'SHOPEE_SENHA', 'SENHA_SHOPEE'),
  };
}

export const assinaturaShopee = (appId, timestamp, corpo, secret) => crypto.createHash('sha256').update(`${appId}${timestamp}${corpo}${secret}`).digest('hex');

export function ehLinkShopee(u) {
  try {
    return HOST_SHOPEE.test(new URL(u).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Os links da Shopee de um texto/lista (sem repetir, sem pontuação colada no fim). */
export function extrairLinksShopee(...fontes) {
  const achados = fontes.flat().join('\n').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(achados.map((u) => u.replace(/[).,;!?\]*_~]+$/, '')).filter(ehLinkShopee))];
}

/** Loja e produto de um link da página do produto: "...-i.123.456", "/product/123/456" ou "/loja/123/456". */
export function idsDoLinkShopee(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)shopee\.com\.br$/.test(u.hostname.toLowerCase())) return null;
  const m = u.pathname.match(/-i\.(\d+)\.(\d+)/) || u.pathname.match(/\/product\/(\d+)\/(\d+)/) || u.pathname.match(/^\/[^/]+\/(\d{4,})\/(\d{5,})\/?$/);
  return m ? { shopId: m[1], itemId: m[2] } : null;
}

export const urlDoProdutoShopee = ({ shopId, itemId }) => `https://shopee.com.br/product/${shopId}/${itemId}`;

const CAMPOS = 'itemId shopId productName price priceMin priceMax priceDiscountRate imageUrl sales ratingStar shopName productLink offerLink';

/** Um item da API no formato do bot (vendas em texto, como o rótulo do ML). */
export function produtoDaShopee(n) {
  const preco = Number(n.priceMin || n.price) || null;
  const desconto = Number(n.priceDiscountRate) || null;
  return {
    itemId: n.itemId != null ? String(n.itemId) : null,
    shopId: n.shopId != null ? String(n.shopId) : null,
    nome: n.productName || null,
    precoAtual: preco,
    precoOriginal: preco && desconto ? Math.round((preco / (1 - desconto / 100)) * 100) / 100 : null,
    descontoPct: desconto,
    imagem: n.imageUrl || null,
    vendas: Number(n.sales) || 0,
    vendidos: Number(n.sales) > 0 ? `${Number(n.sales)} vendidos` : null,
    nota: Number(n.ratingStar) || null,
    lojaNome: n.shopName || null,
    url: n.productLink || null,
    linkAfiliado: n.offerLink || null,
  };
}

export class Shopee {
  constructor({ appId, secret, fetchImpl = fetch, agora = () => Date.now() } = credenciaisShopee()) {
    this.appId = appId || '';
    this.secret = secret || '';
    this.fetch = fetchImpl;
    this.agora = agora;
    this.ids = new Map(); // link do post -> { shopId, itemId } (não segue o mesmo link duas vezes)
  }

  ligada() {
    return !!(this.appId && this.secret);
  }

  async graphql(query) {
    const corpo = JSON.stringify({ query });
    const ts = Math.floor(this.agora() / 1000);
    const res = await this.fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinaturaShopee(this.appId, ts, corpo, this.secret)}` },
      body: corpo,
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);
    const erro = json?.errors?.[0];
    if (erro) throw new Error(`Shopee: ${erro.message || 'erro'}${erro.extensions?.code ? ` (${erro.extensions.code})` : ''}`);
    if (!res.ok || !json?.data) throw new Error(`Shopee: HTTP ${res.status}`);
    return json.data;
  }

  /** Link curto de afiliado do dono para a página do produto. `subIds` = marcações para o relatório da Shopee. */
  async gerarLink(urlProduto, subIds = []) {
    const ids = subIds.map((s) => String(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 30)).filter(Boolean).slice(0, 5);
    const d = await this.graphql(`mutation { generateShortLink(input: { originUrl: ${JSON.stringify(urlProduto)}, subIds: ${JSON.stringify(ids)} }) { shortLink } }`);
    const link = d.generateShortLink?.shortLink;
    if (!link) throw new Error('Shopee não devolveu o link de afiliado');
    return link;
  }

  /** Dados do produto (ou null): { nome, precoAtual, precoOriginal, descontoPct, imagem, vendidos, nota, lojaNome }. */
  async produto({ shopId, itemId }) {
    const d = await this.graphql(`{ productOfferV2(shopId: ${Number(shopId)}, itemId: ${Number(itemId)}, limit: 1) { nodes { ${CAMPOS} } } }`);
    const n = d.productOfferV2?.nodes?.[0];
    return n ? produtoDaShopee(n) : null;
  }

  /**
   * Busca por palavra (a busca própria, src/shopee-busca.js): os mais vendidos primeiro (sortType 2).
   * Cada item já vem com `offerLink`, o link de afiliado do dono.
   */
  async buscar(palavra, { limite = 20, ordem = 2 } = {}) {
    const d = await this.graphql(`{ productOfferV2(keyword: ${JSON.stringify(String(palavra))}, sortType: ${Number(ordem)}, page: 1, limit: ${Number(limite)}) { nodes { ${CAMPOS} } } }`);
    return (d.productOfferV2?.nodes || []).map(produtoDaShopee);
  }

  /**
   * Do link do post até o produto: link da página já tem os ids; link curto (s.shopee.com.br, shope.ee) é seguido
   * só pelos redirecionamentos (sem baixar a página), até achar a página do produto. Null se não achar.
   */
  async resolver(url, { maxSaltos = 5 } = {}) {
    if (this.ids.has(url)) return this.ids.get(url);
    let atual = url;
    let ids = idsDoLinkShopee(atual);
    for (let i = 0; !ids && i < maxSaltos; i++) {
      let host;
      try {
        host = new URL(atual).hostname.toLowerCase();
      } catch {
        break;
      }
      if (!HOST_CURTO.test(host) && !/(^|\.)shopee\.com\.br$/.test(host)) break;
      const res = await this.fetch(atual, { redirect: 'manual', headers: { 'user-agent': settings.userAgent }, signal: AbortSignal.timeout(15_000) });
      const destino = res.headers.get('location');
      if (destino) {
        atual = new URL(destino, atual).toString();
        ids = idsDoLinkShopee(atual);
        continue;
      }
      // Sem redirecionamento: a página às vezes leva o endereço do produto dentro dela.
      const html = res.ok ? (await res.text()).slice(0, 200_000) : '';
      const achado = html.match(/https?:\\?\/\\?\/shopee\.com\.br\\?\/[^"'\s<>]*?(-i\.\d+\.\d+|product\\?\/\d+\\?\/\d+)/);
      ids = achado ? idsDoLinkShopee(achado[0].replace(/\\\//g, '/')) : null;
      break;
    }
    this.ids.set(url, ids);
    if (this.ids.size > 500) this.ids.delete(this.ids.keys().next().value);
    return ids;
  }
}
