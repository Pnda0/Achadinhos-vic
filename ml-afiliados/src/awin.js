/**
 * Awin — rede de afiliados de lojas como adidas, Centauro, Granado, Soldiers Nutrition...
 *
 * O que o bot faz com ela:
 *   1. link de afiliado: troca o link de uma loja parceira pelo link da Awin com o SEU id de afiliado;
 *   2. cupons e promoções: lê na API oficial as ofertas das lojas em que você foi APROVADO e posta nos grupos;
 *   3. espelho: link de loja parceira visto num canal acompanhado (ou mandado na caixa de entrada) entra com o seu link.
 *
 * Credenciais no .env:
 *   AWIN_API_TOKEN     (https://ui.awin.com/awin-api > "Create token"; só o dono da conta vê)
 *   AWIN_PUBLISHER_ID  (opcional: com o token o bot descobre sozinho)
 * Lojas e o grupo de cada uma: config/awin.json. A Awin só paga comissão de loja em que a conta foi aprovada,
 * então o bot só usa as lojas que a API devolve como "joined" (ou marcadas com "aprovado": true no arquivo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from './config.js';
import { casaTermo, log, normalizar, sleep } from './util.js';

const env = process.env;
export const awinCfg = () => ({
  token: (env.AWIN_API_TOKEN || env.API_KEY_AWIN)?.trim() || '', // API_KEY_AWIN: nome que o dono usou no .env
  publisherId: env.AWIN_PUBLISHER_ID?.trim() || '',
  apiUrl: (env.AWIN_API_URL?.trim() || 'https://api.awin.com').replace(/\/$/, ''),
});

export function loadAwin() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/awin.json'), 'utf8'));
    return { ativo: cfg.ativo !== false, grupoGeral: cfg.grupoGeral ?? 'Geral', linkCurto: cfg.linkCurto !== false, cupons: { ativo: true, maxPorColeta: 2, diasSemRepetir: 7, ...(cfg.cupons || {}) }, anunciantes: cfg.anunciantes || [] };
  } catch {
    return { ativo: false, grupoGeral: 'Geral', linkCurto: true, cupons: { ativo: false }, anunciantes: [] };
  }
}

const HOST_AWIN = /(^|\.)awin1\.com$/i;
const HOST_CURTO = /^(tidd\.ly|bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.co|rebrand\.ly|encurtador\.com\.br|abre\.ai)$/i;
const hostDe = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};
// Parâmetros de rastreio de OUTROS afiliados/campanhas: saem do link antes de ele ganhar o nosso.
const RASTREIO = /^(utm_\w+|awc|awaid|sv1|sv_campaign_id|gclid|fbclid|msclkid|zanpid|clickref\d?|aff\w*|parceiro|origem|source|campaign|cmpid|ranmid|raneaid|ransiteid|irclickid|irgwc)$/i;

/** "Centauro BR" -> "Centauro" (o nome que aparece na oferta). */
export const nomeDaLoja = (nome) => String(nome || '').replace(/\s+(BR|Brasil|Brazil)$/i, '').trim();

/** Tira do link da loja os parâmetros de rastreio de quem divulgou antes. */
export function limparUrlLoja(url) {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (RASTREIO.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

/** Link de afiliado "na mão" (sem API): o formato público de deep link da Awin. */
export function linkAwin(advertiserId, publisherId, url) {
  return `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${publisherId}${url ? `&ued=${encodeURIComponent(url)}` : ''}`;
}

/** De um link da Awin de OUTRO afiliado, tira a loja (id) e a página de destino. Null se não for link da Awin. */
export function lerLinkAwin(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!HOST_AWIN.test(u.hostname)) return null;
  const id = Number(u.searchParams.get('awinmid') || u.searchParams.get('mid') || u.searchParams.get('v')) || null;
  const destino = (u.searchParams.get('ued') || u.searchParams.get('p') || '').replace(/^\[\[|\]\]$/g, '');
  return { id, destino: /^https?:\/\//i.test(destino) ? destino : null };
}

/** A loja (entre as aprovadas) dona deste endereço. */
export function lojaDaUrl(url, anunciantes) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return anunciantes.find((a) => (a.dominios || []).some((d) => host === d || host.endsWith(`.${d}`))) || null;
}

/** Links de um texto que podem ser de loja (tudo menos Mercado Livre, Amazon, WhatsApp e Telegram). */
export function extrairLinksLoja(texto) {
  const achados = String(texto || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  const links = [];
  for (let u of achados) {
    u = u.replace(/[).,;!?\]*_~]+$/, '');
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (/(^|\.)(mercadoli[vb]re\.com(\.br)?|meli\.la|amazon\.com\.br|amzn\.to|a\.co|amzn\.com|link\.amazon|amzlinks\.in|shopee\.com\.br|shope\.ee|shp\.ee|whatsapp\.com|t\.me|telegram\.me|wa\.me)$/.test(host)) continue;
      if (!links.includes(u)) links.push(u);
    } catch {}
  }
  return links;
}

// Só estes encurtadores são seguidos (o tidd.ly é o da própria Awin). Link de outro site é ignorado:
// seguir qualquer endereço postado num canal seria abrir páginas à toa e gerar clique para outras redes.
const ENCURTADOR = HOST_CURTO;

/**
 * Do link que apareceu na mensagem até a página da loja parceira: { anunciante, url } ou null.
 * Link direto da loja e link da Awin de outro afiliado são lidos sem abrir nada; encurtadores conhecidos
 * são seguidos só pelos redirecionamentos (sem baixar a página da loja).
 */
export async function resolverLinkLoja(url, anunciantes, { fetchImpl = fetch, maxSaltos = 5 } = {}) {
  let atual = url;
  for (let i = 0; i <= maxSaltos; i++) {
    const awin = lerLinkAwin(atual);
    if (awin) {
      const porId = anunciantes.find((a) => a.id === awin.id);
      const loja = (awin.destino && lojaDaUrl(awin.destino, anunciantes)) || porId;
      if (!loja) return null; // loja em que a conta não foi aprovada
      return { anunciante: loja, url: awin.destino ? limparUrlLoja(awin.destino) : null };
    }
    const loja = lojaDaUrl(atual, anunciantes);
    if (loja) return { anunciante: loja, url: limparUrlLoja(atual) };
    if (i === maxSaltos) break;
    let host;
    try {
      host = new URL(atual).hostname;
    } catch {
      return null;
    }
    if (!ENCURTADOR.test(host)) return null;
    let destino;
    for (const method of ['HEAD', 'GET']) {
      const res = await fetchImpl(atual, { method, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      res.body?.cancel?.().catch(() => {});
      destino = res.headers?.get?.('location');
      if (destino) break;
    }
    if (!destino) return null;
    atual = new URL(destino, atual).toString();
  }
  return null;
}

const CACHE_FILE = path.join(DATA_DIR, 'awin-programas.json');
const LINKS_FILE = path.join(DATA_DIR, 'awin-links.json');

export class Awin {
  constructor(cfg = awinCfg(), { fetchImpl = fetch, pausaMs = 3200, arquivoCache = CACHE_FILE, arquivoLinks = LINKS_FILE, config = loadAwin(), agora = () => Date.now() } = {}) {
    this.cfg = cfg;
    this.arquivoLinks = arquivoLinks;
    this.config = config;
    this.fetch = fetchImpl;
    this.pausaMs = pausaMs; // a API da Awin aceita 20 chamadas por minuto
    this.arquivoCache = arquivoCache;
    this.agora = agora;
    this.ultimaChamada = 0;
    this.publisherId = cfg.publisherId || null;
    this.lista = null;
    this.listaEm = 0;
  }

  /** Dá para falar com a API (cupons, lista de lojas aprovadas, link curto)? */
  configurada() {
    return Boolean(this.config.ativo && this.cfg.token);
  }

  /** Dá para montar link de afiliado? Basta o id de afiliado (com o token ele é descoberto). */
  ligada() {
    return Boolean(this.config.ativo && (this.cfg.token || this.cfg.publisherId));
  }

  async chamar(method, caminho, corpo) {
    const espera = this.ultimaChamada + this.pausaMs - this.agora();
    if (espera > 0) await sleep(espera);
    this.ultimaChamada = this.agora();
    const res = await this.fetch(`${this.cfg.apiUrl}${caminho}`, {
      method,
      headers: { authorization: `Bearer ${this.cfg.token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await res.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {}
    if (!res.ok) {
      const err = new Error(`Awin ${caminho.split('?')[0]} HTTP ${res.status}: ${json?.description || json?.error || json?.message || texto.slice(0, 160)}`);
      err.status = res.status;
      if (res.status === 401 || res.status === 403) err.message += ' — confira AWIN_API_TOKEN (https://ui.awin.com/awin-api).';
      throw err;
    }
    return json;
  }

  /** Id de afiliado (publisher). Sem AWIN_PUBLISHER_ID, pergunta à API quais contas o token enxerga. */
  async publisher() {
    if (this.publisherId) return this.publisherId;
    const r = await this.chamar('GET', '/accounts?type=publisher');
    const contas = (r?.accounts || (Array.isArray(r) ? r : [])).filter((c) => !c.accountType || c.accountType === 'publisher');
    if (!contas.length) throw new Error('Awin: o token não enxerga nenhuma conta de afiliado (publisher).');
    if (contas.length > 1) log(`  Awin: o token vê ${contas.length} contas; usando "${contas[0].accountName}" (${contas[0].accountId}). Para outra, preencha AWIN_PUBLISHER_ID.`);
    this.publisherId = String(contas[0].accountId);
    return this.publisherId;
  }

  /** Lojas com um certo relacionamento ("joined" = aprovado, "pending" = pedido em análise). */
  async programas(relacionamento = 'joined') {
    const id = await this.publisher();
    const r = await this.chamar('GET', `/publishers/${id}/programmes?relationship=${relacionamento}`);
    return (Array.isArray(r) ? r : []).map((p) => ({
      id: Number(p.id),
      nome: nomeDaLoja(p.name),
      dominios: [...new Set([p.displayUrl, ...(p.validDomains || []).map((d) => d.domain)].map(dominioDe).filter(Boolean))],
      pais: p.primaryRegion?.countryCode || null,
    }));
  }

  /**
   * Lojas que o bot pode usar: as aprovadas segundo a API (guardadas em data/ por 12h) somadas às marcadas
   * com "aprovado": true em config/awin.json. Cada uma sai com os grupos definidos no arquivo.
   */
  async anunciantes({ validadeMs = 12 * 3_600_000 } = {}) {
    if (this.lista && this.agora() - this.listaEm < validadeMs) return this.lista;
    const doArquivo = new Map(this.config.anunciantes.map((a) => [Number(a.id), a]));
    let aprovadas = this.config.anunciantes.filter((a) => a.aprovado).map((a) => ({ id: Number(a.id), nome: a.nome, dominios: a.dominios || [] }));
    if (this.cfg.token) {
      let cache = null;
      try {
        cache = JSON.parse(fs.readFileSync(this.arquivoCache, 'utf8'));
      } catch {}
      if (cache && this.agora() - cache.em < validadeMs) {
        this.publisherId ||= cache.publisherId || null;
        aprovadas = cache.programas;
      } else {
        try {
          aprovadas = await this.programas('joined');
          fs.writeFileSync(this.arquivoCache, JSON.stringify({ em: this.agora(), publisherId: this.publisherId, programas: aprovadas }, null, 2), 'utf8');
        } catch (e) {
          if (!cache) throw e;
          log(`  ⚠️  Awin: não consegui atualizar a lista de lojas (${String(e.message).split('\n')[0]}) — usando a última conhecida.`);
          aprovadas = cache.programas;
        }
      }
    }
    this.lista = aprovadas.map((p) => {
      const a = doArquivo.get(p.id);
      return { id: p.id, nome: nomeDaLoja(a?.nome || p.nome), dominios: [...new Set([...(p.dominios || []), ...(a?.dominios || [])])], grupos: a?.grupos || [] };
    });
    this.listaEm = this.agora();
    return this.lista;
  }

  /**
   * Link de afiliado para uma página da loja. Com token, tenta o link curto oficial da Awin (tidd.ly) e só o usa
   * depois de conferir que ele redireciona para um link com o NOSSO id de afiliado; o link curto fica guardado
   * (data/awin-links.json) para não pedir de novo. Qualquer falha: o link longo oficial (awin1.com), que sempre vale.
   */
  async gerarLink(anunciante, url) {
    const id = await this.publisher();
    // Link já encurtado (de outro afiliado ou de outro serviço) não é embrulhado nem encurtado de novo: o destino
    // dele é desconhecido e a comissão poderia ir para outra pessoa. Quem chama resolve até a página da loja antes.
    if (url && (HOST_CURTO.test(hostDe(url)) || HOST_AWIN.test(hostDe(url)))) throw new Error('link já encurtado/de afiliado: resolva até a página da loja antes');
    const longo = linkAwin(anunciante.id, id, url);
    if (!this.cfg.token || !this.config.linkCurto || !url || this.semLinkCurto) return longo;
    const chave = `${anunciante.id}|${url}`;
    const cache = this.lerCacheLinks();
    const guardado = cache[chave];
    if (typeof guardado === 'string') return guardado;
    if (guardado?.falhaEm && this.agora() - guardado.falhaEm < 24 * 3_600_000) return longo; // falhou há pouco: não insiste
    let motivo;
    try {
      const r = await this.chamar('POST', `/publishers/${id}/linkbuilder/generate`, { advertiserId: anunciante.id, destinationUrl: url, shorten: true });
      if (r?.shortUrl && (await this.linkCurtoEhNosso(r.shortUrl, id))) {
        this.gravarCacheLinks({ ...cache, [chave]: r.shortUrl });
        return r.shortUrl;
      }
      motivo = 'o link curto não confirmou o nosso id de afiliado';
    } catch (e) {
      motivo = String(e.message).split('\n')[0].slice(0, 120);
      if (e.status === 401 || e.status === 403) {
        this.semLinkCurto = true; // a conta não tem o gerador de links: não tenta mais até o bot religar
        log(`  Awin: gerador de link curto indisponível para a conta (${motivo}) — usando o link longo até o bot religar.`);
      }
    }
    this.gravarCacheLinks({ ...cache, [chave]: { falhaEm: this.agora() } });
    if (!this.semLinkCurto) log(`  Awin: link curto não saiu (${motivo}) — usando o link longo (tento de novo em 24h).`);
    return longo;
  }

  /**
   * O link curto leva a um link da Awin com o NOSSO id? Olha só o 1º redirecionamento (não abre a loja nem o
   * awin1.com, onde o clique é registrado). Roda uma vez por link novo — o resultado bom fica no cache.
   */
  async linkCurtoEhNosso(curto, publisherId) {
    // HEAD primeiro; se o encurtador não responder o redirecionamento a um HEAD, GET — também sem seguir.
    for (const method of ['HEAD', 'GET']) {
      try {
        const res = await this.fetch(curto, { method, redirect: 'manual', signal: AbortSignal.timeout(5_000) });
        res.body?.cancel?.().catch(() => {});
        const destino = res.headers?.get?.('location');
        if (!destino) continue;
        const u = new URL(destino, curto);
        return HOST_AWIN.test(u.hostname) && u.searchParams.get('awinaffid') === String(publisherId);
      } catch {}
    }
    return false;
  }

  lerCacheLinks() {
    try {
      return JSON.parse(fs.readFileSync(this.arquivoLinks, 'utf8'));
    } catch {
      return {};
    }
  }

  gravarCacheLinks(cache) {
    try {
      const entradas = Object.entries(cache).slice(-2000); // não cresce para sempre
      fs.writeFileSync(this.arquivoLinks, JSON.stringify(Object.fromEntries(entradas)), 'utf8');
    } catch {}
  }

  /** Cupons e promoções ativos no Brasil das lojas aprovadas (API "promotions"). */
  async promocoes({ advertiserIds, paginas = 2 } = {}) {
    const id = await this.publisher();
    const saida = [];
    for (let page = 1; page <= paginas; page++) {
      const r = await this.chamar('POST', `/publisher/${id}/promotions`, {
        filters: { membership: 'joined', status: 'active', type: 'all', regionCodes: ['BR'], ...(advertiserIds?.length ? { advertiserIds } : {}) },
        pagination: { page, pageSize: 200 },
      });
      const lista = r?.data || r?.promotions || (Array.isArray(r) ? r : []);
      saida.push(...lista);
      if (lista.length < 200) break;
    }
    return saida;
  }
}

function dominioDe(v) {
  if (!v) return null;
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const limpo = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Converte um cupom/promoção da API no formato de oferta do bot. Null se não serve (vencido, sem link...). */
/**
 * Arte do post de cupom (pasta assets/): a da loja, com o logo dela em destaque ("cupom-17648.jpg"), ou a genérica
 * no estilo da logo da Vic ("cupom.jpg"). `tipo` = 'cupom' (tem código) ou 'promo' (sem código).
 * Para criar a arte de uma loja nova: assets/arte-loja.html + o logo em assets/logos/<id>.svg (README, seção 3.13).
 */
export function arteDoCupom(idLoja, tipo) {
  const daLoja = `assets/${tipo}-${idLoja}.jpg`;
  return fs.existsSync(path.join(ROOT, daLoja)) ? daLoja : `assets/${tipo}.jpg`;
}

export function ofertaDeCupom(promo, anunciante, grupo, { agora = Date.now() } = {}) {
  const titulo = limpo(promo?.title);
  const link = promo?.urlTracking || null;
  if (!promo?.promotionId || !titulo || !link) return null;
  const fim = promo.endDate ? new Date(`${String(promo.endDate).replace(/Z$/, '')}Z`).getTime() : null;
  const inicio = promo.startDate ? new Date(`${String(promo.startDate).replace(/Z$/, '')}Z`).getTime() : null;
  if (fim && fim < agora) return null;
  if (inicio && inicio > agora + 3_600_000) return null;
  const codigo = limpo(promo.voucher?.code) || null;
  const descricao = limpo(promo.description);
  const pct = `${titulo} ${descricao}`.match(/(\d{1,2})\s?%/);
  return {
    id: `AWP-${promo.promotionId}`,
    loja: 'awin',
    lojaNome: anunciante.nome,
    tipo: 'cupom',
    origem: 'awin',
    prioridade: true,
    grupo,
    categoria: `Awin: ${anunciante.nome}`,
    nome: titulo,
    descricao: descricao && descricao.toLowerCase() !== titulo.toLowerCase() ? descricao.slice(0, 220) : null,
    url: promo.url || link,
    linkAfiliado: link,
    imagem: arteDoCupom(anunciante.id, codigo ? 'cupom' : 'promo'),
    precoAtual: null,
    precoOriginal: null,
    descontoPct: pct ? Number(pct[1]) : null,
    cupom: codigo,
    validade: fim ? new Date(fim).toISOString() : null,
    nota: null,
    adicionadoEm: promo.dateAdded || null,
  };
}

/**
 * Uma rodada de cupons da Awin. Devolve { produtos, categorias, motivo } como a Amazon.
 * Cada loja manda os cupons para os grupos dela (config/awin.json) e para o grupo geral; no máximo
 * `maxPorColeta` cupons novos por grupo a cada busca, primeiro os que têm código.
 */
export async function buscarCuponsAwin({ api = new Awin(), grupos = [], jaTem = () => false, temCupomHoje = () => false } = {}) {
  const cfg = api.config;
  if (!cfg.ativo || !cfg.cupons?.ativo) return { produtos: [], categorias: {}, motivo: 'desligada em config/awin.json' };
  if (!api.configurada()) return { produtos: [], categorias: {}, motivo: 'falta AWIN_API_TOKEN no .env' };
  const lojas = await api.anunciantes();
  if (!lojas.length) return { produtos: [], categorias: {}, motivo: 'nenhuma loja aprovada na conta da Awin ainda' };
  const porId = new Map(lojas.map((l) => [l.id, l]));
  const ativos = new Set(grupos.filter((g) => g.ativo).map((g) => g.nome));
  const promos = (await api.promocoes()).sort((a, b) => Boolean(b.voucher?.code) - Boolean(a.voucher?.code) || String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')));
  const produtos = [];
  const porGrupo = {};
  const max = Number(cfg.cupons.maxPorColeta) || 2;
  // Grupo de nicho também recebe cupom de qualquer loja quando o texto do cupom é do tema dele
  // (ex.: "Perfumes com 20% OFF" de uma loja de moda vai para o grupo Perfumes).
  const nichos = grupos.filter((g) => g.ativo && g.filtros?.palavrasObrigatorias?.length);
  const doTema = (texto) =>
    nichos.filter((g) => g.filtros.palavrasObrigatorias.some((t) => casaTermo(texto, t)) && !(g.filtros.palavrasBloqueadas || []).some((t) => casaTermo(texto, t))).map((g) => g.nome);
  // A ressalva do cupom ("não aplica em perfumes, maquiagem..."): o grupo cujo tema aparece nela fica sem esse cupom.
  const RESSALVA = /\b(nao|exceto|exclu\w*|menos|salvo|fora)\b(.*)$/;
  const porNome = new Map(grupos.map((g) => [g.nome, g]));
  const excluiGrupo = (promo, nome) => {
    const m = normalizar(promo.title).match(RESSALVA);
    return !!m && (porNome.get(nome)?.filtros?.palavrasObrigatorias || []).some((t) => casaTermo(m[2], t));
  };
  // 1ª passada: lojas do grupo e cupons do tema dele. 2ª passada (pedido do dono, 21/10/2026: "pelo menos 1 cupom de
  // loja por dia"): grupo que ainda está sem cupom hoje recebe o melhor cupom de qualquer loja aprovada que não o exclua.
  for (const passada of [1, 2]) {
    for (const promo of promos) {
      const loja = porId.get(Number(promo.advertiser?.id));
      if (!loja) continue;
      // Só o título, e sem as ressalvas: "10% OFF - não aplica em perfumes" NÃO é cupom de perfume.
      const texto = normalizar(promo.title).replace(RESSALVA, '');
      const tema = doTema(texto);
      // 2ª passada: só grupo que ficou sem nenhum cupom, e só cupom sem tema de OUTRO nicho ("Perfumes 20% OFF" não vai pro Fitness).
      const alvos = passada === 1 ? [...(loja.grupos || []), ...tema, cfg.grupoGeral] : [...ativos].filter((g) => !porGrupo[g] && (!tema.length || tema.includes(g)));
      for (const grupo of new Set(alvos.filter((g) => g && ativos.has(g)))) {
        if ((porGrupo[grupo] || 0) >= max || temCupomHoje(grupo) || excluiGrupo(promo, grupo)) continue;
        const p = ofertaDeCupom(promo, loja, grupo);
        if (!p || jaTem(p) || produtos.some((x) => x.id === p.id && x.grupo === grupo)) continue;
        porGrupo[grupo] = (porGrupo[grupo] || 0) + 1;
        produtos.push(p);
      }
    }
  }
  // Link curto oficial (tidd.ly) para a página do cupom, uma vez por promoção; se não der, fica o link de rastreio da API.
  const curtos = new Map();
  for (const p of produtos) {
    const promo = promos.find((x) => `AWP-${x.promotionId}` === p.id);
    if (!promo?.url) continue;
    if (!curtos.has(p.id)) {
      const link = await api.gerarLink(porId.get(Number(promo.advertiser.id)), promo.url).catch(() => null);
      curtos.set(p.id, link && /^https:\/\/tidd\.ly\//.test(link) ? link : null);
    }
    if (curtos.get(p.id)) p.linkAfiliado = curtos.get(p.id);
  }
  return { produtos, categorias: { 'Awin: cupons e promoções': { encontrados: promos.length, aceitos: 0 } } };
}
