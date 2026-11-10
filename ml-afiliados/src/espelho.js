/**
 * Espelho de grupos: lê as ofertas postadas em OUTROS grupos de WhatsApp (os "grupos-fonte",
 * config/fontes.json), descobre o produto do Mercado Livre, gera o link de afiliado do dono do bot
 * e coloca na fila — a mensagem é montada no nosso formato; num canal com "copiarTexto", sai IGUAL ao post do
 * canal (texto e foto), só com os links trocados pelos do dono.
 *
 * Cuidados embutidos:
 *  - só mensagens novas (últimos N minutos) e nunca a mesma mensagem duas vezes;
 *  - limite de ofertas por hora e pausa entre consultas ao Mercado Livre;
 *  - se o ML pedir verificação (captcha) ou recusar o login, o espelho PARA por um tempo em vez de insistir.
 */
import { extrairLinksML, resolverOferta, tipoLink, ErroVerificacao } from './ml/resolver.js';
import { asinDeUrl, dadosDoTexto, extrairLinksAmazon, linkAfiliadoAmazon, resolverLinkAmazon } from './amazon-espelho.js';
import { extrairLinksLoja, resolverLinkLoja } from './awin.js';
import { extrairLinksShopee, urlDoProdutoShopee } from './shopee.js';
import { nomeLoja } from './caption.js';
import { marcaDoProduto } from './marcas.js';
import { evento } from './eventos.js';
import { motivoPeloNome, motivoRecusa } from './pipeline.js';
import { acharPeloNome } from './ml/api.js';
import { encontrarGrupo } from './configfile.js';
import crypto from 'node:crypto';
import { settings } from './config.js';
import { casaTermo, diaLocal, log, normalizar, sleep } from './util.js';

const MIN = 60_000;
const BUSCAS_ML_POR_HORA = 20; // ofertas do ML dos canais procuradas na API oficial (cada uma gasta até ~7 consultas)

/**
 * A foto do post, se pode ser usada. Canal com "fotoDoCanal": false (fontes.json) põe a marca dele nas fotos
 * (ex.: o selo "promoção verificada por @oqcomprei", visto em 15/10/2026): aí vale a foto do anúncio.
 */
export const fotoDaMensagem = (m, fonte) => (fonte?.fotoDoCanal === false ? null : m.foto || null);

/** O preço escrito na mensagem é o mesmo do anúncio? (o canal arredonda: até R$ 1 ou 1% de diferença) */
export const precoBate = (daMensagem, doAnuncio) => !!daMensagem && !!doAnuncio && Math.abs(daMensagem - doAnuncio) <= Math.max(1, doAnuncio * 0.01);

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const limparUrl = (u) => u.replace(/[).,;!?\]*_~]+$/, '');
// Linha que chama para o canal/grupo de origem (convite, @ do canal, "siga", "entre no grupo", só hashtags): não é copiada.
const SO_HASHTAGS = /^\s*(#[\p{L}\p{N}_]+[\s,]*)+$/u; // "#TopFitAchados #Anúncio"
const LINHA_DO_OUTRO = /t\.me\/|telegram\.me\/|chat\.whatsapp|whatsapp\.com\/|wa\.me\/|(^|\s)@[a-z0-9_]{4,}|\b(entre|participe|siga|acesse|convide|compartilhe)\b.*\b(grupo|canal|comunidade|amigos)\b/i;

/**
 * O post do canal como ele é, com os links trocados: `trocar(url)` devolve o link do dono ou null (link que não dá
 * para trocar — outra loja, outro canal — sai, e a linha sai junto se ficar só com uma palavra ou um emoji).
 * Links escondidos atrás de palavras ("COMPRE AQUI") entram no fim como "🛒 <link>". Null se nenhum link foi trocado.
 */
export function textoCopiado(m, trocar) {
  const visivel = String(m.textoVisivel ?? m.texto ?? '');
  const usados = new Set();
  const linhas = [];
  for (const linha of visivel.split('\n')) {
    if (LINHA_DO_OUTRO.test(linha) || SO_HASHTAGS.test(linha)) continue;
    let removeu = false;
    let trocou = false;
    const nova = linha.replace(URL_RE, (u) => {
      const limpo = limparUrl(u);
      const r = trocar(limpo);
      if (r) {
        usados.add(r);
        trocou = true;
        return r + u.slice(limpo.length);
      }
      removeu = true;
      return '';
    });
    if (removeu && !trocou && nova.replace(/[^\p{L}\p{N}]+/gu, '').length < 20) continue;
    linhas.push(nova.replace(/[ \t]+$/, ''));
  }
  for (const u of (m.links || []).map(limparUrl)) {
    const r = trocar(u);
    if (r && !usados.has(r)) {
      linhas.push(`🛒 ${r}`);
      usados.add(r);
    }
  }
  if (!usados.size) return null;
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Liga cada fonte do arquivo ao grupo real do WhatsApp (pelo JID ou pelo nome). */
export function resolverFontes(fontes, gruposWhats) {
  const ok = [];
  const problemas = [];
  for (const f of fontes.filter((x) => x.ativo !== false)) {
    if (f.jid && gruposWhats.some((g) => g.jid === f.jid)) {
      ok.push({ ...f, nomeWhats: gruposWhats.find((g) => g.jid === f.jid).nome });
      continue;
    }
    const { grupo, varios } = encontrarGrupo(gruposWhats, f.nome);
    if (grupo) ok.push({ ...f, jid: grupo.jid, nomeWhats: grupo.nome });
    else problemas.push(varios ? `"${f.nome}": há ${varios.length} grupos com esse nome — escreva o nome completo` : `"${f.nome}": não achei esse grupo neste WhatsApp`);
  }
  return { ok, problemas };
}

/**
 * Lojas sem programa de afiliado do dono que aparecem nos grupos copiados (04/11/2026, o dono: "lá tem várias coisas da
 * Sephora na promoção... ver se no Mercado Livre tem também, se tiver mandar pelo link do ML"). Pelo endereço do link
 * ou, com link encurtado, pelo nome da loja no texto.
 */
const LOJAS_SEM_PROGRAMA = [
  ['Sephora', /sephora/],
  ['Beleza na Web', /belezanaweb|beleza na web/],
  ['Época Cosméticos', /epocacosmeticos|epoca cosmeticos/],
  ['O Boticário', /boticario/],
  ['Natura', /natura\.com|\bnatura\b/],
  ['Eudora', /eudora/],
  ['Magalu', /magazineluiza|magalu/],
  ['Drogasil', /drogasil/],
  ['Droga Raia', /drogaraia|droga raia/],
];

export function lojaSemPrograma(m) {
  const links = [...(m.links || []), ...(String(m.texto || '').match(/https?:\/\/[^\s<>"']+/gi) || [])];
  if (!links.length) return null;
  const hosts = links.map((u) => {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch {
      return '';
    }
  });
  const texto = normalizar(m.texto || '');
  return LOJAS_SEM_PROGRAMA.find(([, re]) => hosts.some((h) => re.test(h)) || re.test(texto))?.[0] || null;
}

/**
 * Cupons do texto de um canal só de cupons do ML (@cupombr): cada linha "condição: CÓDIGO" ou "condição - CÓDIGO",
 * com a condição falando de desconto (OFF, %, R$). Ex.: "15% OFF, acima de R$89, Limite de R$20 OFF: SITE031115".
 */
export function cuponsDoTexto(texto) {
  const vistos = new Set();
  const out = [];
  for (const linha of String(texto || '').split('\n')) {
    if (/https?:|www\./i.test(linha)) continue;
    const m = linha.trim().match(/^[-–•\s]*(.+?)\s*(?::|\s-|\s–)\s*([A-Z0-9]{5,20})\s*$/);
    if (!m || !/[A-Z]/.test(m[2]) || !/off|%|r\$/i.test(m[1]) || vistos.has(m[2])) continue;
    vistos.add(m[2]);
    out.push({ condicao: m[1].replace(/\s+/g, ' ').replace(/[,;]\s*$/, ''), codigo: m[2] });
  }
  return out;
}

export class Espelho {
  constructor({ sender, store, affiliate, fontes, grupos, cfg = {}, resolver = resolverOferta, agora = () => Date.now(), esperar = sleep, avisos = null, amazonTag = process.env.AMAZON_PARTNER_TAG?.trim() || '', resolverAmazon = resolverLinkAmazon, awin = null, resolverLoja = resolverLinkLoja, carregarGrupos = null, shopee = null, mlApi = null, comandos = {} }) {
    this.comandos = comandos; // { '/atualizar': async (m) => ... } — só na caixa de entrada do dono
    this.mlApi = mlApi?.configurada ? mlApi : null; // API oficial do ML (src/ml/api.js): acha a oferta do ML dos canais pelo nome
    this.cacheML = new Map();
    this.buscasML = [];
    this.mlPausadoAte = 0;
    this.shopee = shopee?.ligada() ? shopee : null; // Shopee de afiliados (src/shopee.js); sem ela, link da Shopee sai do post
    this.avisos = avisos;
    this.awin = awin; // lojas parceiras da Awin (src/awin.js); sem ela, link de loja é ignorado
    this.resolverLoja = resolverLoja;
    this.carregarGrupos = carregarGrupos; // relê os grupos a cada rodada (um canal pode ter sido ligado com o bot rodando)
    this.amazonTag = amazonTag;
    this.resolverAmazon = resolverAmazon;
    this.sender = sender;
    this.store = store;
    this.affiliate = affiliate;
    this.fontes = new Map(fontes.map((f) => [f.jid, f]));
    this.grupos = new Map(grupos.map((g) => [g.nome, g]));
    this.cfg = { janelaMinutos: 20, maxPorHora: 15, pausaEntreConsultasSeg: 8, pausaVerificacaoMin: 60, destinoPadrao: 'Geral', ...cfg };
    this.resolver = resolver;
    this.agora = agora;
    this.esperar = esperar;
    this.aceitasPorGrupo = new Map();
    this.pausadoAte = 0;
    this.ultimoRefresh = 0;
    this.rodando = false;
  }

  /** Uma rodada: lê os grupos-fonte e processa o que for novo. Devolve um resumo. */
  async tick() {
    const resumo = { lidas: 0, novas: 0, enfileiradas: 0, ignoradas: {} };
    if (this.rodando || !this.fontes.size) return resumo;
    if (this.agora() < this.pausadoAte) return resumo;
    this.rodando = true;
    try {
      if (this.carregarGrupos) this.grupos = new Map(this.carregarGrupos().map((g) => [g.nome, g]));
      const msgs = await this.sender.lerMensagens([...this.fontes.keys()]);
      resumo.lidas = msgs.length;
      const limiteT = (this.agora() - this.cfg.janelaMinutos * MIN) / 1000;
      for (const m of msgs.sort((a, b) => a.t - b.t)) {
        if (!m.id || this.store.jaViu(m.id)) continue;
        this.store.marcarVisto(m.id);
        if (m.t < limiteT) continue; // antiga: só marca como vista
        // Comando do dono na caixa de entrada (ex.: /atualizar). Grava o "visto" antes: um reinício não repete o comando.
        const comando = this.fontes.get(m.jid)?.manual && this.comandos[String(m.texto || '').trim().split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '')];
        if (comando) {
          this.store.save();
          await comando(m).catch((e) => log(`  ⚠️  comando "${m.texto}": ${String(e.message).split('\n')[0]}`));
          continue;
        }
        resumo.novas++;
        const r = await this.processar(m);
        this.store.contarFunil?.(this.fontes.get(m.jid)?.nome || m.jid, r);
        if (this.fontes.get(m.jid)?.manual) await this.responder(m, r);
        if (r === 'ok') resumo.enfileiradas++;
        else resumo.ignoradas[r] = (resumo.ignoradas[r] || 0) + 1;
        if (this.agora() < this.pausadoAte) break;
      }
      this.store.save();
      if (resumo.novas) log(`🪞 Espelho: ${resumo.novas} mensagem(ns) nova(s) → ${resumo.enfileiradas} na fila. Ignoradas: ${JSON.stringify(resumo.ignoradas)}`);
    } finally {
      this.rodando = false;
    }
    return resumo;
  }

  /**
   * Oferta escolhida a dedo pelo dono (caixa de entrada) só passa pelo "não repetir". Post copiado de canal
   * ("copiarTexto") passa pelo nicho, pelas palavras bloqueadas e pelo "não repetir": desconto, preço e nota são
   * escolha do canal (o dono pediu para copiar tudo).
   */
  filtros(fonte, destino) {
    const f = destino.filtros || {};
    if (fonte.manual) return { diasSemRepetir: f.diasSemRepetir };
    if (fonte.copiarTexto) return { palavrasObrigatorias: f.palavrasObrigatorias, palavrasBloqueadas: f.palavrasBloqueadas, diasSemRepetir: f.diasSemRepetir, soMarcas: f.soMarcas, semMasculino: f.semMasculino };
    if (fonte.semDescontoMinimo) return { ...f, descontoMinimo: 0 }; // achado de outra loja já mais barato no ML
    return f;
  }

  /** Caixa de entrada: conta ao dono o que aconteceu com a mensagem que ele mandou. */
  async responder(m, r) {
    // 09/11/2026, o dono: "ele não entendeu que isso era pra ir no grupo de beleza" — a resposta diz o grupo entendido.
    const grupo = this.grupoDoPedido ? `👍 Grupo: ${this.grupoDoPedido}.\n` : '';
    const texto =
      r === 'ok'
        ? `✅ Entrou na fila${this.ultimoAceito.grupo ? ` do ${this.ultimoAceito.grupo}` : ''}: ${this.ultimoAceito.nome.slice(0, 60)}\n${this.ultimoAceito.link}\nSai no próximo envio.`
        : r === 'sem link do ML/Amazon' || r === 'ML sem nome ou preço no post'
          ? `${grupo}Me mande (ou encaminhe) a oferta com o link da loja (Amazon, Mercado Livre, Shopee ou loja parceira da Awin): eu troco pelo seu link e posto no canal.\nSem link, escreva o nome do produto e o preço (ex.: "de R$ 72 por R$ 30") que eu procuro no Mercado Livre.`
          : r === 'ML: produto do post não achado'
            ? `${grupo}⚠️ Não entrou na fila: não achei esse produto no Mercado Livre pelo mesmo preço (até 10% a mais).\nMande o link da loja onde está a oferta (Amazon, Mercado Livre ou Shopee) que eu troco pelo seu e posto.`
            : r === 'ML: limite de buscas por hora'
              ? `${grupo}⚠️ Não entrou na fila: já procurei muitos produtos no Mercado Livre nesta hora. Mande de novo daqui a pouco, ou mande com o link da loja.`
              : /^fora do nicho/.test(r)
                ? `⚠️ Não entrou na fila: não reconheci de qual grupo é (o nome não tem palavra de nenhum nicho).\nMande de novo com o nome do grupo numa linha (${[...this.grupos.values()].filter((g) => g.ativo !== false).map((g) => g.nome.toLowerCase()).join(', ')}) que ele vai direto para lá.`
                : `${grupo}⚠️ Não entrou na fila: ${r}.`;
    try {
      await this.sender.sendText(m.jid, texto);
    } catch (e) {
      log(`  🪞 não consegui responder na caixa de entrada (${String(e.message).split('\n')[0]})`);
    }
  }

  /** O grupo já recebeu o máximo de ofertas do espelho nesta hora? Um canal pode ter o próprio "maxPorHora". */
  noLimite(grupo, fonte = null, fator = 1) {
    const recentes = (this.aceitasPorGrupo.get(grupo) || []).filter((t) => this.agora() - t < 60 * MIN);
    this.aceitasPorGrupo.set(grupo, recentes);
    return recentes.length >= (fonte?.maxPorHora ?? this.cfg.maxPorHora) * fator;
  }

  contar(grupo) {
    this.aceitasPorGrupo.set(grupo, [...(this.aceitasPorGrupo.get(grupo) || []), this.agora()]);
  }

  /** Para onde vai uma oferta lida do texto: o destino da fonte ou, se ela tiver "destinos", cada grupo ligado cujas palavras casam com o produto. */
  alvosDe(nome, fonte, destino) {
    const motivos = [];
    const alvos = [];
    const fator = marcaDoProduto({ nome }) ? 2 : 1; // marca da lista (config/marcas.json): o dobro do limite por hora
    for (const a of fonte.destinos?.length ? fonte.destinos : [{ grupo: destino.nome }]) {
      const g = this.grupos.get(a.grupo);
      if (!g || g.ativo === false) continue;
      if (a.palavras?.length && !a.palavras.some((t) => casaTermo(normalizar(nome), t))) motivos.push('fora do nicho');
      else if (this.noLimite(g.nome, fonte, fator)) motivos.push('limite por hora');
      else alvos.push(g);
    }
    return { alvos, motivos };
  }

  /**
   * Põe na fila de cada grupo-alvo a oferta montada com o que a mensagem diz (nome, preço, cupom).
   * `base` = o que identifica o produto (id, loja, url...); `link` só é chamado se algum grupo aceitar.
   */
  async enfileirarDoTexto(m, fonte, { alvos, motivos }, d, base, link, ehDaOferta = () => false) {
    let linkAfiliado = null;
    let textoPronto = null;
    let aceitos = 0;
    for (const g of alvos) {
      const produto = {
        ...base,
        origem: 'espelho',
        manual: !!fonte.manual, // caixa de entrada: a regra de vendas não vale (nem na hora de postar)
        grupo: g.nome,
        categoria: `Espelho: ${fonte.nomeWhats || fonte.nome}`,
        imagem: fotoDaMensagem(m, fonte) || base.imagem || null, // sem foto (ou foto com a marca do canal): a da loja ou a prévia de link
        precoAtual: d.precoAtual,
        precoOriginal: d.precoOriginal,
        precoObs: d.precoObs,
        descontoPct: d.descontoPct,
        cupom: d.cupom,
        nota: null,
        precoConsultadoEm: new Date((m.t || this.agora() / 1000) * 1000).toISOString(),
      };
      const motivo = this.store.conhecido(produto.id, g.nome)
        ? 'já está na fila'
        : motivoRecusa(produto, this.filtros(fonte, g), this.store, { descontoDesconhecidoPassa: true, exigirVendas: !fonte.manual && !base.semRegraVendas });
      if (motivo) {
        motivos.push(motivo);
        evento('recusado', produto, motivo);
        continue;
      }
      linkAfiliado ??= await link();
      // Post copiado: o texto do canal com o link da oferta trocado pelo do dono (os outros links saem).
      if (fonte.copiarTexto && !textoPronto) {
        // ehDaOferta(u): true = o link desta oferta; um texto = o link do dono para outro produto do mesmo post.
        textoPronto = textoCopiado(m, (u) => {
          const r = ehDaOferta(u);
          return r === true ? linkAfiliado : typeof r === 'string' ? r : null;
        });
        if (!textoPronto) return 'sem link para trocar';
      }
      this.store.upsert({ ...produto, url: base.url || linkAfiliado, linkAfiliado, ...(textoPronto && { textoPronto, semRegraVendas: true }) });
      evento('na_fila', produto);
      this.contar(g.nome);
      aceitos++;
      this.ultimoAceito = { nome: base.nome, link: linkAfiliado, grupo: g.nome };
      log(`🪞 [${g.nome}] ${nomeLoja(base)} de "${fonte.nomeWhats || fonte.nome}": ${base.nome.slice(0, 55)} — ${linkAfiliado}`);
    }
    return aceitos ? 'ok' : motivos[0];
  }

  /**
   * Oferta do Mercado Livre de canal com "mlPeloNome" (29/10/2026, o dono: "vamos pegar mais posts do ml e amazon de
   * grupos que dão certo"). O link do canal (meli.la) só abre pela página do ML, que barra o bot desde 21/10: o produto
   * é achado na API oficial pelo nome e pelo preço do post (acharPeloNome em src/ml/api.js) e sai no formato do bot,
   * com nome, foto e preço do catálogo, o link do dono e as regras do grupo. Sem a regra de vendas se o canal tiver
   * "exigirVendas": false (o dono liberou o ML dos canais em 27/10/2026).
   */
  async processarMLPeloNome(m, fonte, destino, { outraLoja = null } = {}) {
    if (!this.mlApi) return 'ML sem a API oficial';
    if (this.agora() < this.mlPausadoAte) return 'ML pausado';
    const d = dadosDoTexto(m.texto);
    if (!d.nome || !d.precoAtual) return 'ML sem nome ou preço no post';
    const destinos = this.alvosDe(d.nome, fonte, destino);
    // O nome do post já passa pelo nicho, pelas bloqueadas e pelo "só marcas" antes de gastar a API (a escolha do dono,
    // na caixa de entrada, só pelo "não repetir": um "Refil" que ele mandou não é barrado).
    destinos.alvos = destinos.alvos.filter((g) => {
      const r = motivoPeloNome({ nome: d.nome }, this.filtros(fonte, g));
      if (r) destinos.motivos.push(r);
      return !r;
    });
    if (!destinos.alvos.length) return destinos.motivos[0] || 'sem destino';
    let produto;
    try {
      produto = await this.acharML(d.nome, d.precoAtual, { outraLoja: !!outraLoja });
    } catch (e) {
      this.mlPausadoAte = this.agora() + 15 * MIN; // ex.: HTTP 429 (muitas buscas): não insiste
      log(`  🪞 API do ML: ${String(e.message).split('\n')[0]} — ML dos canais pausado por 15 min`);
      return 'API do ML indisponível';
    }
    if (produto === undefined) return 'ML: limite de buscas por hora';
    if (!produto) return 'ML: produto do post não achado';
    const dados ={ ...d, precoAtual: produto.precoAtual, precoOriginal: produto.precoOriginal ?? d.precoOriginal, descontoPct: produto.descontoPct ?? d.descontoPct, precoObs: null };
    const link = async () => {
      if (this.agora() - this.ultimoRefresh > 30 * MIN) {
        await this.affiliate.refresh();
        this.ultimoRefresh = this.agora();
      }
      const mapa = await this.affiliate.createLinks([produto.url]);
      const meu = mapa.get(produto.url) || [...mapa.values()][0];
      if (!meu) throw new Error('o ML não devolveu link de afiliado');
      return meu;
    };
    // A foto do canal pode ter o preço dele escrito: só vale se o anúncio tiver o mesmo preço do post.
    let comFoto = precoBate(d.precoAtual, produto.precoAtual) && !outraLoja ? fonte : { ...fonte, fotoDoCanal: false };
    // Achado de outra loja (Sephora...) que no ML sai pelo mesmo preço da promoção de lá ou menos: já é oferta, mesmo
    // que o anúncio do ML não mostre desconto. Mais caro que lá, vale o desconto mínimo do grupo de sempre.
    if (outraLoja && produto.precoAtual <= d.precoAtual * 1.01) comFoto = { ...comFoto, semDescontoMinimo: true };
    if (outraLoja) log(`  🪞 ${outraLoja} → ML: "${d.nome.slice(0, 50)}" lá R$ ${d.precoAtual}, no ML R$ ${produto.precoAtual}`);
    try {
      return await this.enfileirarDoTexto(m, comFoto, destinos, dados, { ...produto, semRegraVendas: fonte.exigirVendas === false }, link);
    } catch (e) {
      this.mlPausadoAte = this.agora() + 60 * MIN;
      log(`  🪞 ML: link de afiliado não saiu (${String(e.message).split('\n')[0]}) — ML dos canais pausado por 1 h`);
      return 'ML não devolveu link de afiliado';
    }
  }

  /**
   * acharPeloNome com memória de 6 h (o mesmo produto aparece em vários canais, e repetido no mesmo canal) e no máximo
   * BUSCAS_ML_POR_HORA buscas novas: a API recusa quem pergunta demais (HTTP 429, visto em 29/10/2026) e é a mesma que
   * traz os mais vendidos nas coletas. Undefined = limite da hora.
   */
  async acharML(nome, preco, { outraLoja = false } = {}) {
    const chave = `${normalizar(nome)}|${preco}|${outraLoja ? 'outra' : ''}`;
    const guardado = this.cacheML.get(chave);
    if (guardado && this.agora() - guardado.em < 6 * 60 * MIN) return guardado.produto;
    this.buscasML = this.buscasML.filter((t) => this.agora() - t < 60 * MIN);
    if (this.buscasML.length >= BUSCAS_ML_POR_HORA) return undefined;
    this.buscasML.push(this.agora());
    const produto = await acharPeloNome(this.mlApi, nome, preco, { outraLoja });
    if (this.cacheML.size > 2000) this.cacheML.clear();
    this.cacheML.set(chave, { produto, em: this.agora() });
    return produto;
  }

  /**
   * Cupons do Mercado Livre de um canal só de cupons ("cuponsML", @cupombr; pedido do dono, 04/11/2026). Do post saem só
   * os códigos e as condições, num post do bot com o link de afiliado do dono para a página de cupons do ML (o resto
   * do post — convites, tutoriais, #anúncio — fica de fora). Vai para todos os "destinos", no máximo
   * "cuponsPorDia" por grupo (padrão 3), sem repetir o mesmo conjunto de códigos em 2 dias.
   */
  async processarCuponsML(m, fonte) {
    const texto = m.textoVisivel || m.texto || '';
    const cupons = cuponsDoTexto(texto);
    if (!cupons.length) return 'sem código de cupom';
    const id = `CUPML-${cupons.map((c) => c.codigo).sort().join('-')}`.slice(0, 80);
    const extras = [
      /s[oó] (pra|para) quem resgatou/i.test(texto) && '⚠️ Só para quem resgatou o cupom no app antes',
      /cart[aã]o[^\n]*mercado pago/i.test(texto) && '💳 Com cartão de crédito Mercado Pago',
    ].filter(Boolean);
    const tipo = /full/i.test(texto.split('\n')[0]) ? ' (Entregas Full)' : /site todo/i.test(texto.split('\n')[0]) ? ' (site todo)' : '';
    const hoje = diaLocal(new Date(this.agora()), settings.tz);
    const motivos = [];
    let link = null;
    let aceitos = 0;
    for (const d of fonte.destinos || []) {
      const g = this.grupos.get(d.grupo);
      if (!g || g.ativo === false) continue;
      if (this.store.conhecido(id, g.nome) || this.store.enviadoRecentemente(id, g.nome, 2)) {
        motivos.push('cupom repetido');
        continue;
      }
      const doDia = this.store.list((p) => p.grupo === g.nome && String(p.id).startsWith('CUPML-') && p.coletadoEm && diaLocal(new Date(p.coletadoEm), settings.tz) === hoje).length;
      if (doDia >= (fonte.cuponsPorDia ?? 3)) {
        motivos.push('limite de cupons do ML no dia');
        continue;
      }
      link ??= await this.linkCuponsML();
      const produto = {
        id, tipo: 'cupom', loja: 'ml', lojaNome: 'Mercado Livre', origem: 'espelho', grupo: g.nome, categoria: `Espelho: ${fonte.nome}`,
        nome: `Cupom do Mercado Livre${tipo}`,
        descricao: [...cupons.map((c) => `🎟️ ${c.condicao}: \`${c.codigo}\``), ...extras, '⏳ Vale por pouco tempo — os cupons esgotam rápido'].join('\n'),
        cupom: null, temCodigo: true, imagem: null, semRegraVendas: true, url: link, linkAfiliado: link,
      };
      this.store.upsert(produto);
      evento('na_fila', produto);
      aceitos++;
      log(`🎟️ [${g.nome}] cupom do ML de ${fonte.nome}: ${cupons.map((c) => c.codigo).join(', ')} — ${link}`);
    }
    return aceitos ? 'ok' : motivos[0] || 'sem destino';
  }

  /** Link de afiliado do dono para a página de cupons do ML (guardado 6 h); sem o Link Builder, o link com a etiqueta. */
  async linkCuponsML() {
    if (this.linkCupons && this.agora() - this.linkCupons.em < 6 * 60 * MIN) return this.linkCupons.link;
    const pagina = 'https://www.mercadolivre.com.br/cupons';
    let link = null;
    try {
      if (this.agora() - this.ultimoRefresh > 30 * MIN) {
        await this.affiliate.refresh();
        this.ultimoRefresh = this.agora();
      }
      link = [...(await this.affiliate.createLinks([pagina])).values()][0] || null;
    } catch (e) {
      log(`  🎟️ link de afiliado da página de cupons não saiu (${String(e.message).split('\n')[0]}) — usando o link com a etiqueta`);
    }
    link ||= `${pagina}?matt_word=${encodeURIComponent(this.affiliate?.tag || settings.affiliateTag || 'pndaaaa')}`;
    this.linkCupons = { link, em: this.agora() };
    return link;
  }

  /** Oferta da Amazon: troca a etiqueta e usa o texto da mensagem (sem abrir a página da Amazon). */
  async processarAmazon(m, link, fonte, destino) {
    if (!this.amazonTag) return 'Amazon sem etiqueta (AMAZON_PARTNER_TAG)';
    const d = dadosDoTexto(m.texto);
    // Só o link, sem texto (05/11/2026: o dono mandou um link solto e recebeu "fora do nicho"): o bot não abre a página
    // da Amazon (proibido pelo Associados), então sem o nome não tem como saber o que é.
    const jaVisto = (a) => a && Object.keys(this.store.data.produtos || {}).some((k) => k.endsWith(`:AMZ-${a}`));
    if (!d.nome && fonte.manual && !jaVisto(asinDeUrl(link))) return 'só veio o link: a Amazon não deixa o bot abrir a página, mande junto o nome do produto e o preço (ou encaminhe o post inteiro)';
    const nome = d.nome || 'Oferta na Amazon';
    const destinos = this.alvosDe(nome, fonte, destino);
    if (!destinos.alvos.length) return destinos.motivos[0] || 'sem destino';

    let asin = asinDeUrl(link);
    if (!asin) {
      try {
        asin = await this.resolverAmazon(link);
      } catch (e) {
        log(`  🪞 link da Amazon não resolveu (${String(e.message).split('\n')[0]})`);
      }
    }
    if (!asin) return 'link da Amazon sem produto';
    const linkAfiliado = linkAfiliadoAmazon(asin, this.amazonTag);
    const ehDaOferta = (u) => u === link || asinDeUrl(u) === asin;
    return this.enfileirarDoTexto(m, fonte, destinos, d, { id: `AMZ-${asin}`, asin, loja: 'amazon', nome, url: linkAfiliado }, async () => linkAfiliado, ehDaOferta);
  }

  /** Entre os links da mensagem, o primeiro que leva a uma loja da Awin em que a conta foi aprovada. */
  async acharLoja(links, podeSeguir) {
    const lojas = await this.awin.anunciantes();
    if (!lojas.length) return null;
    for (const l of links) {
      const r = await this.resolverLoja(l, lojas, { maxSaltos: 0 }); // link direto da loja ou da Awin: não abre nada
      if (r?.url) return r;
    }
    if (!podeSeguir) return null;
    for (const l of links.slice(0, 2)) {
      try {
        const r = await this.resolverLoja(l, lojas); // encurtador: segue só os redirecionamentos
        if (r?.url) return r;
      } catch (e) {
        log(`  🪞 link de loja não resolveu (${String(e.message).split('\n')[0]})`);
      }
    }
    return null;
  }

  /** Oferta de loja parceira da Awin: troca pelo link de afiliado do dono e usa o texto da mensagem. */
  async processarLoja(m, links, fonte, destino) {
    const d = dadosDoTexto(m.texto);
    const destinos = this.alvosDe(d.nome || '', fonte, destino);
    let achado = null;
    try {
      achado = await this.acharLoja(links, destinos.alvos.length > 0);
    } catch (e) {
      log(`  🪞 Awin indisponível (${String(e.message).split('\n')[0]})`);
    }
    if (!achado) return 'sem link do ML/Amazon';
    if (!d.nome && !fonte.manual) return 'sem nome do produto';
    if (!destinos.alvos.length) return destinos.motivos[0] || 'sem destino';
    const { anunciante, url } = achado;
    const id = `AWN-${anunciante.id}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 10)}`;
    const base = { id, loja: 'awin', lojaNome: anunciante.nome, nome: d.nome || `Oferta na ${anunciante.nome}`, url };
    return this.enfileirarDoTexto(m, fonte, destinos, d, base, () => this.awin.gerarLink(anunciante, url), (u) => links.includes(u) || u === url);
  }

  /** Fonte com "destinos" (ex.: a caixa de entrada com o Geral pausado): o 1º grupo ligado cujo nicho casa com o nome. */
  grupoPeloNome(fonte, nome) {
    for (const d of fonte.destinos || []) {
      const g = this.grupos.get(d.grupo);
      if (g && g.ativo !== false && (!d.palavras?.length || d.palavras.some((t) => casaTermo(normalizar(nome), t)))) return g;
    }
    return null;
  }

  /**
   * Caixa de entrada: o dono pode dizer o grupo na mensagem ("fitness" numa linha, "#fit", "pro grupo beleza").
   * 06/11/2026, o dono mandou um Pepsi Black Zero "pra ir pro topo da fila do fitness" e recebeu "fora do nicho":
   * escolha dele vale mais que as palavras do nicho. Devolve o grupo e o texto sem a linha do grupo.
   */
  grupoPedido(texto) {
    const alias = (nome) => {
      const n = normalizar(nome);
      return [n, n.replace(/s$/, ''), ...(n.startsWith('fit') ? ['fit'] : [])];
    };
    const ativos = [...this.grupos.values()].filter((g) => g.ativo !== false);
    const qual = (palavra) => ativos.find((g) => alias(g.nome).includes(normalizar(palavra)));
    const linhas = String(texto || '').split('\n');
    for (let i = 0; i < linhas.length; i++) {
      const m = normalizar(linhas[i]).match(/^(?:(?:vai|manda|mandar|pro|pra|para|o|no|do|grupo)\s+)*#?([a-z]+)[\s!.]*$/);
      const g = m && qual(m[1]);
      if (g) return { grupo: g, texto: linhas.filter((_, j) => j !== i).join('\n') };
    }
    const tag = String(texto || '').match(/(?:^|\s)#([a-zà-ú]+)\b/i);
    const g = tag && qual(tag[1]);
    return g ? { grupo: g, texto: String(texto).replace(tag[0], ' ') } : null;
  }

  async processar(m) {
    let fonte = this.fontes.get(m.jid);
    if (fonte?.cuponsML) return this.processarCuponsML(m, fonte); // vai para os "destinos" dele
    const pedido = fonte?.manual ? this.grupoPedido(m.texto) : null;
    this.grupoDoPedido = pedido?.grupo.nome || null; // a resposta ao dono diz que grupo o bot entendeu
    if (pedido) {
      fonte = { ...fonte, destino: pedido.grupo.nome, destinos: [{ grupo: pedido.grupo.nome }] };
      m = { ...m, texto: pedido.texto };
    }
    let destino = this.grupos.get(fonte?.destino || this.cfg.destinoPadrao);
    if (!fonte || !destino) return 'sem destino';

    // Fonte "soAmazon"/"semML": os links do ML ficam de fora (o ML já tem a busca própria).
    const links = fonte.soAmazon || fonte.semML ? [] : extrairLinksML(m.texto).filter((l) => tipoLink(l) !== 'outro');
    const linksAmazon = links.length ? [] : extrairLinksAmazon(m.texto);
    if (fonte.mlPeloNome && !linksAmazon.length && extrairLinksML([m.texto, ...(m.links || [])].join('\n')).length) return this.processarMLPeloNome(m, fonte, destino);
    // Loja sem programa de afiliado (Sephora...): procura o mesmo produto no ML e posta com o link do dono.
    const outraLoja = fonte.mlPeloNome && fonte.outrasLojasNoML !== false && !linksAmazon.length ? lojaSemPrograma(m) : null;
    if (outraLoja) return this.processarMLPeloNome(m, fonte, destino, { outraLoja });
    if (fonte.apenasAmazon && !linksAmazon.length) return 'sem link da Amazon'; // canal só para Amazon: ML/Shopee/Awin ficam de fora
    if (!links.length && !linksAmazon.length) {
      const linksShopee = this.shopee ? extrairLinksShopee(m.links || [], m.texto) : [];
      if (linksShopee.length) return this.processarShopee(m, linksShopee, fonte, destino);
      const linksLoja = this.awin?.ligada() && fonte.lojasParceiras !== false ? extrairLinksLoja(m.texto) : [];
      if (linksLoja.length) return this.processarLoja(m, linksLoja, fonte, destino);
      // Caixa de entrada sem link de loja (09/11/2026, o dono mandou "Hidratante Facial Neutrogena Hydro Boost... De R$ 72
      // por R$ 30... beleza", sem link): com nome e preço, procura o mesmo produto no ML (até 10% mais caro, como as
      // ofertas de loja sem programa) e posta com o link do dono.
      if (fonte.manual && this.mlApi) return this.processarMLPeloNome(m, fonte, destino, { outraLoja: lojaSemPrograma(m) || 'mensagem sem link' });
      return 'sem link do ML/Amazon';
    }

    if (linksAmazon.length) return this.processarAmazon(m, linksAmazon[0], fonte, destino);
    if (fonte.copiarTexto) return this.processarMLCopia(m, links, fonte, destino);
    if (this.noLimite(destino.nome, fonte)) return 'limite por hora';

    try {
      await this.esperar(this.cfg.pausaEntreConsultasSeg * 1000);
      // semRegraVendas: canal que o dono liberou da regra de vendas (fontes.json, "exigirVendas": false) — vale também
      // na conferência final antes de postar (pipeline.js).
      const semRegraVendas = fonte.exigirVendas === false;
      const lido = await this.resolver(links[0]);
      if (fonte.manual && fonte.destinos?.length) {
        destino = this.grupoPeloNome(fonte, lido.nome);
        if (!destino) return 'fora do nicho dos grupos';
      }
      const produto = { ...lido, grupo: destino.nome, categoria: `Espelho: ${fonte.nomeWhats || fonte.nome}`, origem: 'espelho', manual: !!fonte.manual, semRegraVendas };
      // "fotoDoCanal": usa a foto da mensagem (ex.: perfume num ambiente) no lugar da foto de fundo branco do ML —
      // só quando o preço da mensagem bate com o do anúncio, porque a arte do canal pode ter o preço escrito nela.
      // A URL é do cdn do t.me e pode expirar; se o Telegram não conseguir baixar, o envio cai para texto com prévia.
      if (fonte.fotoDoCanal && m.foto && precoBate(dadosDoTexto(m.texto).precoAtual, produto.precoAtual)) produto.imagem = m.foto;

      if (this.store.conhecido(produto.id, destino.nome)) return 'já está na fila';
      const motivo = motivoRecusa(produto, this.filtros(fonte, destino), this.store, { descontoDesconhecidoPassa: true, exigirVendas: !fonte.manual && !semRegraVendas });
      // A página do link (perfil social do outro afiliado) não mostra as vendas: oferta do ML vinda do espelho
      // automático é recusada de propósito (regra de >50 vendas), salvo canal liberado pelo dono. Ver README, seção 3.7.
      if (motivo) {
        const explicado = motivo === 'sem dado de vendas' ? 'ML sem dado de vendas (o espelho não lê as vendas)' : motivo;
        evento('recusado', produto, explicado);
        return explicado;
      }

      if (this.agora() - this.ultimoRefresh > 30 * MIN) {
        await this.affiliate.refresh();
        this.ultimoRefresh = this.agora();
      }
      const mapa = await this.affiliate.createLinks([produto.url]);
      const link = mapa.get(produto.url) || [...mapa.values()][0];
      if (!link) {
        evento('sem_link', produto, 'o ML não devolveu link de afiliado');
        return 'ML não devolveu link de afiliado';
      }

      this.store.upsert(produto);
      this.store.setLink(produto.url, link);
      evento('na_fila', produto);
      this.contar(destino.nome);
      this.ultimoAceito = { nome: produto.nome, link, grupo: destino.nome };
      log(`🪞 [${destino.nome}] de "${fonte.nomeWhats || fonte.nome}": ${produto.nome.slice(0, 55)} — ${link}`);
      return 'ok';
    } catch (e) {
      return this.erroDoML(e);
    }
  }

  /**
   * Link do dono para cada link da Shopee do post (até 3 produtos): Map(link do post -> link curto do dono).
   * Link que não leva a um produto, ou que a Shopee recusar, fica de fora (sai do post).
   */
  async linksShopeeDoDono(m, grupo) {
    const mapa = new Map();
    if (!this.shopee) return mapa;
    for (const l of extrairLinksShopee(m.links || [], m.texto).slice(0, 3)) {
      try {
        const ids = await this.shopee.resolver(l);
        if (ids) mapa.set(l, await this.shopee.gerarLink(urlDoProdutoShopee(ids), ['telegram', grupo]));
      } catch (e) {
        log(`  🪞 link da Shopee não trocou (${String(e.message).split('\n')[0]})`);
      }
    }
    return mapa;
  }

  /**
   * Oferta da Shopee (pedido do dono, 15/10/2026): o post do canal com o link da Shopee trocado pelo do dono. Nome,
   * preço e foto vêm da API da Shopee (o texto do post completa o que faltar). Sem regra de vendas (como o ML copiado).
   */
  async processarShopee(m, links, fonte, destino) {
    let ids = null;
    let principal = null;
    try {
      for (const l of links.slice(0, 3)) {
        ids = await this.shopee.resolver(l);
        if (ids) {
          principal = l;
          break;
        }
      }
    } catch (e) {
      log(`  🪞 link da Shopee não resolveu (${String(e.message).split('\n')[0]})`);
    }
    if (!ids) return 'link da Shopee sem produto';
    const info = await this.shopee.produto(ids).catch((e) => {
      log(`  🪞 Shopee não mostrou o produto (${String(e.message).split('\n')[0]})`);
      return null;
    });
    const d = dadosDoTexto(m.texto);
    const nome = info?.nome || d.nome;
    if (!nome && !fonte.manual) return 'sem nome do produto';
    const destinos = this.alvosDe(fonte.copiarTexto ? `${nome || ''} ${m.textoVisivel ?? m.texto}` : nome || '', fonte, destino);
    if (!destinos.alvos.length) return destinos.motivos[0] || 'sem destino';
    const dados = { ...d, precoAtual: d.precoAtual ?? info?.precoAtual, precoOriginal: d.precoOriginal ?? info?.precoOriginal, descontoPct: d.descontoPct ?? info?.descontoPct };
    const url = urlDoProdutoShopee(ids);
    const base = { id: `SHP-${ids.itemId}`, loja: 'shopee', nome: nome || 'Oferta na Shopee', url, imagem: info?.imagem || null, vendidos: info?.vendidos ?? null, semRegraVendas: true };
    let doDono = new Map();
    const link = async () => {
      doDono = await this.linksShopeeDoDono(m, destinos.alvos[0].nome);
      const meu = doDono.get(principal);
      if (!meu) throw new Error('Shopee não devolveu o link de afiliado');
      return meu;
    };
    try {
      return await this.enfileirarDoTexto(m, fonte, destinos, dados, base, link, (u) => (u === principal ? true : doDono.get(u) || false));
    } catch (e) {
      log(`  🪞 Shopee: ${String(e.message).split('\n')[0]}`);
      return 'Shopee não devolveu link';
    }
  }

  /** Captcha/sessão/limite do ML pausa o espelho (em vez de insistir); outro erro só pula a mensagem. */
  async erroDoML(e) {
    const msg = String(e.message || e).split('\n')[0];
    if (e instanceof ErroVerificacao || /Sessão do Mercado Livre expirada|HTTP 40[13]|HTTP 429/.test(msg)) {
      this.pausadoAte = this.agora() + this.cfg.pausaVerificacaoMin * MIN;
      log(`⏸️  Espelho pausado por ${this.cfg.pausaVerificacaoMin} min: ${msg}`);
      await this.avisos?.espelhoPausado(msg, this.cfg.pausaVerificacaoMin).catch(() => {});
      return 'ML bloqueou';
    }
    log(`  🪞 ignorada (${msg.slice(0, 140)})`);
    return 'erro ao ler o produto';
  }

  /**
   * Post do ML copiado de um canal ("copiarTexto"): vai para cada grupo de destino cujo nicho casa com o texto,
   * IGUAL ao post do canal (texto e foto), com os links do ML trocados pelos do dono (até 3 produtos por post).
   * A regra de vendas não vale (o dono pediu para copiar tudo; a página do link não mostra vendas).
   */
  async processarMLCopia(m, links, fonte, destino) {
    const destinos = this.alvosDe(m.textoVisivel ?? m.texto, fonte, destino);
    if (!destinos.alvos.length) return destinos.motivos[0] || 'sem destino';
    const motivos = [...destinos.motivos];
    try {
      const produtoDo = new Map(); // link do post -> url do produto
      let base = null;
      for (const l of links.slice(0, 3)) {
        await this.esperar(this.cfg.pausaEntreConsultasSeg * 1000);
        const p = await this.resolver(l);
        base ??= p;
        produtoDo.set(l, p.url);
      }
      const categoria = `Espelho: ${fonte.nomeWhats || fonte.nome}`;
      const aceitos = [];
      for (const g of destinos.alvos) {
        const produto = { ...base, grupo: g.nome, categoria, origem: 'espelho', semRegraVendas: true, imagem: fotoDaMensagem(m, fonte) || base.imagem };
        if (this.store.conhecido(produto.id, g.nome)) {
          motivos.push('já está na fila');
          continue;
        }
        const motivo = motivoRecusa(produto, this.filtros(fonte, g), this.store, { descontoDesconhecidoPassa: true, exigirVendas: false });
        if (motivo) {
          motivos.push(motivo);
          evento('recusado', produto, motivo);
          continue;
        }
        aceitos.push(produto);
      }
      if (!aceitos.length) return motivos[0] || 'sem destino';

      if (this.agora() - this.ultimoRefresh > 30 * MIN) {
        await this.affiliate.refresh();
        this.ultimoRefresh = this.agora();
      }
      const mapa = await this.affiliate.createLinks([...new Set(produtoDo.values())]);
      const doDono = new Map([...produtoDo].map(([l, url]) => [l, mapa.get(url)]).filter(([, v]) => v));
      for (const [l, v] of await this.linksShopeeDoDono(m, aceitos[0].grupo)) doDono.set(l, v); // link da Shopee no mesmo post
      const link = doDono.get(links[0]);
      if (!link) {
        evento('sem_link', aceitos[0], 'o ML não devolveu link de afiliado');
        return 'ML não devolveu link de afiliado';
      }
      const textoPronto = textoCopiado(m, (u) => doDono.get(u) || null);
      if (!textoPronto) return 'sem link para trocar';
      for (const produto of aceitos) {
        this.store.upsert({ ...produto, textoPronto });
        this.store.setLink(produto.url, link);
        evento('na_fila', produto);
        this.contar(produto.grupo);
        log(`🪞 [${produto.grupo}] copiado de "${fonte.nomeWhats || fonte.nome}": ${produto.nome.slice(0, 55)} — ${link}`);
      }
      this.ultimoAceito = { nome: base.nome, link, grupo: aceitos.map((p) => p.grupo).join(", ") };
      return 'ok';
    } catch (e) {
      return this.erroDoML(e);
    }
  }
}
