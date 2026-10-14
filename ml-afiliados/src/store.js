/**
 * "Banco" em arquivo JSON (data/db.json) — substitui a planilha do Google do curso.
 *
 * Ciclo de vida de um produto (mesmos status da planilha):
 *   PENDENTE  -> coletado, ainda sem link de afiliado
 *   PRONTO    -> tem link de afiliado, esperando a vez de ir pro grupo
 *   ENVIADO   -> já foi postado (fica no histórico para não repetir)
 *   ERRO      -> falhou ao gerar link / enviar
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from './config.js';
import { diaLocal } from './util.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');

export class Store {
  constructor(file = DB_FILE) {
    this.file = file;
    this.data = { produtos: {}, historico: {}, vistos: {}, stats: {} };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {}
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Foi enviado para este grupo nos últimos N dias? */
  enviadoRecentemente(id, grupo, dias) {
    const t = this.data.historico[`${grupo}:${id}`];
    return !!t && Date.now() - new Date(t).getTime() < dias * 86_400_000;
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
    if (status === 'ENVIADO') this.data.historico[`${p.grupo}:${p.id}`] = new Date().toISOString();
  }

  /**
   * Próximo produto PRONTO do grupo. Ofertas copiadas de outros grupos ("espelho") vão primeiro,
   * da mais nova para a mais antiga (elas vencem rápido); depois, as da busca própria, por desconto.
   */
  proximo(grupo) {
    const prontos = this.list((p) => p.grupo === grupo && p.status === 'PRONTO');
    if (!prontos.length) return null;
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
   * Devolve para a fila (PRONTO) as ofertas que falharam só no envio — o link de afiliado delas
   * continua válido. Chamado quando o bot liga.
   */
  reabrirErros() {
    let n = 0;
    for (const p of this.list((x) => x.status === 'ERRO' && x.linkAfiliado)) {
      p.status = 'PRONTO';
      delete p.erro;
      n++;
    }
    return n;
  }

  /** Limpeza diária (equivale ao "deleta os produtos da planilha" à meia-noite). Mantém o histórico. */
  limparDia(diasHistorico = 30) {
    const antes = Object.keys(this.data.produtos).length;
    this.data.produtos = {};
    const limite = Date.now() - diasHistorico * 86_400_000;
    for (const [k, t] of Object.entries(this.data.historico)) {
      if (new Date(t).getTime() < limite) delete this.data.historico[k];
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
