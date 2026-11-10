/**
 * API oficial do Mercado Livre, pelo aplicativo do dono no DevCenter ("Achadinhos da vic", criado em 27/10/2026;
 * ML_CLIENT_ID e ML_CLIENT_SECRET no .env de casa). Desde 21/10/2026 as páginas de ofertas barram o bot; a API
 * oficial é o caminho permitido.
 *
 * O que o aplicativo consegue ler (testado em 27/10/2026): a lista dos 20 mais vendidos de cada categoria
 * (/highlights), o produto do catálogo (/products/{id}: nome e fotos) e os anúncios dele (/products/{id}/items:
 * preço, preço antigo, loja oficial, frete). A busca de anúncios por palavra (/sites/MLB/search), os anúncios avulsos
 * (/items) e as avaliações dão 403 para aplicativo não certificado — por isso só entram os itens "PRODUCT" da lista de
 * mais vendidos. A busca no CATÁLOGO por nome (/products/search) funciona (29/10/2026): é por ela que as ofertas do ML
 * dos canais do Telegram são achadas (acharPeloNome).
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
import { generoDoProduto } from '../genero.js';
import { marcaDoProduto } from '../marcas.js';
import { palavrasDoProduto, parecido } from '../store.js';
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

/**
 * Tipos de produto do catálogo do ML (domain_id, sem o "MLB-") que cada grupo aceita na busca por marca. A busca do
 * catálogo devolve tudo que tem a palavra: em 04/11/2026 "top track field" trouxe adesivo de carro da Parati Track &
 * Field, livro e videogame, "legging lupo" trouxe livro e máscara, as de whey trouxeram colchão e disco — e o adesivo
 * de carro saiu no Fitness (o dono: "que merda é essa de post de carro"). Só passa o tipo da lista; grupo sem lista
 * não usa a busca por marca. `cat.dominiosML` (config/categorias.json) troca a lista de uma busca.
 */
export const DOMINIOS_BUSCA_MARCA = {
  Fitness: [
    'SUPPLEMENTS', 'CEREAL_BARS', 'SHAKER_BOTTLES', 'SNEAKERS', 'SPORT_BRAS', 'CLOTHING_LOTS', 'LEGGINGS', 'SPORT_LEGGINGS',
    'SHORTS', 'SPORT_SHORTS', 'T_SHIRTS', 'SPORT_T_SHIRTS', 'TANK_TOPS', 'CROP_TOPS', 'PANTS', 'SWEATPANTS', 'JUMPSUITS',
    'SWEATSHIRTS_AND_HOODIES', 'JACKETS_AND_COATS', 'WINDBREAKERS',
  ],
  // Perfume e body splash caem no mesmo domínio (conferido no domain_discovery do ML em 06/11/2026).
  Perfumes: ['PERFUMES'],
  // Casa (10/11/2026): conferido no domain_discovery do ML com as buscas do grupo (config/categorias.json).
  Casa: [
    'AIR_FRYERS', 'KITCHEN_POTS', 'KITCHEN_COOKWARE_KITS', 'FRYING_PANS_WOKS_GRIDDLES_AND_GRILL_PANS', 'KITCHEN_KNIVES', 'FLATWARE_KITS',
    'TABLEWARE_KITS', 'FOOD_STORAGE_CONTAINERS', 'THERMOSES', 'THERMAL_CUPS_AND_TUMBLERS', 'BLENDERS', 'MIXERS', 'HAND_BLENDERS',
    'FOOD_PROCESSORS', 'ELECTRIC_COFFEE_MAKERS', 'ELECTRIC_JUGS', 'ELECTRIC_SANDWICH_MAKERS', 'ELECTRIC_POTS_SKILLETS_AND_RICE_COOKERS',
    'ROBOT_VACUUMS', 'VACUUM_AND_STEAM_CLEANERS', 'IRONS', 'FANS', 'ELECTRIC_OIL_DIFFUSERS_HUMIDIFIERS_AND_VAPORIZERS', 'BED_SHEETS',
    'BATH_TOWELS', 'COMFORTERS', 'PILLOWS', 'DECORATIVE_AND_ORGANIZER_BOXES', 'HANGING_CLOSET_ORGANIZERS',
  ],
};

/**
 * Busca por MARCA no catálogo do ML (`cat.buscaML` em config/categorias.json; 04/11/2026, o dono: "não é possível que
 * não tenha nada dessas marcas no Mercado Livre"). Os mais vendidos de uma categoria grande quase nunca são das marcas
 * da lista; aqui o bot procura a marca pelo nome. Só vale o anúncio da LOJA OFICIAL (official_store_id): é original e,
 * como a API não diz quantas vendas, a loja oficial faz as vezes da regra de "mais de 50 vendas" (`lojaOficialML`).
 */
export async function buscarPorMarcaML(cat, { api = new MLApi(), antes = () => true, resultados = 8 } = {}) {
  const tipos = cat.dominiosML || DOMINIOS_BUSCA_MARCA[cat.grupo];
  if (!tipos?.length) return [];
  const busca = await api.get(`/products/search?status=active&site_id=MLB&limit=${resultados}&q=${encodeURIComponent(cat.buscaML)}`);
  const out = [];
  for (const r of busca?.results || []) {
    if (!tipos.includes(String(r.domain_id || '').replace(/^MLB-/, ''))) continue;
    if (!r.name || !antes({ nome: r.name, grupo: cat.grupo })) continue;
    const anuncios = await api.get(`/products/${r.id}/items?limit=20`);
    const anuncio = escolherAnuncio((anuncios?.results || []).filter((a) => a.official_store_id));
    if (!anuncio) continue;
    const info = await api.produto(r.id);
    if (!info?.imagem) continue;
    out.push({ ...montarProduto(info, anuncio, { produtoId: r.id }), lojaOficialML: true, grupo: cat.grupo, categoria: cat.nome });
  }
  api.salvarCache();
  return out;
}

/** Mesmo preço, com o arredondamento dos canais (até R$ 1 ou 1%) — igual a precoBate() em src/espelho.js. */
const precoIgual = (doPost, doAnuncio) => Math.abs(doPost - doAnuncio) <= Math.max(1, doAnuncio * 0.01);
/** O canal costuma postar o preço no Pix (alguns % abaixo do anúncio): até 8% acima do post ainda é a mesma oferta. */
const precoPerto = (doPost, doAnuncio) => precoIgual(doPost, doAnuncio) || (doAnuncio > doPost && doAnuncio <= doPost * 1.08);

// No nome de um e não no do outro = outro produto (refil x frasco, kit/presente x unidade, shampoo x máscara...).
const VARIANTES = /\b(refil|kit|presente|estojo|miniatura|decant|amostra|tester|combo|body splash|shampoo|condicionador|mascara|sabonete|locao)\b/g;
const variantes = (nome) => new Set(normalizar(nome).match(VARIANTES) || []);
const juntarUnidade = (nome) => String(nome).replace(/(\d)\s+(ml|g|kg|l|mg)\b/gi, '$1$2'); // "100 ml" = "100ml"

/**
 * O nome do post e o do catálogo são o MESMO produto? Mesmas palavras que dizem qual é (parecido(), 70%), mesmo
 * tamanho, sem refil/kit/tipo diferente e sem feminino x masculino. Na dúvida, não: em 29/10/2026 a busca devolvia
 * "Natura Kaiak Pulso" para "Natura K Max" e "Club de Nuit Intense" para "Club de Nuit Sillage".
 */
export function mesmoProduto(doPost, doCatalogo) {
  if (!parecido(juntarUnidade(doPost), juntarUnidade(doCatalogo))) return false;
  const a = variantes(doPost);
  const b = variantes(doCatalogo);
  if (a.size !== b.size || [...a].some((v) => !b.has(v))) return false;
  const ga = generoDoProduto({ nome: doPost });
  const gb = generoDoProduto({ nome: doCatalogo });
  return !(ga && gb && ga !== gb);
}

// Sabor e cor: os dois nomes dizem um e nenhum é o mesmo = outra versão do produto (a foto seria de outra embalagem/cor).
const VERSOES = [
  /\b(chocolate|baunilha|morango|cookies?|banana|coco|limao|maracuja|uva|laranja|neutro|frutas vermelhas|cappuccino|doce de leite|caramelo|menta|abacaxi|melancia|tangerina|cereja|acai|pessego|brigadeiro|leite ninho|chocomenta)\b/g,
  /\b(preto|preta|branco|branca|rosa|azul|cinza|verde|vermelho|vermelha|lilas|roxo|roxa|bege|nude|marrom|amarelo|amarela|dourado|dourada|prata|grafite|marinho|vinho|coral|salmao|caqui)\b/g,
];
const raiz = (w) => (w.length > 4 ? w.replace(/s$/, '') : w); // "proteínas" = "proteína", "barras" = "barra"

/**
 * A foto do catálogo serve para o post? O mesmo produto (mesmoProduto) ou, com nome escrito de outro jeito (o da
 * Amazon é comprido: "YoPRO Bebida Láctea UHT Chocolate 15g de proteínas 250ml" x "Bebida Láctea Yopro Chocolate 15g
 * Proteína 250ml"), a mesma marca da lista, o mesmo tamanho, o mesmo tipo (refil, kit...), o mesmo público, sem sabor
 * ou cor diferente, e pelo menos 3/4 das palavras do nome do catálogo no nome do post.
 */
export function mesmaFoto(doPost, doCatalogo) {
  // Sabor/cor primeiro: o mesmoProduto aceita "Whey Growth 1kg Chocolate" = "... Baunilha" (5 de 7 palavras), e a
  // foto seria de outra embalagem.
  for (const re of VERSOES) {
    const a = new Set(normalizar(doPost).match(re) || []);
    const b = new Set(normalizar(doCatalogo).match(re) || []);
    if (a.size && b.size && ![...a].some((x) => b.has(x))) return false;
  }
  if (mesmoProduto(doPost, doCatalogo)) return true;
  const marca = marcaDoProduto({ nome: doPost });
  if (!marca || marcaDoProduto({ nome: doCatalogo }) !== marca) return false;
  const A = palavrasDoProduto(juntarUnidade(doPost));
  const B = palavrasDoProduto(juntarUnidade(doCatalogo));
  if (A.tamanhos.size && B.tamanhos.size && ![...A.tamanhos].some((t) => B.tamanhos.has(t))) return false;
  const va = variantes(doPost);
  const vb = variantes(doCatalogo);
  if (va.size !== vb.size || [...va].some((v) => !vb.has(v))) return false;
  const ga = generoDoProduto({ nome: doPost });
  const gb = generoDoProduto({ nome: doCatalogo });
  if (ga && gb && ga !== gb) return false;
  const doPostRaiz = new Set([...A.palavras].map(raiz));
  const doCatalogoRaiz = [...new Set([...B.palavras].map(raiz))];
  const comuns = doCatalogoRaiz.filter((w) => doPostRaiz.has(w)).length;
  return comuns >= 3 && comuns / doCatalogoRaiz.length >= 0.75;
}

/**
 * Foto do MESMO produto no catálogo do ML, pelo nome (06/11/2026, o dono: "alguns posts da amazon estão vindo sem
 * imagem"). Da Amazon não dá para tirar a foto: a API só abre depois das vendas mínimas e o Associados proíbe robô no
 * site; a foto do canal pode ter o selo dele (fotoDoCanal: false) e a prévia do link da Amazon muitas vezes não monta.
 * A do catálogo é a foto oficial do produto (fundo branco, sem selo de ninguém). Null se não achar o mesmo produto.
 */
export async function fotoPeloNome(api, nome, { resultados = 5 } = {}) {
  if (!api?.configurada || !nome) return null;
  const busca = await api.get(`/products/search?status=active&site_id=MLB&limit=${resultados}&q=${encodeURIComponent(String(nome).slice(0, 80))}`);
  for (const r of busca?.results || []) {
    if (!r.name || !mesmaFoto(nome, r.name)) continue;
    const info = await api.produto(r.id);
    if (!info?.imagem) continue;
    api.salvarCache?.();
    return info.imagem;
  }
  return null;
}

/**
 * Oferta do ML de um canal do Telegram: o link do canal (meli.la) só abre pela página do ML, que barra o bot desde
 * 21/10/2026. Então o produto é procurado no catálogo pelo nome do post, e só vale se o nome for o mesmo
 * (mesmoProduto) e algum anúncio novo tiver o preço do post (ou até 8% acima: preço no Pix) — senão é outra oferta
 * (ou preço com cupom). O post sai com o preço do anúncio, não o do canal. Null se não achar.
 * `outraLoja` (04/11/2026, o dono: "coisas da Sephora... ver se no Mercado Livre tem também"): o preço do post é de
 * outra loja, então vale o anúncio do ML que custa no máximo 10% a mais — ou menos, que é melhor ainda.
 */
export async function acharPeloNome(api, nome, preco, { resultados = 5, outraLoja = false } = {}) {
  if (!nome || !(preco > 0)) return null;
  const busca = await api.get(`/products/search?status=active&site_id=MLB&limit=${resultados}&q=${encodeURIComponent(nome.slice(0, 80))}`);
  for (const r of busca?.results || []) {
    if (!r.name || !mesmoProduto(nome, r.name)) continue;
    const anuncios = await api.get(`/products/${r.id}/items?limit=20`);
    const lista = anuncios?.results || [];
    const exatos = outraLoja ? [] : lista.filter((x) => precoIgual(preco, x.price));
    const anuncio = escolherAnuncio(exatos.length ? exatos : lista.filter((x) => (outraLoja ? x.price > 0 && x.price <= preco * 1.1 : precoPerto(preco, x.price))));
    if (!anuncio) continue;
    const info = await api.produto(r.id);
    if (!info?.imagem) continue;
    api.salvarCache();
    return montarProduto(info, anuncio, { produtoId: r.id });
  }
  return null;
}
