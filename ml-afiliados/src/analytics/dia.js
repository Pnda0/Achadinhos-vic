/**
 * Analytics — o resumo de cada dia, guardado em data/analytics/dias/AAAA-MM-DD.json (180 dias).
 *
 * Sai de três lugares: o histórico por produto (data/produtos.log), os contadores do dia no db.json
 * (funil do espelho, horários com fila vazia, números da busca) e a fila que sobrou no fim do dia.
 * Depois de gravado, o painel e o `npm run analytics` leem só destes arquivos.
 *
 * Quando é gerado (o PC fica ligado só das 7h às 22h):
 *   - 21h55: o dia de hoje, "parcial" (ainda faltam os últimos envios);
 *   - ao ligar: os últimos 7 dias que estão sem arquivo ou só com o parcial (o dia fechado de verdade);
 *   - à meia-noite, se o PC estiver ligado: o dia que acabou, antes da limpeza da fila.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from '../config.js';
import { arquivoEventos } from '../eventos.js';
import { lerVendas } from '../ml/vendas.js';
import { diaLocal } from '../util.js';

export const PASTA_ANALYTICS = path.join(DATA_DIR, 'analytics');
export const MANTER_DIAS = 180;
const pastaDias = (base) => path.join(base, 'dias');

/** Todas as linhas do histórico (arquivo antigo primeiro). Linha cortada é pulada. */
export function lerEventos(arquivo = arquivoEventos()) {
  const saida = [];
  for (const arq of [arquivo + '.antigo', arquivo]) {
    let texto = '';
    try {
      texto = fs.readFileSync(arq, 'utf8');
    } catch {
      continue;
    }
    for (const l of texto.split('\n')) {
      if (!l) continue;
      try {
        saida.push(JSON.parse(l));
      } catch {}
    }
  }
  return saida;
}

/** Eventos de antes do campo `fonte`: o melhor nome que dá para tirar da origem. */
const FONTE_ANTIGA = { coleta: 'Mercado Livre', espelho: 'Espelho', caixa: 'Caixa de entrada', 'awin-cupom': 'Awin', amazon: 'Amazon' };
const fonteDoEvento = (e) => e.fonte || FONTE_ANTIGA[e.origem] || 'Outra';

const FAIXAS_VENDAS = [
  [10_001, 'mais de 10 mil'],
  [5_001, 'mais de 5 mil'],
  [1_001, 'mais de mil'],
  [501, 'mais de 500'],
  [101, 'mais de 100'],
  [51, 'mais de 50'],
];

/** Faixa de vendas do rótulo do ML ("+1000 vendidos" -> "mais de 500"... conforme o mínimo garantido). */
export function faixaVendas(rotulo) {
  const v = lerVendas(rotulo);
  if (!v) return 'sem dado';
  return FAIXAS_VENDAS.find(([min]) => v.minimo >= min)?.[1] || 'até 50';
}

const redondo = (n) => Math.round(n * 100) / 100;
const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 100) : null);

function numeros(lista) {
  const v = lista.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return {
    media: redondo(v.reduce((s, n) => s + n, 0) / v.length),
    mediana: redondo(v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2),
    min: v[0],
    max: v.at(-1),
  };
}

const novoGrupo = () => ({
  publicadas: 0,
  naFila: 0,
  recusadas: 0, // na busca (não entraram na fila)
  barradas: 0, // na hora de postar (link inválido, vendas na conferência final); repetidas ficam em "duplicados"
  duplicados: 0,
  linkInvalido: 0,
  incertos: 0,
  erros: 0,
  filaFim: null,
  filaVazia: [],
  precos: null,
  descontoMedio: null,
  pctCupom: null,
  pctFreteGratis: null,
  pctFull: null,
  vendas: {},
  porHora: {},
  top10: [],
  fontes: {},
});
const novaFonte = () => ({ naFila: 0, publicadas: 0, recusadas: 0, recusas: {}, barradas: 0, barragens: {}, duplicados: 0, incertos: 0, erros: 0 });

/** Quantas ofertas sobraram na fila de cada grupo — só se a fila do db.json é deste dia. */
function filaQueSobrou(store, dia) {
  const fila = store?.list((p) => p.status === 'PRONTO' || p.status === 'PENDENTE') || [];
  if (!fila.length || fila.some((p) => !p.coletadoEm || diaLocal(new Date(p.coletadoEm), settings.tz) !== dia)) return null;
  const porGrupo = {};
  for (const p of fila) porGrupo[p.grupo] = (porGrupo[p.grupo] || 0) + 1;
  return porGrupo;
}

/**
 * Monta o resumo de um dia (não grava). `eventos` = linhas do produtos.log (todas; filtra pelo dia aqui).
 * O funil do espelho fica por fonte, no geral: uma mensagem pode ir para mais de um grupo, então não é dividido.
 */
export function montarDia(dia, { eventos = [], store = null, membros = null, parcial = false, agora = new Date() } = {}) {
  const grupos = {};
  const publicadas = {};
  for (const e of eventos) {
    if (!e?.t || !e.grupo || diaLocal(new Date(e.t), settings.tz) !== dia) continue;
    const G = (grupos[e.grupo] ??= novoGrupo());
    const F = (G.fontes[fonteDoEvento(e)] ??= novaFonte());
    switch (e.tipo) {
      case 'na_fila':
        G.naFila++;
        F.naFila++;
        break;
      // Recusada na BUSCA (filtros do grupo: nicho, vendas, desconto...): oferta que nem entrou na fila.
      case 'recusado':
      case 'sem_link': {
        const motivo = e.tipo === 'sem_link' ? 'sem link de afiliado' : e.detalhe || 'outro';
        G.recusadas++;
        F.recusadas++;
        F.recusas[motivo] = (F.recusas[motivo] || 0) + 1;
        break;
      }
      // Barrada NA HORA DE POSTAR: estava na fila e não saiu (link inválido, vendas na conferência final).
      case 'link_invalido':
      case 'barrado': {
        const motivo = e.detalhe || (e.tipo === 'link_invalido' ? 'link inválido' : 'outro');
        if (e.tipo === 'link_invalido') G.linkInvalido++;
        G.barradas++;
        F.barradas++;
        F.barragens[motivo] = (F.barragens[motivo] || 0) + 1;
        break;
      }
      case 'publicado':
        G.publicadas++;
        F.publicadas++;
        (publicadas[e.grupo] ??= []).push(e);
        break;
      case 'duplicado':
        G.duplicados++;
        F.duplicados++;
        break;
      case 'sem_confirmacao':
        G.incertos++;
        F.incertos++;
        break;
      case 'falha_envio':
        G.erros++;
        F.erros++;
        break;
    }
  }

  for (const [nome, lista] of Object.entries(publicadas)) {
    const G = grupos[nome];
    // Preço, cupom, frete e vendas só existem nos eventos gravados desde o analytics (têm "hora"): os antigos
    // ficam de fora dessas contas em vez de contar como "sem cupom"/"sem dado".
    const ricos = lista.filter((e) => 'hora' in e);
    G.precos = numeros(ricos.map((e) => e.preco));
    G.descontoMedio = numeros(ricos.map((e) => e.descontoPct))?.media ?? null;
    G.pctCupom = pct(ricos.filter((e) => e.cupom).length, ricos.length);
    G.pctFreteGratis = pct(ricos.filter((e) => e.freteGratis).length, ricos.length);
    G.pctFull = pct(ricos.filter((e) => e.full).length, ricos.length);
    for (const e of ricos) if (!e.loja || e.loja === 'ml') G.vendas[faixaVendas(e.vendidos)] = (G.vendas[faixaVendas(e.vendidos)] || 0) + 1;
    for (const e of lista) {
      const hora = (e.hora || new Date(e.t).toLocaleTimeString('pt-BR', { hour: '2-digit', hour12: false, timeZone: settings.tz })).slice(0, 2);
      G.porHora[hora] = (G.porHora[hora] || 0) + 1;
    }
    G.top10 = [...lista]
      .sort((a, b) => (b.descontoPct || 0) - (a.descontoPct || 0))
      .slice(0, 10)
      .map((e) => ({ nome: e.nome, preco: e.preco ?? null, descontoPct: e.descontoPct ?? null, fonte: fonteDoEvento(e), hora: e.hora || null }));
  }

  const sobra = filaQueSobrou(store, dia);
  for (const [nome, G] of Object.entries(grupos)) {
    G.filaFim = sobra ? sobra[nome] || 0 : null;
    G.filaVazia = store?.data?.filaVazia?.[dia]?.[nome] || [];
  }
  // Grupo que só teve "fila vazia" no dia (nenhum evento) também aparece.
  for (const [nome, horas] of Object.entries(store?.data?.filaVazia?.[dia] || {})) (grupos[nome] ??= novoGrupo()).filaVazia = horas;

  return {
    versao: 1,
    dia,
    parcial,
    geradoEm: agora.toISOString(),
    grupos,
    funil: store?.data?.funil?.[dia] || {},
    coleta: store?.data?.stats?.[dia] || null,
    membros,
  };
}

/** Grava o resumo do dia (sem deixar arquivo pela metade) e apaga os de mais de 180 dias. */
export function gravarDia(resumo, base = PASTA_ANALYTICS) {
  const pasta = pastaDias(base);
  fs.mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, `${resumo.dia}.json`);
  fs.writeFileSync(arq + '.tmp', JSON.stringify(resumo, null, 1));
  fs.renameSync(arq + '.tmp', arq);
  const dias = fs.readdirSync(pasta).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of dias.slice(0, -MANTER_DIAS)) fs.rmSync(path.join(pasta, f), { force: true });
  return arq;
}

/** Lê o resumo gravado de um dia (null se não houver). */
export function lerDia(dia, base = PASTA_ANALYTICS) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaDias(base), `${dia}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Dias com resumo gravado, do mais antigo ao mais novo. */
export function diasGravados(base = PASTA_ANALYTICS) {
  try {
    return fs
      .readdirSync(pastaDias(base))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

export function gerarDia(dia, { store, base = PASTA_ANALYTICS, parcial = false, eventos = lerEventos(), membros = null, agora = new Date() } = {}) {
  const resumo = montarDia(dia, { eventos, store, membros, parcial, agora });
  gravarDia(resumo, base);
  return resumo;
}

/**
 * Ao ligar: gera os dias de trás (até `dias`) que estão sem arquivo ou só com o parcial das 21h55.
 * Hoje fica de fora (ainda não acabou). Devolve os dias gerados.
 */
export function porEmDia({ store, base = PASTA_ANALYTICS, dias = 7, agora = new Date(), eventos, membrosDoDia = () => null } = {}) {
  const hoje = diaLocal(agora, settings.tz);
  const gerados = [];
  let todos = eventos;
  for (let i = dias; i >= 1; i--) {
    const dia = diaLocal(new Date(agora.getTime() - i * 86_400_000), settings.tz);
    if (dia === hoje) continue;
    const atual = lerDia(dia, base);
    if (atual && !atual.parcial) continue;
    todos ??= lerEventos();
    // Dia sem nenhum dado (bot desligado o dia todo) não vira arquivo vazio.
    const temDado = todos.some((e) => e?.t && diaLocal(new Date(e.t), settings.tz) === dia) || store?.data?.funil?.[dia] || store?.data?.stats?.[dia];
    if (!temDado && !atual) continue;
    const resumo = montarDia(dia, { eventos: todos, store, membros: membrosDoDia(dia) ?? atual?.membros ?? null, agora });
    // A fila que sobrou só dá para medir com a fila daquele dia no db.json; se ela já foi trocada, fica a do parcial.
    for (const [nome, G] of Object.entries(resumo.grupos)) if (G.filaFim == null) G.filaFim = atual?.grupos?.[nome]?.filaFim ?? null;
    gravarDia(resumo, base);
    gerados.push(dia);
  }
  return gerados;
}
