/**
 * "Banco" em arquivo JSON (data/db.json) — substitui a planilha do Google do curso.
 *
 * Ciclo de vida de um produto (mesmos status da planilha, mais os de controle de envio):
 *   PENDENTE  -> coletado, ainda sem link de afiliado
 *   PRONTO    -> tem link de afiliado, esperando a vez de ir pro grupo
 *   ENVIANDO  -> o envio começou (gravado ANTES de chamar o Telegram/WhatsApp)
 *   ENVIADO   -> já foi postado (fica no histórico para não repetir)
 *   INCERTO   -> o envio não teve resposta (timeout/queda): PODE ter saído. Conta como enviado e não é repetido.
 *   ERRO      -> falhou com resposta clara de "não foi" (pode tentar de novo, até 3 vezes)
 *   DUPLICADO -> barrado na hora de postar: o mesmo produto (ou o mesmo nome) já saiu no grupo
 *   REJEITADO -> barrado na hora de postar: link de afiliado inválido, ou ML sem mais de 50 vendas (fila antiga)
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from './config.js';
import { diaLocal, log, normalizar } from './util.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_TENTATIVAS = 3;
const NA_FILA = new Set(['PENDENTE', 'PRONTO', 'ENVIANDO']);

/** Chave do produto pelo nome, para achar o mesmo produto anunciado com outro id (outro vendedor/anúncio). */
export const chaveNome = (p) => normalizar(p.nome); // mantém números e unidades: "100ml" ≠ "50ml", "kit 3" ≠ "kit 2"

/** Guarda só os últimos `dias` dias de um mapa { "AAAA-MM-DD": ... } (as chaves ordenam como datas). */
function podarDias(mapa, dias = 14) {
  for (const k of Object.keys(mapa).sort().slice(0, -dias)) delete mapa[k];
}

export class Store {
  constructor(file = DB_FILE) {
    this.file = file;
    this.data = { produtos: {}, historico: {}, nomes: {}, vistos: {}, stats: {} };
    this.recuperacao = null; // preenchido se o db.json não pôde ser lido (o index avisa o dono)
    this.carregar(file);
    this.anotarNomesAntigos();
  }

  carregar(file) {
    const lido = this.ler(file);
    if (lido) {
      this.data = { ...this.data, ...lido };
      return;
    }
    if (!fs.existsSync(file)) return; // primeira vez: começa vazio
    // O db.json existe mas está estragado (ex.: queda de energia no meio da gravação): guarda e usa o backup.
    const guardado = `${file}.corrompido-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.renameSync(file, guardado);
    } catch {}
    const bak = this.ler(`${file}.bak`);
    if (bak) {
      this.data = { ...this.data, ...bak };
      this.recuperacao = { de: 'backup', guardado };
      log(`⚠️  O db.json estava estragado (guardado em ${path.basename(guardado)}); carreguei a última cópia boa (db.json.bak).`);
    } else {
      this.recuperacao = { de: 'vazio', guardado };
      log(`❌ O db.json estava estragado e não há cópia boa: a fila e o histórico de envios começam VAZIOS (o arquivo velho ficou em ${path.basename(guardado)}).`);
    }
  }

  ler(arquivo) {
    try {
      const d = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      return d && typeof d === 'object' && d.produtos ? d : null;
    } catch {
      return null;
    }
  }

  /** Grava sem risco de deixar o arquivo pela metade: .tmp com fsync, cópia da versão anterior em .bak, e troca. */
  save() {
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(this.data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (this.ler(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    } catch {}
    fs.renameSync(tmp, this.file);
  }

  /** Foi enviado para este grupo nos últimos N dias? */
  enviadoRecentemente(id, grupo, dias) {
    const t = this.data.historico[`${grupo}:${id}`];
    return !!t && Date.now() - new Date(t).getTime() < dias * 86_400_000;
  }

  /** Um produto com o MESMO nome (outro id) saiu neste grupo nos últimos N dias? */
  nomeRecente(p, dias) {
    const t = this.data.nomes?.[`${p.grupo}:${chaveNome(p)}`];
    return !!t && Date.now() - new Date(t).getTime() < dias * 86_400_000;
  }

  /** Outro anúncio com o mesmo nome já está na fila deste grupo? */
  duplicadoNaFila(p) {
    const chave = chaveNome(p);
    return this.list((x) => x.grupo === p.grupo && x.id !== p.id && NA_FILA.has(x.status) && chaveNome(x) === chave).length > 0;
  }

  /** Última checagem antes de postar. Devolve o motivo (já saiu) ou null. */
  jaPublicado(p, dias) {
    if (this.enviadoRecentemente(p.id, p.grupo, dias)) return 'já publicado';
    if (this.nomeRecente(p, dias)) return 'mesmo produto já publicado (outro anúncio)';
    return null;
  }

  /** Insere ou atualiza (preço muda ao longo do dia). Retorna true se for novo. */
  upsert(p) {
    const key = `${p.grupo}:${p.id}`;
    const atual = this.data.produtos[key];
    if (atual && atual.status !== 'PENDENTE' && atual.status !== 'PRONTO') return false;
    this.data.produtos[key] = {
      ...atual,
      ...p,
      linkAfiliado: atual?.linkAfiliado || p.linkAfiliado || null,
      status: atual?.linkAfiliado || p.linkAfiliado ? 'PRONTO' : 'PENDENTE',
      coletadoEm: atual?.coletadoEm || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    return !atual;
  }

  list(filter = () => true) {
    return Object.values(this.data.produtos).filter(filter);
  }

  pendentesDeLink() {
    return this.list((p) => p.status === 'PENDENTE');
  }

  setLink(url, link) {
    let n = 0;
    for (const p of this.list((p) => p.url === url)) {
      p.linkAfiliado = link;
      p.status = 'PRONTO';
      n++;
    }
    return n;
  }

  setStatus(p, status, extra = {}) {
    Object.assign(this.data.produtos[`${p.grupo}:${p.id}`], { status, ...extra });
    // INCERTO também vai para o histórico: melhor não repostar do que postar duas vezes.
    if (status === 'ENVIADO' || status === 'INCERTO') this.anotarPublicado(p);
  }

  /**
   * db.json de antes do bloqueio por nome (sem `nomes`): os enviados que ainda estão em `produtos` ganham a
   * entrada pelo nome, com a hora em que saíram. Os de dias anteriores já foram limpos e só têm a chave por id.
   */
  anotarNomesAntigos() {
    const nomes = (this.data.nomes ??= {});
    for (const p of this.list((x) => (x.status === 'ENVIADO' || x.status === 'INCERTO') && x.nome)) {
      const chave = `${p.grupo}:${chaveNome(p)}`;
      if (!nomes[chave]) nomes[chave] = p.enviadoEm || this.data.historico[`${p.grupo}:${p.id}`] || new Date().toISOString();
    }
  }

  anotarPublicado(p) {
    const agora = new Date().toISOString();
    this.data.historico[`${p.grupo}:${p.id}`] = agora;
    (this.data.nomes ??= {})[`${p.grupo}:${chaveNome(p)}`] = agora;
  }

  /**
   * Envios que ficaram pela metade (o bot caiu durante o envio): viram INCERTO — podem ter saído,
   * então não são repetidos. Chamado quando o bot liga. Devolve os produtos afetados.
   */
  recuperarEnvios() {
    const afetados = this.list((p) => p.status === 'ENVIANDO');
    for (const p of afetados) this.setStatus(p, 'INCERTO', { erro: 'o bot parou durante o envio' });
    return afetados;
  }

  /**
   * Próximo produto PRONTO do grupo. Ofertas copiadas de outros grupos ("espelho") vão primeiro,
   * da mais nova para a mais antiga (elas vencem rápido); depois, as da busca própria, por desconto.
   */
  proximo(grupo, { aceitar = () => true, preferir = null } = {}) {
    let prontos = this.list((p) => p.grupo === grupo && p.status === 'PRONTO' && aceitar(p));
    if (!prontos.length) return null;
    // `preferir` dá uma nota a cada oferta (ex.: feminino 2, neutro 1, masculino 0): só as de nota mais alta concorrem.
    if (preferir) {
      const melhor = Math.max(...prontos.map((p) => Number(preferir(p))));
      prontos = prontos.filter((p) => Number(preferir(p)) === melhor);
    }
    const espelho = prontos.filter((p) => p.origem === 'espelho');
    if (espelho.length) return espelho.sort((a, b) => String(b.coletadoEm).localeCompare(String(a.coletadoEm)))[0];
    // Cupons de loja parceira também passam na frente (são poucos por busca e têm prazo), mas nunca dois seguidos.
    const cupom = prontos.find((p) => p.prioridade);
    let fila = prontos;
    if (cupom) {
      const ultimo = this.list((p) => p.grupo === grupo && p.status === 'ENVIADO' && p.enviadoEm).sort((a, b) => String(a.enviadoEm).localeCompare(String(b.enviadoEm))).at(-1);
      if (!ultimo?.prioridade) return cupom;
      const produtos = prontos.filter((p) => !p.prioridade);
      if (produtos.length) fila = produtos;
    }
    fila.sort((a, b) => (b.descontoPct || 0) - (a.descontoPct || 0));
    const top = fila.slice(0, 5);
    return top[Math.floor(Math.random() * top.length)];
  }

  /** Mensagem de outro grupo já foi lida? (guarda os ids por 3 dias) */
  jaViu(msgId) {
    return !!this.data.vistos[msgId];
  }

  marcarVisto(msgId) {
    this.data.vistos[msgId] = Date.now();
    const limite = Date.now() - 3 * 86_400_000;
    const ids = Object.keys(this.data.vistos);
    if (ids.length > 3000) for (const id of ids) if (this.data.vistos[id] < limite) delete this.data.vistos[id];
  }

  /** O produto já está na fila ou já foi enviado hoje para esse grupo? */
  conhecido(id, grupo) {
    return !!this.data.produtos[`${grupo}:${id}`];
  }

  /**
   * Devolve para a fila (PRONTO) as ofertas que falharam no envio com resposta clara de "não foi" — o link de
   * afiliado delas continua válido. Até MAX_TENTATIVAS por oferta. INCERTO nunca volta (pode ter saído).
   * Chamado quando o bot liga e a cada busca.
   */
  reabrirErros() {
    let n = 0;
    for (const p of this.list((x) => x.status === 'ERRO' && x.linkAfiliado && (x.tentativas || 0) < MAX_TENTATIVAS)) {
      p.status = 'PRONTO';
      delete p.erro;
      n++;
    }
    return n;
  }

  /** Limpeza diária (equivale ao "deleta os produtos da planilha" à meia-noite). Mantém o histórico. */
  limparDia(diasHistorico = 30) {
    // Envio que ficou pela metade não pode sumir sem deixar rastro no histórico (senão volta a ser postado).
    this.recuperarEnvios();
    const antes = Object.keys(this.data.produtos).length;
    this.data.produtos = {};
    const limite = Date.now() - diasHistorico * 86_400_000;
    for (const mapa of [this.data.historico, (this.data.nomes ??= {})]) {
      for (const [k, t] of Object.entries(mapa)) if (new Date(t).getTime() < limite) delete mapa[k];
    }
    return antes;
  }

  /** Guarda os números de uma coleta no dia (para o resumo diário). Mantém 14 dias. */
  registrarColeta({ encontrados = 0, novos = 0, recusas = {}, categorias = {} }, dia = diaLocal(new Date(), settings.tz)) {
    const stats = (this.data.stats ??= {});
    const d = (stats[dia] ??= { coletas: 0, encontrados: 0, novos: 0, recusas: {}, categorias: {} });
    d.coletas++;
    d.encontrados += encontrados;
    d.novos += novos;
    for (const [k, v] of Object.entries(recusas)) d.recusas[k] = (d.recusas[k] || 0) + v;
    for (const [nome, c] of Object.entries(categorias)) {
      const alvo = (d.categorias[nome] ??= { encontrados: 0, aceitos: 0 });
      alvo.encontrados += c.encontrados || 0;
      alvo.aceitos += c.aceitos || 0;
    }
    for (const k of Object.keys(stats).sort().slice(0, -14)) delete stats[k];
  }

  /**
   * Funil do espelho por fonte (canal, grupo ou caixa de entrada), por dia: mensagens lidas, com link de loja,
   * aceitas e o motivo das outras. Um contador, não uma linha por mensagem. Mantém 14 dias (limparDia não apaga).
   */
  contarFunil(fonte, resultado, dia = diaLocal(new Date(), settings.tz)) {
    const funil = (this.data.funil ??= {});
    const x = ((funil[dia] ??= {})[fonte] ??= { lidas: 0, comLink: 0, aceitas: 0, motivos: {} });
    x.lidas++;
    if (resultado !== 'sem link do ML/Amazon') x.comLink++;
    if (resultado === 'ok') x.aceitas++;
    else x.motivos[resultado] = (x.motivos[resultado] || 0) + 1;
    podarDias(funil);
  }

  /** Horário de envio em que o grupo estava com a fila vazia (para o analytics). Mantém 14 dias. */
  anotarFilaVazia(grupo, agora = new Date()) {
    const filaVazia = (this.data.filaVazia ??= {});
    const lista = ((filaVazia[diaLocal(agora, settings.tz)] ??= {})[grupo] ??= []);
    const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: settings.tz });
    if (lista.at(-1) !== hora) lista.push(hora);
    podarDias(filaVazia);
  }

  statsDoDia(dia = diaLocal(new Date(), settings.tz)) {
    return this.data.stats?.[dia] || null;
  }

  resumo() {
    const r = {};
    for (const p of this.list()) {
      r[p.grupo] ??= { PENDENTE: 0, PRONTO: 0, ENVIADO: 0, ERRO: 0 };
      r[p.grupo][p.status] = (r[p.grupo][p.status] || 0) + 1;
    }
    return r;
  }
}
