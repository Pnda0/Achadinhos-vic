/**
 * Canais PÚBLICOS do Telegram como fonte do espelho (config/fontes.json > "canaisTelegram").
 *
 * Bot do Telegram não consegue ler canal dos outros, mas todo canal público tem uma página aberta
 * (https://t.me/s/<canal>) com as últimas mensagens. Lemos essa página — não a Amazon — e o espelho
 * troca o link pela etiqueta do dono e monta a oferta no nosso formato.
 */
import { settings } from './config.js';
import { log, normalizar } from './util.js';

const PREFIXO = 'canal:';
export const jidDoCanal = (nome) => PREFIXO + String(nome).trim().replace(/^(https?:\/\/)?t\.me\/(s\/)?/i, '').replace(/^@/, '').replace(/\/.*$/, '');

/**
 * As fontes do espelho a partir do bloco "canaisTelegram". Cada item de "canais" é o nome do canal (usa as opções
 * do bloco) ou um objeto que troca algumas delas:
 *   { "canal": "x", "destino": "Perfumes", "soAmazon": false, "exigirVendas": false, "fotoDoCanal": true, "maxPorHora": 12 }
 * "exigirVendas": false = o dono liberou este canal da regra de mais de 50 vendas do ML (o espelho não lê vendas).
 * "fotoDoCanal": true = a oferta do ML sai com a foto da mensagem do canal, não com a do anúncio (fundo branco).
 * "copiarTexto": true = o post sai IGUAL ao do canal (texto e foto), só com os links trocados pelos do dono.
 * "apenasAmazon": true = do canal só interessam as ofertas da Amazon (ML, Shopee e Awin são ignorados); com
 * "copiarTexto": false, o post é montado no formato do bot (nome, preço, cupom) com a etiqueta do dono.
 * "mlPeloNome": true = a oferta do Mercado Livre também entra: o produto é achado pela API oficial com o nome e o
 * preço do post (o link meli.la só abre no site do ML, que barra o bot) — src/espelho.js, processarMLPeloNome.
 * "exigirVendas", "fotoDoCanal", "copiarTexto" e "mlPeloNome" também valem no bloco, para todos os canais.
 */
export function fontesDosCanais(c, { destinoPadrao = 'Geral', nichos = {}, lojasParceiras = false, amazonTag = '' } = {}) {
  const destino = c.destino || destinoPadrao;
  // Cada destino pode ter um nicho: a oferta só entra naquele grupo se o nome casar com as palavras dele.
  const comPalavras = (lista) => lista.map((d) => ({ grupo: d.grupo, palavras: d.nicho ? nichos[d.nicho]?.obrigatorias || [] : null }));
  const destinos = comPalavras(c.destinos?.length ? c.destinos : [{ grupo: destino }]);
  return (c.canais || [])
    .filter(Boolean)
    .map((item) => {
      const o = typeof item === 'string' ? { canal: item } : item;
      const jid = jidDoCanal(o.canal);
      const nome = `@${jid.slice(PREFIXO.length)}`;
      const apenasAmazon = !!(o.apenasAmazon ?? c.apenasAmazon);
      const soAmazon = apenasAmazon || (o.soAmazon ?? c.soAmazon) !== false;
      const proprios = o.destinos?.length ? comPalavras(o.destinos) : o.destino ? comPalavras([{ grupo: o.destino }]) : null;
      return {
        nome, nomeWhats: nome, jid, destino: o.destino || destino, destinos: proprios || destinos, soAmazon, apenasAmazon, lojasParceiras: lojasParceiras && !apenasAmazon,
        exigirVendas: (o.exigirVendas ?? c.exigirVendas) !== false,
        fotoDoCanal: !!(o.fotoDoCanal ?? c.fotoDoCanal),
        copiarTexto: !!(o.copiarTexto ?? c.copiarTexto),
        mlPeloNome: !!(o.mlPeloNome ?? c.mlPeloNome),
        ...(Number.isInteger(o.maxPorHora) && { maxPorHora: o.maxPorHora }),
      };
    })
    .filter((f) => (f.apenasAmazon ? amazonTag : !f.soAmazon || lojasParceiras || amazonTag)); // "só Amazon" sem etiqueta (e sem Awin) não aproveita nada
}

/**
 * Grupo do Telegram como fonte (config/fontes.json > "gruposTelegram"; pedido do dono, 27/10/2026). Grupo não tem
 * página pública como os canais: o bot precisa ser membro (e com a privacidade desligada no @BotFather) e lê as
 * mensagens pela mesma conversa com o Telegram da caixa de entrada. O item de "grupos" casa com o título do grupo
 * ({ "titulo": "Promo da Luh" } casa com "A Promo da Luh 🛍🌸"). Null se o grupo não estiver na lista.
 * "semML" (padrão true): links do ML ficam de fora — trocar exigiria abrir a página de cada um no ML.
 */
export function fonteDoGrupoTelegram(c, { jid, titulo }, { nichos = {}, lojasParceiras = false } = {}) {
  if (!c || c.ativo === false) return null;
  const item = (c.grupos || []).map((x) => (typeof x === 'string' ? { titulo: x } : x)).find((x) => x?.titulo && normalizar(titulo).includes(normalizar(x.titulo)));
  if (!item) return null;
  const o = { ...c, ...item };
  const destinos = (o.destinos?.length ? o.destinos : [{ grupo: o.destino || 'Geral' }]).map((d) => ({ grupo: d.grupo, palavras: d.nicho ? nichos[d.nicho]?.obrigatorias || [] : null }));
  return {
    nome: titulo, nomeWhats: titulo, jid: String(jid), destino: destinos[0].grupo, destinos,
    semML: o.semML !== false, lojasParceiras: lojasParceiras && o.lojasParceiras !== false,
    exigirVendas: o.exigirVendas !== false, fotoDoCanal: !!o.fotoDoCanal, copiarTexto: !!o.copiarTexto,
    ...(Number.isInteger(o.maxPorHora) && { maxPorHora: o.maxPorHora }),
  };
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodificar = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (tudo, e) => {
    if (e[0] !== '#') return ENTIDADES[e.toLowerCase()] ?? tudo;
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : tudo;
  });

/** Mensagens da página t.me/s/<canal>: [{ id, jid, t (segundos), tipo, texto, textoVisivel, links, foto }]. */
export function parseCanal(html, canal) {
  const saida = [];
  for (const bloco of String(html || '').split('<div class="tgme_widget_message_wrap').slice(1)) {
    const post = bloco.match(/data-post="([^"]+)"/)?.[1];
    const corpo = bloco.match(/<div class="tgme_widget_message_text js-message_text[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (!post || !corpo) continue;
    const links = [...corpo.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => decodificar(m[1]));
    const texto = decodificar(corpo.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    const data = bloco.match(/tgme_widget_message_date[^>]*><time datetime="([^"]+)"/)?.[1];
    const foto = bloco.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/)?.[1] || null;
    saida.push({
      id: `tgc-${post}`,
      jid: PREFIXO + canal,
      t: data ? Math.floor(new Date(data).getTime() / 1000) : 0,
      tipo: foto ? 'image' : 'chat',
      texto: [...new Set([texto, ...links])].join('\n').slice(0, 4000),
      textoVisivel: texto.slice(0, 4000), // o post como aparece (para copiar trocando só os links)
      links, // inclusive os escondidos atrás de palavras ("COMPRE AQUI")
      foto,
    });
  }
  return saida;
}

/** "Sender" só de leitura para o Espelho: lê os canais pedidos; canal fora do ar não derruba os outros. */
export class LeitorDeCanais {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async lerMensagens(jids) {
    const saida = [];
    for (const jid of jids) {
      const canal = jid.slice(PREFIXO.length);
      try {
        const res = await this.fetch(`https://t.me/s/${canal}`, { headers: { 'user-agent': settings.userAgent }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const msgs = parseCanal(await res.text(), canal);
        if (!msgs.length) log(`  🪞 canal @${canal}: nenhuma mensagem (o canal existe e é público?)`);
        saida.push(...msgs);
      } catch (e) {
        log(`  🪞 canal @${canal} não abriu (${String(e.message).split('\n')[0]})`);
      }
    }
    return saida;
  }
}
