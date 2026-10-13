/**
 * Espelho de grupos: lê as ofertas postadas em OUTROS grupos de WhatsApp (os "grupos-fonte",
 * config/fontes.json), descobre o produto do Mercado Livre, gera o link de afiliado do dono do bot
 * e coloca na fila — a mensagem é montada no nosso formato, não copiada.
 *
 * Cuidados embutidos:
 *  - só mensagens novas (últimos N minutos) e nunca a mesma mensagem duas vezes;
 *  - limite de ofertas por hora e pausa entre consultas ao Mercado Livre;
 *  - se o ML pedir verificação (captcha) ou recusar o login, o espelho PARA por um tempo em vez de insistir.
 */
import { extrairLinksML, resolverOferta, tipoLink, ErroVerificacao } from './ml/resolver.js';
import { asinDeUrl, dadosDoTexto, extrairLinksAmazon, linkAfiliadoAmazon, resolverLinkAmazon } from './amazon-espelho.js';
import { motivoRecusa } from './pipeline.js';
import { encontrarGrupo } from './configfile.js';
import { casaTermo, log, normalizar, sleep } from './util.js';

const MIN = 60_000;

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

export class Espelho {
  constructor({ sender, store, affiliate, fontes, grupos, cfg = {}, resolver = resolverOferta, agora = () => Date.now(), esperar = sleep, avisos = null, amazonTag = process.env.AMAZON_PARTNER_TAG?.trim() || '', resolverAmazon = resolverLinkAmazon }) {
    this.avisos = avisos;
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
      const msgs = await this.sender.lerMensagens([...this.fontes.keys()]);
      resumo.lidas = msgs.length;
      const limiteT = (this.agora() - this.cfg.janelaMinutos * MIN) / 1000;
      for (const m of msgs.sort((a, b) => a.t - b.t)) {
        if (!m.id || this.store.jaViu(m.id)) continue;
        this.store.marcarVisto(m.id);
        if (m.t < limiteT) continue; // antiga: só marca como vista
        resumo.novas++;
        const r = await this.processar(m);
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

  /** Oferta escolhida a dedo pelo dono (caixa de entrada) só passa pelo "não repetir". */
  filtros(fonte, destino) {
    const f = destino.filtros || {};
    return fonte.manual ? { diasSemRepetir: f.diasSemRepetir } : f;
  }

  /** Caixa de entrada: conta ao dono o que aconteceu com a mensagem que ele mandou. */
  async responder(m, r) {
    const texto =
      r === 'ok'
        ? `✅ Entrou na fila: ${this.ultimoAceito.nome.slice(0, 60)}\n${this.ultimoAceito.link}\nSai no próximo envio.`
        : r === 'sem link do ML/Amazon'
          ? 'Me mande (ou encaminhe) uma oferta com link da Amazon ou do Mercado Livre: eu troco pelo seu link e posto no canal.\nEscreva o nome do produto e o preço na mensagem (ex.: "de R$ 499 por R$ 299") para sair completo.'
          : `⚠️ Não entrou na fila: ${r}.`;
    try {
      await this.sender.sendText(m.jid, texto);
    } catch (e) {
      log(`  🪞 não consegui responder na caixa de entrada (${String(e.message).split('\n')[0]})`);
    }
  }

  /** O grupo já recebeu o máximo de ofertas do espelho nesta hora? */
  noLimite(grupo) {
    const recentes = (this.aceitasPorGrupo.get(grupo) || []).filter((t) => this.agora() - t < 60 * MIN);
    this.aceitasPorGrupo.set(grupo, recentes);
    return recentes.length >= this.cfg.maxPorHora;
  }

  contar(grupo) {
    this.aceitasPorGrupo.set(grupo, [...(this.aceitasPorGrupo.get(grupo) || []), this.agora()]);
  }

  /** Oferta da Amazon: troca a etiqueta e usa o texto da mensagem (sem abrir a página da Amazon). */
  async processarAmazon(m, link, fonte, destino) {
    if (!this.amazonTag) return 'Amazon sem etiqueta (AMAZON_PARTNER_TAG)';
    const d = dadosDoTexto(m.texto);
    const nome = d.nome || 'Oferta na Amazon';

    // Para onde vai: o destino da fonte ou, se ela tiver "destinos", cada grupo ligado cujas palavras casam com o produto.
    const motivos = [];
    const alvos = [];
    for (const a of fonte.destinos?.length ? fonte.destinos : [{ grupo: destino.nome }]) {
      const g = this.grupos.get(a.grupo);
      if (!g || g.ativo === false) continue;
      if (a.palavras?.length && !a.palavras.some((t) => casaTermo(normalizar(nome), t))) motivos.push('fora do nicho');
      else if (this.noLimite(g.nome)) motivos.push('limite por hora');
      else alvos.push(g);
    }
    if (!alvos.length) return motivos[0] || 'sem destino';

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
    let aceitos = 0;
    for (const g of alvos) {
      const produto = {
        id: `AMZ-${asin}`,
        asin,
        loja: 'amazon',
        origem: 'espelho',
        grupo: g.nome,
        categoria: `Espelho: ${fonte.nomeWhats || fonte.nome}`,
        nome,
        url: linkAfiliado,
        linkAfiliado,
        imagem: m.foto || null, // sem foto na mensagem, ela vem da prévia de link
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
        : motivoRecusa(produto, this.filtros(fonte, g), this.store, { descontoDesconhecidoPassa: true });
      if (motivo) {
        motivos.push(motivo);
        continue;
      }
      this.store.upsert(produto);
      this.contar(g.nome);
      aceitos++;
      this.ultimoAceito = { nome, link: linkAfiliado };
      log(`🪞 [${g.nome}] Amazon de "${fonte.nomeWhats || fonte.nome}": ${nome.slice(0, 55)} — ${linkAfiliado}`);
    }
    return aceitos ? 'ok' : motivos[0];
  }

  async processar(m) {
    const fonte = this.fontes.get(m.jid);
    const destino = this.grupos.get(fonte?.destino || this.cfg.destinoPadrao);
    if (!fonte || !destino) return 'sem destino';

    // Fonte "soAmazon": dali só interessam as ofertas da Amazon (o ML já tem a busca própria).
    const links = fonte.soAmazon ? [] : extrairLinksML(m.texto).filter((l) => tipoLink(l) !== 'outro');
    const linksAmazon = links.length ? [] : extrairLinksAmazon(m.texto);
    if (!links.length && !linksAmazon.length) return 'sem link do ML/Amazon';

    if (linksAmazon.length) return this.processarAmazon(m, linksAmazon[0], fonte, destino);
    if (this.noLimite(destino.nome)) return 'limite por hora';

    try {
      await this.esperar(this.cfg.pausaEntreConsultasSeg * 1000);
      const produto = { ...(await this.resolver(links[0])), grupo: destino.nome, categoria: `Espelho: ${fonte.nomeWhats || fonte.nome}`, origem: 'espelho' };

      if (this.store.conhecido(produto.id, destino.nome)) return 'já está na fila';
      const motivo = motivoRecusa(produto, this.filtros(fonte, destino), this.store, { descontoDesconhecidoPassa: true });
      if (motivo) return motivo;

      if (this.agora() - this.ultimoRefresh > 30 * MIN) {
        await this.affiliate.refresh();
        this.ultimoRefresh = this.agora();
      }
      const mapa = await this.affiliate.createLinks([produto.url]);
      const link = mapa.get(produto.url) || [...mapa.values()][0];
      if (!link) return 'ML não devolveu link de afiliado';

      this.store.upsert(produto);
      this.store.setLink(produto.url, link);
      this.contar(destino.nome);
      this.ultimoAceito = { nome: produto.nome, link };
      log(`🪞 [${destino.nome}] de "${fonte.nomeWhats || fonte.nome}": ${produto.nome.slice(0, 55)} — ${link}`);
      return 'ok';
    } catch (e) {
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
  }
}
