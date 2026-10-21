/**
 * Analytics — junta os resumos diários num período (hoje / 7 dias / 30 dias / um dia) e escreve o texto
 * do `npm run analytics`. Só lê: data/analytics/dias/*.json, membros.json, awin.json e, para HOJE, o histórico e
 * o db.json do momento (sem gravar nada no db e sem pegar a trava do bot).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadCategorias, loadGrupos, loadShopee, settings } from '../config.js';
import { diaLocal } from '../util.js';
import { PASTA_ANALYTICS, lerDia, lerEventos, montarDia } from './dia.js';
import { lerMembros, variacaoMembros } from './membros.js';
import { PAINEL_ML, lerAwin } from './ganhos.js';
import { montarAnalytics } from './produtos.js';

export const NOTAS = [
  'Funil dos canais: conta só as mensagens novas lidas com o bot ligado.',
  '"Recusadas na busca" = ofertas que não passaram nos filtros do grupo (nicho, vendas, desconto…) e nem entraram na fila — não é oferta boa jogada fora.',
  '"Barradas na hora de postar" = estavam na fila e não saíram (link inválido, vendas conferidas de novo). As repetidas aparecem à parte.',
  'Membros incluem você e o bot.',
  'Visualizações por post não aparecem: os canais são privados, e o Telegram só mostra isso em canal público.',
];

/** db.json só para leitura (o mesmo formato que o Store usa no analytics). */
export function lerStoreSoLeitura(arquivo = path.join(DATA_DIR, 'db.json')) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
  } catch {}
  return { data, list: (f = () => true) => Object.values(data.produtos || {}).filter(f) };
}

const diaMenos = (agora, n) => diaLocal(new Date(agora.getTime() - n * 86_400_000), settings.tz);

/** Os dias de um período, do mais antigo ao mais novo. */
export function diasDoPeriodo(periodo, agora = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodo)) return [periodo];
  const n = periodo === '30d' ? 30 : periodo === '7d' ? 7 : 1;
  return Array.from({ length: n }, (_, i) => diaMenos(agora, n - 1 - i));
}

const soma = (a, b) => (a || 0) + (b || 0);
function somarMapa(destino, origem) {
  for (const [k, v] of Object.entries(origem || {})) destino[k] = soma(destino[k], v);
  return destino;
}
const media = (pares) => {
  const validos = pares.filter(([v, peso]) => typeof v === 'number' && peso > 0);
  const total = validos.reduce((s, [, p]) => s + p, 0);
  return total ? Math.round((validos.reduce((s, [v, p]) => s + v * p, 0) / total) * 10) / 10 : null;
};

/** Soma uma lista de resumos diários num resumo do período. */
export function agregar(resumos, dias) {
  const grupos = {};
  const funil = {};
  const categorias = {};
  for (const r of resumos.filter(Boolean)) {
    for (const [nome, f] of Object.entries(r.funil || {})) {
      const x = (funil[nome] ??= { lidas: 0, comLink: 0, aceitas: 0, motivos: {} });
      x.lidas += f.lidas || 0;
      x.comLink += f.comLink || 0;
      x.aceitas += f.aceitas || 0;
      somarMapa(x.motivos, f.motivos);
    }
    for (const [nome, c] of Object.entries(r.coleta?.categorias || {})) {
      const x = (categorias[nome] ??= { encontrados: 0, aceitos: 0 });
      x.encontrados += c.encontrados || 0;
      x.aceitos += c.aceitos || 0;
    }
    for (const [nome, G] of Object.entries(r.grupos || {})) {
      const A = (grupos[nome] ??= {
        publicadas: 0, naFila: 0, recusadas: 0, barradas: 0, duplicados: 0, incertos: 0, erros: 0,
        filaVazia: 0, filaFim: null, porDia: {}, porHora: {}, vendas: {}, top10: [], fontes: {}, _desc: [], _cupom: [], _frete: [], _full: [], _preco: [],
      });
      A.publicadas += G.publicadas || 0;
      A.naFila += G.naFila || 0;
      A.recusadas += G.recusadas || 0;
      A.barradas += G.barradas || 0;
      A.duplicados += G.duplicados || 0;
      A.incertos += G.incertos || 0;
      A.erros += G.erros || 0;
      A.filaVazia += (G.filaVazia || []).length;
      if (G.filaFim != null) A.filaFim = G.filaFim; // o do dia mais recente
      A.porDia[r.dia] = G.publicadas || 0;
      somarMapa(A.porHora, G.porHora);
      somarMapa(A.vendas, G.vendas);
      A.top10.push(...(G.top10 || []).map((t) => ({ ...t, dia: r.dia })));
      const n = G.publicadas || 0;
      A._desc.push([G.descontoMedio, n]);
      A._cupom.push([G.pctCupom, n]);
      A._frete.push([G.pctFreteGratis, n]);
      A._full.push([G.pctFull, n]);
      A._preco.push([G.precos?.media, n]);
      for (const [fn, F] of Object.entries(G.fontes || {})) {
        const X = (A.fontes[fn] ??= { naFila: 0, publicadas: 0, recusadas: 0, recusas: {}, barradas: 0, barragens: {}, duplicados: 0, incertos: 0, erros: 0 });
        for (const k of ['naFila', 'publicadas', 'recusadas', 'barradas', 'duplicados', 'incertos', 'erros']) X[k] += F[k] || 0;
        somarMapa(X.recusas, F.recusas);
        somarMapa(X.barragens, F.barragens);
      }
    }
  }
  for (const A of Object.values(grupos)) {
    A.descontoMedio = media(A._desc);
    A.pctCupom = media(A._cupom);
    A.pctFreteGratis = media(A._frete);
    A.pctFull = media(A._full);
    A.precoMedio = media(A._preco);
    for (const k of ['_desc', '_cupom', '_frete', '_full', '_preco']) delete A[k];
    A.top10 = A.top10.sort((a, b) => (b.descontoPct || 0) - (a.descontoPct || 0)).slice(0, 10);
    for (const d of dias) A.porDia[d] ??= 0;
    // Quanto da fila do grupo veio de cada fonte, e quanto do que ela trouxe saiu.
    for (const F of Object.values(A.fontes)) {
      F.parteDaFila = A.naFila ? Math.round((F.naFila / A.naFila) * 100) : null;
      F.aproveitamento = F.naFila + F.recusadas ? Math.round((F.naFila / (F.naFila + F.recusadas)) * 100) : null;
      F.soRecusa = F.recusadas > 0 && F.naFila === 0 && F.publicadas === 0;
    }
  }
  const diasComDado = resumos.filter(Boolean).map((r) => r.dia).sort();
  return { dias, diasComDado, grupos, funil, categorias };
}

/** Categorias do Mercado Livre que não publicaram nada no período (candidatas a sair). */
export function categoriasParadas(agregado) {
  const publicadas = {};
  // Sem nenhuma fonte por categoria (eventos de antes do analytics) não dá para dizer quais pararam.
  const temCategoria = Object.values(agregado.grupos).some((G) => Object.keys(G.fontes).some((f) => f.startsWith('Mercado Livre: ')));
  if (!temCategoria) return [];
  for (const G of Object.values(agregado.grupos)) {
    for (const [fn, F] of Object.entries(G.fontes)) if (fn.startsWith('Mercado Livre: ')) publicadas[fn.slice(15)] = soma(publicadas[fn.slice(15)], F.publicadas);
  }
  return Object.keys(agregado.categorias).filter((c) => !publicadas[c] && !c.startsWith('Amazon') && !c.startsWith('Awin')).sort();
}

function dinheiroAwin(awin, dias) {
  const t = { cliques: 0, pendentes: { vendas: 0, comissao: 0 }, aprovadas: { vendas: 0, comissao: 0 }, recusadas: { vendas: 0, comissao: 0 } };
  let algum = false;
  for (const d of dias) {
    const x = awin.dias?.[d]?.total;
    if (!x) continue;
    algum = true;
    t.cliques += x.cliques;
    for (const k of ['pendentes', 'aprovadas', 'recusadas']) {
      t[k].vendas += x[k].vendas;
      t[k].comissao = Math.round((t[k].comissao + x[k].comissao) * 100) / 100;
    }
  }
  return algum ? t : null;
}

/**
 * Tudo o que o painel mostra, para os três períodos (ou um dia só, se pedido).
 * HOJE é montado na hora a partir do histórico (o arquivo do dia só sai às 21h55).
 */
/** Grupos e categorias de busca ligados na configuração (para o Analytics de produtos). */
export function configDoPainel() {
  const grupos = loadGrupos().map((g) => ({ nome: g.nome, ativo: g.ativo }));
  const ligado = new Set(grupos.filter((g) => g.ativo).map((g) => g.nome));
  const shopee = loadShopee();
  const categoriasAtivas = [
    ...loadCategorias().filter((c) => c.ativo && ligado.has(c.grupo)).map((c) => ({ nome: c.nome, loja: 'Mercado Livre' })),
    ...(shopee.ativo === false ? [] : Object.entries(shopee.grupos || {}).filter(([g, x]) => x.ativo !== false && ligado.has(g)).map(([g]) => ({ nome: `Shopee: ${g}`, loja: 'Shopee' }))),
  ];
  return { gruposConfig: grupos, categoriasAtivas: [...new Map(categoriasAtivas.map((c) => [c.nome, c])).values()] };
}

/** Quando cada grupo publicou pela última vez (do histórico). */
export function ultimasPublicacoes(eventos) {
  const ultima = {};
  for (const e of eventos) if (e?.tipo === 'publicado' && e.grupo && e.t && (!ultima[e.grupo] || e.t > ultima[e.grupo])) ultima[e.grupo] = e.t;
  return ultima;
}

export function montarPainel({ base = PASTA_ANALYTICS, store = lerStoreSoLeitura(), eventos, agora = new Date(), periodos = ['hoje', '7d', '30d'], config = null } = {}) {
  const hoje = diaLocal(agora, settings.tz);
  let ao = null;
  let todos = eventos;
  const resumoDe = (dia) => {
    if (dia !== hoje) return lerDia(dia, base);
    ao ??= montarDia(hoje, { eventos: (todos ??= lerEventos()), store, parcial: true, agora });
    return ao;
  };
  const awin = lerAwin(base);
  const membros = lerMembros(base);
  const saida = { atualizadoEm: agora.toISOString(), hora: agora.toLocaleString('pt-BR', { timeZone: settings.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), periodos: {}, notas: NOTAS, painelML: PAINEL_ML };
  for (const p of periodos) {
    const dias = diasDoPeriodo(p, agora);
    const ag = agregar(dias.map(resumoDe), dias);
    ag.categoriasParadas = p === 'hoje' ? [] : categoriasParadas(ag);
    ag.awin = dinheiroAwin(awin, dias);
    saida.periodos[p] = ag;
  }
  const ultimo = Object.keys(membros).sort().at(-1) || hoje;
  saida.membros = Object.fromEntries(
    [...new Set(Object.values(membros).flatMap((m) => Object.keys(m || {})))].map((g) => [g, variacaoMembros(membros, g, ultimo)]).filter(([, v]) => v)
  );
  saida.awin30 = awin.periodo30 ? { inicio: awin.periodo30.inicio, fim: awin.periodo30.fim, total: awin.periodo30.total, lojas: awin.periodo30.lojas } : null;
  // Analytics de produtos (a tela nova): tudo calculado aqui, por período.
  const cfg = config ?? configDoPainel();
  saida.analytics = montarAnalytics(saida, { ...cfg, ultimaPublicacao: ultimasPublicacoes((todos ??= lerEventos())), hoje, agora, tz: settings.tz });
  return saida;
}

const brl = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sinal = (n) => (n == null ? '—' : n > 0 ? `+${n}` : String(n));
const NOME_PERIODO = { hoje: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias' };

/** O texto do `npm run analytics`. */
export function textoDoPainel(painel, periodo) {
  const ag = painel.periodos[periodo];
  const l = [];
  l.push(`📊 ${NOME_PERIODO[periodo] || periodo} — atualizado ${painel.hora}`);
  if (!Object.keys(ag.grupos).length) l.push('', 'Ainda não há dados neste período.');
  for (const [nome, G] of Object.entries(ag.grupos).sort((a, b) => b[1].publicadas - a[1].publicadas)) {
    const m = painel.membros[nome];
    l.push('', `■ ${nome}: ${G.publicadas} publicadas | ${G.naFila} entraram na fila | ${G.recusadas} recusadas na busca | ${G.barradas} barradas na hora de postar | ${G.duplicados} repetidas`);
    if (G.incertos || G.erros) l.push(`  envios sem confirmação: ${G.incertos} | falhas: ${G.erros}`);
    if (G.filaVazia) l.push(`  horários de envio com a fila vazia: ${G.filaVazia}`);
    if (G.filaFim != null) l.push(`  ${periodo === 'hoje' ? 'na fila agora' : 'sobraram na fila no fim do último dia'}: ${G.filaFim}`);
    if (G.descontoMedio != null) l.push(`  desconto médio ${G.descontoMedio}% | preço médio ${brl(G.precoMedio)} | com cupom ${G.pctCupom}% | frete grátis ${G.pctFreteGratis}% | FULL ${G.pctFull}%`);
    if (m) l.push(`  membros (inclui você e o bot): ${m.atual} (dia ${sinal(m.dia)}, semana ${sinal(m.semana)}, desde ${m.desde.split('-').reverse().join('/')} ${sinal(m.inicio)})`);
    const fontes = Object.entries(G.fontes).sort((a, b) => b[1].publicadas - a[1].publicadas || b[1].naFila - a[1].naFila);
    for (const [fn, F] of fontes) {
      const motivos = Object.entries(F.recusas).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
      l.push(`    · ${fn}: ${F.publicadas} publicadas, ${F.naFila} na fila (${F.parteDaFila ?? 0}% da fila), ${F.recusadas} recusadas${motivos ? ` [${motivos}]` : ''}${F.soRecusa ? '  ⚠️ só recusa' : ''}`);
    }
  }
  const funil = Object.entries(ag.funil);
  if (funil.length) {
    l.push('', 'Canais acompanhados (mensagens lidas → com link de loja → aceitas):');
    for (const [fn, f] of funil.sort((a, b) => b[1].aceitas - a[1].aceitas)) {
      const motivos = Object.entries(f.motivos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
      l.push(`  · ${fn}: ${f.lidas} → ${f.comLink} → ${f.aceitas}${motivos ? ` [${motivos}]` : ''}`);
    }
  }
  if (ag.categoriasParadas?.length) l.push('', `Categorias do ML sem nenhuma publicação no período: ${ag.categoriasParadas.join(', ')}`);
  l.push('', 'Dinheiro:');
  if (ag.awin) l.push(`  Awin: ${ag.awin.cliques} cliques | pendente ${brl(ag.awin.pendentes.comissao)} (${ag.awin.pendentes.vendas} vendas) | aprovado ${brl(ag.awin.aprovadas.comissao)} (${ag.awin.aprovadas.vendas} vendas)`);
  else l.push('  Awin: aguardando a 1ª leitura do relatório (sai ao ligar, 12h30 e 21h52).');
  l.push(`  Mercado Livre: ver no painel do ML — ${painel.painelML}`);
  l.push('', ...painel.notas.map((n) => `ℹ️ ${n}`));
  return l.join('\n');
}
