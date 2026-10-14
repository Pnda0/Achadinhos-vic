/**
 * Extrai produtos das páginas de ofertas do Mercado Livre.
 *
 * Estratégia (da mais confiável para a menos):
 *  1. JSON embutido na página (script __NORDIC_RENDERING_CTX__) — traz preço, desconto,
 *     cupom, frete grátis, FULL, loja oficial, nota e vendidos já estruturados.
 *  2. HTML dos cards "poly-card" (o que o workflow do curso faz) — reserva caso o JSON mude.
 *  3. HTML do "dynamic-carousel" (páginas antigas/home) — mesma lógica do curso.
 */
import { formatBRL, parseBRL, decodeHtml, cleanText } from '../util.js';

const IMG_BASE = 'https://http2.mlstatic.com';

/** Monta URL de imagem JPG grande (o WhatsApp não gosta de .webp). */
export function imageUrlFromId(picId, size = 'F') {
  if (!picId) return null;
  return `${IMG_BASE}/D_NQ_NP_2X_${picId}-${size}.jpg`;
}

/** Converte qualquer URL de imagem do ML (webp, miniatura) para a versão JPG grande. */
export function normalizeImageUrl(url) {
  if (!url) return null;
  const m = url.match(/(\d+-ML[A-Z]\d+_\d+)/);
  return m ? imageUrlFromId(m[1]) : url;
}

/** Normaliza o ID: "MLB-123" -> "MLB123". */
export function extractId(url) {
  const m = String(url || '').match(/ML[A-Z]-?\d+/i);
  return m ? m[0].replace('-', '').toUpperCase() : null;
}

/** Remove parâmetros e fragmentos (#polycard...) — o link de afiliado deve partir da URL limpa. */
export function cleanProductUrl(url) {
  if (!url) return null;
  let u = decodeHtml(url).split('#')[0].split('?')[0];
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  return u;
}

// ---------------------------------------------------------------------------
// 1) JSON embutido
// ---------------------------------------------------------------------------

export function extractEmbeddedState(html) {
  const script = html.match(/<script\b[^>]*id="__NORDIC_RENDERING_CTX__"[^>]*>([\s\S]*?)<\/script>/);
  if (!script) return null;
  const body = script[1];
  const start = body.indexOf('{', body.indexOf('_n.ctx.r='));
  if (start < 0) return null;
  let js = body.slice(start);
  // O objeto termina no último "}" que gera JSON válido.
  let end = js.lastIndexOf('}');
  while (end > 0) {
    try {
      return JSON.parse(js.slice(0, end + 1));
    } catch {
      end = js.lastIndexOf('}', end - 1);
    }
  }
  return null;
}

/** Preenche templates do ML como "{amount} OFF com Cupom". */
function renderTemplate(tpl) {
  if (!tpl?.text) return null;
  const vals = Object.fromEntries((tpl.values || []).map((v) => [v.key, v]));
  return tpl.text
    .replace(/\{(\w+)\}/g, (_, key) => {
      const v = vals[key];
      if (!v) return '';
      if (v.type === 'price') return formatBRL(v.price?.value) || '';
      if (v.type === 'label') return v.label?.text || '';
      if (v.type === 'pill') return v.pill?.text || '';
      return ''; // ícones
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function productFromCard(card) {
  const meta = card.metadata || {};
  const comps = Object.fromEntries((card.components || []).map((c) => [c.type, c[c.type] ?? c]));
  // O ML manda estes campos ora como lista, ora como objeto único.
  const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

  const title = comps.title?.text?.trim();
  const url = cleanProductUrl(meta.url);
  const id = meta.id || extractId(url);
  if (!title || !url || !id) return null;

  const price = comps.price || {};
  const atual = price.current_price?.value ?? null;
  let anterior = null;
  for (const lbl of lista(price.price_labels)) {
    for (const v of lbl.values || []) if (v.type === 'price' && v.price?.previous) anterior = v.price.value;
  }
  // Formato do card da página "social" (links meli.la): previous_price / discount_label.
  if (anterior === null && price.previous_price?.value) anterior = price.previous_price.value;
  const descontoTxt = renderTemplate(price.discount_polylabel) || price.discount_label?.text || null;
  let descontoPct = descontoTxt ? parseInt(descontoTxt, 10) : null;
  if (!descontoPct && anterior && atual) descontoPct = Math.round((1 - atual / anterior) * 100);

  const cupom = lista(comps.promotions)
    .filter((p) => p.type === 'coupon')
    .map(renderTemplate)
    .filter(Boolean)[0] || null;

  const envio = lista(comps.shipping_v2).concat(lista(comps.shipping));
  const frete = envio.map(renderTemplate).filter(Boolean).join(' · ') || null;
  const full = JSON.stringify(envio).includes('full_icon');

  const sellerVals = comps.seller?.values || [];
  const vendedor =
    sellerVals.find((v) => v.type === 'label')?.label?.text ||
    (renderTemplate(comps.seller) || '').replace(/^Por\s+/i, '').trim() ||
    null;
  const lojaOficial = sellerVals.some((v) => v.icon?.icon_id === 'icon_cockade');

  // Nota e vendas vêm em rótulos ("4.7", "| +250mil vendidos"). Produto sem avaliação traz SÓ o de vendas,
  // na primeira posição — por isso cada um é achado pelo conteúdo, não pela posição.
  const reviewTextos = (comps.review_compacted?.values || []).filter((v) => v.type === 'label').map((v) => String(v.label?.text || '').trim());
  const notaTxt = reviewTextos.find((t) => /^\d(?:[.,]\d)?$/.test(t));
  const nota = notaTxt ? parseFloat(notaTxt.replace(',', '.')) : null;
  const vendidos = reviewTextos.find((t) => /vendid/i.test(t))?.replace(/^\|\s*/, '') || null;

  const picId = card.pictures?.pictures?.[0]?.id;
  let fimRelampago = null;
  for (const w of lista(card.widget_components)) {
    const end = w.poly_label_component?.countdown?.period_end;
    if (end) fimRelampago = end;
  }

  return {
    id,
    nome: title,
    url,
    imagem: imageUrlFromId(picId),
    precoAtual: atual,
    precoOriginal: anterior,
    descontoPct: Number.isFinite(descontoPct) ? descontoPct : null,
    precoObs: price.unit_description?.text || (/no pix/i.test(descontoTxt || '') ? 'no Pix' : null), // ex.: "no Pix"
    parcelamento: renderTemplate(price.installments),
    cupom,
    frete,
    full,
    vendedor,
    lojaOficial,
    nota: Number.isFinite(nota) ? nota : null,
    vendidos,
    fimRelampago,
  };
}

export function parseFromState(state) {
  const items = state?.appProps?.pageProps?.data?.items;
  if (!Array.isArray(items)) return [];
  // Um card fora do padrão não pode derrubar a página inteira.
  return items
    .map((it) => {
      try {
        return it?.card && productFromCard(it.card);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 2) HTML poly-card (lógica do curso, com o seletor de desconto corrigido)
// ---------------------------------------------------------------------------

function extractMoney(block) {
  if (!block) return null;
  const frac = block.match(/data-andes-money-amount-fraction="true"[^>]*>([^<]+)</);
  const cents = block.match(/data-andes-money-amount-cents="true"[^>]*>([^<]+)</);
  if (!frac) return null;
  const n = parseFloat(`${frac[1].replace(/\D/g, '')}.${cents ? cents[1].replace(/\D/g, '') : '0'}`);
  return Number.isFinite(n) ? n : null;
}

export function parsePolyCards(html) {
  const starts = [...html.matchAll(/<div\b[^>]*class="[^"]*\bpoly-card\b[^"]*"[^>]*>/g)].map((m) => m.index);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], starts[i + 1] ?? html.length);
    const t = card.match(/<a\b([^>]*class="[^"]*\bpoly-component__title\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/);
    if (!t) continue;
    const href = t[1].match(/href="([^"]+)"/)?.[1];
    const url = cleanProductUrl(href);
    const id = extractId(url);
    const nome = cleanText(t[2]);
    const img = card.match(/<img\b([^>]*class="[^"]*\bpoly-component__picture\b[^"]*"[^>]*)\/?>/);
    const src = img && (img[1].match(/\ssrc="([^"]+)"/) || img[1].match(/\sdata-src="([^"]+)"/))?.[1];
    const anterior = extractMoney(card.match(/<s\s[^>]*andes-money-amount--previous[\s\S]*?<\/s>/)?.[0]);
    const atual = extractMoney(card.match(/<div class="poly-price__current">([\s\S]*?)<\/div>/)?.[1]);
    // O curso usava "poly-price__disc_label" — o ML trocou para "poly-price__discount-polylabel".
    const disc = card.match(
      /class="[^"]*poly-price__(?:discount-polylabel|disc_label)[^"]*"[^>]*>([\s\S]*?)<\/span>(?:<\/span>)?/
    );
    const descontoPct = disc ? parseInt(cleanText(disc[1]), 10) : anterior && atual ? Math.round((1 - atual / anterior) * 100) : null;
    const cupomM = card.match(/poly-coupons__pill[^>]*>([\s\S]*?)<\/span>\s*<\/div>/);
    if (!nome || !url || !id) continue;
    out.push({
      id,
      nome,
      url,
      imagem: normalizeImageUrl(src),
      precoAtual: atual,
      precoOriginal: anterior,
      descontoPct: Number.isFinite(descontoPct) ? descontoPct : null,
      precoObs: cleanText(card.match(/poly-price__unit-description[^>]*>([^<]*)</)?.[1]) || null,
      parcelamento: null,
      cupom: cupomM ? cleanText(cupomM[1].replace(/<span[^>]*andes-visually-hidden[^>]*>[^<]*<\/span>/g, '')).replace(/R\$\s*/, 'R$ ') : null,
      frete: /Frete grátis/.test(card) ? 'Frete grátis' : null,
      full: /Enviado pelo FULL|full_icon/i.test(card),
      vendedor: null,
      lojaOficial: false,
      nota: parseFloat(card.match(/Classificação ([\d.]+) de 5/)?.[1]) || null,
      vendidos: cleanText(card.match(/>\s*\|?\s*((?:\+|mais de\s*)?[\d.,]+\s*(?:mil|milhões|milhão|M)?\s*vendid[oa]s?)\s*</i)?.[1]) || null,
      fimRelampago: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3) HTML dynamic-carousel (lógica do curso)
// ---------------------------------------------------------------------------

export function parseDynamicCarousel(html) {
  const re = /<div class="dynamic-carousel__item-container">[\s\S]*?<h3 class="dynamic-carousel__title">([\s\S]*?)<\/h3>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    const url = cleanProductUrl(block.match(/<a class="splinter-link"\s+href="([^"]+)"/)?.[1]);
    const id = extractId(url);
    const nome = cleanText(m[1]);
    if (!nome || !url || !id) continue;
    const old = block.match(/<span\s+class="dynamic-carousel__oldprice">([^<]+)<\/span>/)?.[1];
    const pm = block.match(
      /<span class="dynamic-carousel__price">[\s\S]*?<span>([^<]+)<\/span>(?:\s*<sup class="dynamic-carousel__price-decimals">([^<]+)<\/sup>)?/
    );
    const atual = pm ? parseBRL(pm[2] ? `${pm[1]},${pm[2]}` : pm[1]) : null;
    const disc = block.match(/<sup\s+class="dynamic-carousel__discount">([^<]+)<\/sup>/)?.[1];
    out.push({
      id,
      nome,
      url,
      imagem: normalizeImageUrl(block.match(/<img[^>]*\ssrc="([^"]+)"/)?.[1]),
      precoAtual: atual,
      precoOriginal: parseBRL(old),
      descontoPct: disc ? parseInt(disc, 10) : null,
      precoObs: null, parcelamento: null, cupom: null, frete: null, full: false,
      vendedor: null, lojaOficial: false, nota: null, vendidos: null, fimRelampago: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Ponto de entrada: devolve a lista de produtos sem duplicatas. */
export function parseOffersPage(html) {
  let produtos = parseFromState(extractEmbeddedState(html));
  let fonte = 'json';
  if (!produtos.length) {
    produtos = parsePolyCards(html);
    fonte = 'html-polycard';
  }
  if (!produtos.length) {
    produtos = parseDynamicCarousel(html);
    fonte = 'html-carousel';
  }
  const seen = new Set();
  produtos = produtos.filter((p) => p.precoAtual && p.imagem && !seen.has(p.id) && seen.add(p.id));
  return { produtos, fonte };
}
