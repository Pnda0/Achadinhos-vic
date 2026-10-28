/**
 * API oficial do Mercado Livre, pelo aplicativo do dono no DevCenter ("Achadinhos da vic", criado em 27/10/2026;
 * ML_CLIENT_ID e ML_CLIENT_SECRET no .env de casa). Desde 21/10/2026 as páginas de ofertas barram o bot; a API
 * oficial é o caminho permitido.
 *
 * O que o aplicativo consegue ler (testado em 27/10/2026): a lista dos 20 mais vendidos de cada categoria
 * (/highlights), o produto do catálogo (/products/{id}: nome e fotos) e os anúncios dele (/products/{id}/items:
 * preço, preço antigo, loja oficial, frete). A busca por palavra, os anúncios avulsos (/items) e as avaliações dão
 * 403 para aplicativo não certificado — por isso só entram os itens "PRODUCT" da lista de mais vendidos.
 *
 * Vendas: a API não diz quantas. O produto está entre os 20 mais vendidos de uma categoria com milhares de anúncios
 * (só usamos categorias com MIN_ANUNCIOS ou mais), o que vale mais que as "mais de 50 vendas" do rótulo do card:
 * fica marcado em `maisVendidoML` (posição) e src/ml/vendas.js aceita.
 *
 * Acesso: token do próprio aplicativo (client_credentials), sem login do dono; vale 6 h e é renovado sozinho.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from '../config.js';
import { normalizar, sleep } from '../util.js';
import { imageUrlFromId, normalizeImageUrl } from './parser.js';

const API = 'https://api.mercadolibre.com';
/** Categoria pequena demais: ser "top 20" nela não garante vendas. */
export const MIN_ANUNCIOS = 5000;
const DIA = 86_400_000;

export class ErroApiML extends Error {}

export class MLApi {
  constructor({ clientId = settings.mlClientId, clientSecret = settings.mlClientSecret, dir = DATA_DIR, fetchImpl = fetch, pausaMs = 300 } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.arqToken = path.join(dir, 'ml-token-app.json');
    this.arqCache = path.join(dir, 'ml-produtos-cache.json');
    this.fetch = fetchImpl;
    this.pausaMs = pausaMs;
    this.cache = null;
  }

  get configurada() {
    return Boolean(this.clientId && this.clientSecret);
  }

  async token() {
    let t = null;
    try {
      t = JSON.parse(fs.readFileSync(this.arqToken, 'utf8'));
    } catch {}
    // Renova 10 min antes de vencer.
    if (t?.access_token && Date.parse(t.obtidoEm) + (t.expires_in - 600) * 1000 > Date.now()) return t.access_token;
    if (!this.configurada) throw new ErroApiML('faltam ML_CLIENT_ID e ML_CLIENT_SECRET no .env');
    const res = await this.fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new ErroApiML(`o ML recusou a chave do aplicativo (HTTP ${res.status}${j.error ? `, ${j.error}` : ''})`);
    fs.writeFileSync(this.arqToken, JSON.stringify({ ...j, obtidoEm: new Date().toISOString() }, null, 1));
    return j.access_token;
  }

  /** GET na API. 403/404 de um produto só = null (o resto da lista segue); 401 = token vencido, tenta de novo uma vez. */
  async get(caminho, { tentativa = 1 } = {}) {
    if (this.pausaMs) await sleep(this.pausaMs);
    const res = await this.fetch(API + caminho, { headers: { authorization: `Bearer ${await this.token()}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 401 && tentativa === 1) {
      fs.rmSync(this.arqToken, { force: true });
      return this.get(caminho, { tentativa: 2 });
    }
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new ErroApiML(`HTTP ${res.status} em ${caminho.split('?')[0]}`);
    return res.json();
  }

  lerCache() {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(fs.readFileSync(this.arqCache, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
    return this.cache;
  }

  salvarCache() {
    if (!this.cache) return;
    const limite = Date.now() - 30 * DIA;
    for (const [k, v] of Object.entries(this.cache)) if (Date.parse(v.em) < limite) delete this.cache[k];
    fs.writeFileSync(this.arqCache, JSON.stringify(this.cache));
  }

  /** Categoria (nome e tamanho), guardada por 7 dias. */
  async categoria(id) {
    const cache = this.lerCache();
    const c = cache[`cat:${id}`];
    if (c && Date.now() - Date.parse(c.em) < 7 * DIA) return c;
    const j = await this.get(`/categories/${id}`);
    if (!j) return null;
    return (cache[`cat:${id}`] = { nome: j.name, anuncios: j.total_items_in_this_category || 0, em: new Date().toISOString() });
  }

  /** Nome e foto do produto do catálogo, guardados por 7 dias (não mudam). */
  async produto(id) {
    const cache = this.lerCache();
    const c = cache[id];
    if (c && Date.now() - Date.parse(c.em) < 7 * DIA) return c;
    const j = await this.get(`/products/${id}`);
    if (!j?.name) return null;
    const foto = j.pictures?.[0];
    return (cache[id] = { nome: j.name, imagem: normalizeImageUrl(foto?.url) || imageUrlFromId(foto?.id), em: new Date().toISOString() });
  }
}

/** Ids (PRODUCT) dos mais vendidos da categoria, com a posição. */
export async function maisVendidos(api, categoria) {
  const j = await api.get(`/highlights/MLB/category/${categoria}`);
  return (j?.content || []).filter((x) => x.type === 'PRODUCT').map((x) => ({ id: x.id, posicao: x.position }));
}

/**
 * O anúncio que vai para o grupo: novo, de loja oficial se houver, e o mais barato entre esses. Sem preço antigo
 * não é oferta (o filtro de desconto do grupo barra).
 */
export function escolherAnuncio(anuncios = []) {
  const novos = anuncios.filter((a) => a.price > 0 && (!a.condition || a.condition === 'new'));
  const oficiais = novos.filter((a) => a.official_store_id);
  const base = oficiais.length ? oficiais : novos;
  return base.sort((a, b) => a.price - b.price)[0] || null;
}

const slug = (nome) => normalizar(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Produto no formato do bot (o mesmo de productFromCard em parser.js). */
export function montarProduto(info, anuncio, { posicao, produtoId } = {}) {
  const num = String(anuncio.item_id).replace(/^MLB/, '');
  const antigo = anuncio.original_price > anuncio.price ? anuncio.original_price : null;
  return {
    id: anuncio.item_id,
    nome: info.nome,
    url: `https://produto.mercadolivre.com.br/MLB-${num}-${slug(info.nome)}-_JM`,
    imagem: info.imagem,
    precoAtual: anuncio.price,
    precoOriginal: antigo,
    descontoPct: antigo ? Math.round((1 - anuncio.price / antigo) * 100) : null,
    precoObs: null,
    parcelamento: null,
    cupom: null,
    frete: anuncio.shipping?.free_shipping ? 'Frete grátis' : null,
    full: anuncio.shipping?.logistic_type === 'fulfillment',
    vendedor: null,
    lojaOficial: Boolean(anuncio.official_store_id),
    nota: null,
    vendidos: null,
    maisVendidoML: posicao ?? null,
    produtoML: produtoId ?? null,
    fimRelampago: null,
  };
}

/**
 * Os mais vendidos de uma categoria (`cat.maisVendidos` em config/categorias.json), já com preço do anúncio.
 * `antes(p)`: filtro barato pelo nome (marca, nicho) — só os que passam custam a consulta dos anúncios.
 */
export async function buscarMaisVendidosML(cat, { api = new MLApi(), antes = () => true } = {}) {
  const c = await api.categoria(cat.maisVendidos);
  if (!c) throw new ErroApiML(`categoria ${cat.maisVendidos} não abriu`);
  if (c.anuncios < MIN_ANUNCIOS) return [];
  const lista = await maisVendidos(api, cat.maisVendidos);
  const out = [];
  for (const { id, posicao } of lista) {
    const info = await api.produto(id);
    if (!info?.imagem || !antes({ nome: info.nome, grupo: cat.grupo })) continue;
    const anuncios = await api.get(`/products/${id}/items?limit=20`);
    const anuncio = escolherAnuncio(anuncios?.results);
    if (!anuncio) continue;
    out.push({ ...montarProduto(info, anuncio, { posicao, produtoId: id }), grupo: cat.grupo, categoria: cat.nome });
  }
  api.salvarCache();
  return out;
}
