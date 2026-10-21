/**
 * Analytics de produtos — a página do painel (um arquivo só; gráficos em HTML/CSS; tema escuro com o rosa da marca).
 * Todos os números vêm de painel.analytics (src/analytics/produtos.js): a página só desenha. Os dados vão embutidos
 * (abre com dois cliques, sem servidor) e também em dados.json ao lado. Período e aba ficam na URL (?periodo=7d&aba=resumo).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ANALYTICS } from './dia.js';

export const pastaSite = (base = PASTA_ANALYTICS) => path.join(base, 'site');

const CSS = `
:root{color-scheme:dark;--bg:#121111;--surface:#1a1918;--surface-2:#1f1d1c;--track:#242221;--border:#262423;--border-2:#2c2a29;--text:#ece8e5;--text-2:#b9b3af;--text-3:#9e9894;--text-4:#8f8985;--accent:#d27d99;--accent-hover:#e8a9bd;--warn:#e0aa5e;--warn-bg:#2c2318;--crit:#e58a8a;--crit-bg:#2e1c1c;--ok:#86c29b;--ok-bg:#1a2a20;--info:#a9bde0;--info-bg:#1c2230;--recusa:#6b6562}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.num,td,.kpi-valor,.mini b,.tot{font-variant-numeric:tabular-nums}
a{color:var(--accent)}a:hover{color:var(--accent-hover)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
.menu{border-right:1px solid var(--border);padding:22px 16px;display:flex;flex-direction:column;gap:14px}
.marca-nome{font-size:19px;font-weight:700;color:var(--text)}.marca-nome .estrela{color:var(--accent);margin-left:4px}
.marca-sub{font-size:13px;color:var(--text-3)}
.busca input{width:100%;background:var(--surface);border:1px solid var(--border-2);border-radius:10px;color:var(--text);padding:8px 10px;font:inherit}
.busca input::placeholder{color:var(--text-4)}
.menu h2{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--text-4);margin:10px 8px 4px}
.menu ul{list-style:none;margin:0;padding:0}
.menu li>a,.menu li>span{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;color:var(--text-2);text-decoration:none;font-size:13px}
.menu li a:hover{background:var(--surface-2);color:var(--text)}
.menu li a[aria-current="page"]{background:var(--surface-2);color:var(--text);font-weight:600}
.menu li>span[aria-disabled="true"]{color:var(--text-4);cursor:not-allowed}
.ponto{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
.conteudo{padding:28px 24px 48px;min-width:0}
.miolo{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.cab{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end;justify-content:space-between}
h1{font-size:30px;font-weight:700;margin:0;line-height:1.2}
.sub{margin:4px 0 0;color:var(--text-3);font-size:13px}
.periodos{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:3px}
.periodos button,.abas button,.acao,.link-btn{font:inherit;cursor:pointer}
.periodos button{background:none;border:0;color:var(--text-2);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;min-height:32px}
.periodos button[aria-pressed="true"]{background:var(--surface-2);color:var(--text)}
.abas{display:flex;gap:4px;border-bottom:1px solid var(--border);overflow-x:auto}
.abas button{background:none;border:0;border-bottom:2px solid transparent;color:var(--text-3);padding:10px 12px;font-size:13px;font-weight:600;white-space:nowrap}
.abas button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--accent)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;min-width:0}
.card h3{font-size:16px;font-weight:600;margin:0}
.card .card-sub{color:var(--text-3);font-size:13px;margin:2px 0 14px}
.status{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px 18px;font-size:13px;color:var(--text-2)}
.bola{width:9px;height:9px;border-radius:50%;flex:none}
.link-btn{background:none;border:0;color:var(--accent);padding:0;font-size:13px;font-weight:600;margin-left:auto}
.link-btn:hover{color:var(--accent-hover)}
.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.kpi-rotulo{font-size:12px;color:var(--text-4);font-weight:500}
.kpi-valor{font-size:30px;font-weight:700;line-height:1.2;margin:6px 0 2px}
.kpi-apoio{font-size:12px;color:var(--text-3)}
.duas{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:12px}
.duas.iguais{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.grafico{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px}
.eixo{display:flex;flex-direction:column;justify-content:space-between;height:180px;font-size:11px;color:var(--text-4);text-align:right}
.plot{position:relative;height:180px;border-bottom:1px solid var(--border-2)}
.linha-grade{position:absolute;left:0;right:0;border-top:1px dashed var(--border-2)}
.colunas{position:absolute;inset:0;display:grid;gap:4px;align-items:end}
.col{position:relative;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch}
.pilha{display:flex;flex-direction:column-reverse;border-radius:4px 4px 0 0;overflow:hidden;min-height:0}
.pilha>i{display:block;width:100%;flex:none}
.tot{font-size:11px;color:var(--text-2);text-align:center;margin-bottom:3px}
.rotulos{display:grid;gap:4px;margin-top:6px;font-size:11px;color:var(--text-4);text-align:center}
.legenda{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12px;color:var(--text-2)}
.quad{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:-1px}
.funil-item{margin-bottom:14px}
.funil-topo{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--text-2);margin-bottom:5px}
.funil-topo b{color:var(--text);font-weight:600}
.trilho{height:10px;background:var(--track);border-radius:999px;overflow:hidden;display:flex}
.trilho>i{display:block;height:100%}
.minis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}
.mini{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.mini span{display:block;font-size:12px;color:var(--text-4)}
.mini b{font-size:18px;font-weight:700}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;white-space:nowrap}
.b-critico{color:var(--crit);background:var(--crit-bg)}.b-alto{color:var(--crit);background:var(--crit-bg)}
.b-atencao{color:var(--warn);background:var(--warn-bg)}.b-aviso,.b-info{color:var(--info);background:var(--info-bg)}.b-ok{color:var(--ok);background:var(--ok-bg)}
.alertas{list-style:none;margin:0;padding:0}
.alerta{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 12px;align-items:start;padding:12px 0;border-top:1px solid var(--border)}
.alerta:first-child{border-top:0;padding-top:0}
.alerta-titulo{font-weight:600}
.alerta>.badge{justify-self:start}
.alerta-detalhe{color:var(--text-3);font-size:13px}
.acao{background:var(--surface-2);border:1px solid var(--border-2);color:var(--text);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;white-space:nowrap}
.acao:hover{border-color:var(--accent);color:var(--accent-hover)}
.rolagem{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}
th{color:var(--text-4);font-weight:500;font-size:12px}
th:first-child,td:first-child{text-align:left}
tbody th{text-align:left;font-weight:600;color:var(--text);font-size:13px}
.spark{display:inline-flex;align-items:flex-end;gap:2px;height:22px;vertical-align:middle}
.spark i{display:block;width:5px;background:var(--text-4);border-radius:1px;min-height:1px}
.spark i.ult{background:var(--accent)}
.pct{color:var(--text-4);font-size:12px;margin-left:4px}
.warn{color:var(--warn)}.crit{color:var(--crit)}
.rodape{color:var(--text-4);font-size:12px;margin:10px 0 0}
.cards4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.gcard-topo{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.gcard-nome{font-weight:600}.gcard-fontes{font-size:12px;color:var(--text-4)}
.gcard-total{font-size:30px;font-weight:700;margin:8px 0 10px}
.lista-dl{display:grid;grid-template-columns:1fr auto;gap:4px 10px;margin:0;font-size:13px}
.lista-dl dt{color:var(--text-3)}.lista-dl dd{margin:0;text-align:right}
.fonte{padding:10px 0;border-top:1px solid var(--border)}
.fonte:first-child{border-top:0;padding-top:0}
.fonte-nome{display:flex;justify-content:space-between;gap:10px;font-weight:600;font-size:13px}
.fonte-num{font-size:12px;color:var(--text-3);margin:2px 0 6px}
.fonte-recusas{font-size:12px;color:var(--text-4);margin-top:6px}
.pilula{display:inline-flex;border:1px solid var(--border-2);border-radius:999px;padding:1px 8px;font-size:12px;color:var(--text-2);white-space:nowrap}
.cats{list-style:none;margin:0;padding:0}
.cats li{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);font-size:13px}
.cats li:first-child{border-top:0}
.monet{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.vazio{color:var(--text-3);font-size:13px;padding:6px 0}
.notas{color:var(--text-4);font-size:12px;padding-left:18px;margin:6px 0 0}
.esqueleto{background:var(--surface);border:1px solid var(--border);border-radius:14px;height:120px;animation:pisca 1.2s ease-in-out infinite alternate}
@keyframes pisca{from{opacity:.55}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.esqueleto{animation:none}}
@media (max-width:1100px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.cards4,.monet{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){.app{grid-template-columns:minmax(0,1fr)}.menu{border-right:0;border-bottom:1px solid var(--border);padding:16px}.menu nav{display:flex;flex-wrap:wrap;gap:4px 16px}.menu nav>div{min-width:140px}.conteudo{padding:20px 16px 40px}.duas,.duas.iguais{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.kpis,.cards4,.monet{grid-template-columns:minmax(0,1fr)}.alerta{grid-template-columns:minmax(0,1fr)}h1{font-size:24px}}
`;

// O navegador desenha tudo a partir de DADOS (texto vindo das ofertas sempre escapado). Sem barras invertidas aqui.
const JS = `
const D = JSON.parse(document.getElementById('dados').textContent);
const A = D.analytics || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const pc = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const COR_NIVEL = { critico: 'var(--crit)', alto: 'var(--crit)', atencao: 'var(--warn)', aviso: 'var(--info)', info: 'var(--info)', ok: 'var(--ok)' };
const vazio = (t) => '<p class="vazio">' + esc(t || 'Sem dados no período.') + '</p>';
const badge = (nivel, rotulo) => '<span class="badge b-' + esc(nivel) + '">' + esc(rotulo) + '</span>';
const ABAS = ['resumo', 'grupos', 'fontes', 'categorias'];
const url = new URLSearchParams(location.search);
let periodo = A[url.get('periodo')] ? url.get('periodo') : (A['7d'] ? '7d' : Object.keys(A)[0]);
let aba = ABAS.includes(url.get('aba')) ? url.get('aba') : 'resumo';

function guardarUrl() {
  const u = new URL(location.href);
  u.searchParams.set('periodo', periodo);
  u.searchParams.set('aba', aba);
  try { history.replaceState(null, '', u); } catch {}
}

function cabecalho(P) {
  $('#sub').textContent = (P.inicio === P.fim ? P.inicio : P.inicio + ' a ' + P.fim) + ' · ' + P.nGrupos + ' grupos · atualizado ' + D.hora;
  document.querySelectorAll('.periodos button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === periodo)));
  document.querySelectorAll('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
  document.querySelectorAll('.menu [data-aba]').forEach((a) => (a.dataset.aba === aba ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

function faixaStatus(P) {
  const al = P.alertas.filter((a) => a.nivel !== 'aviso' && a.nivel !== 'info');
  if (!al.length) return '<div class="status"><span class="bola" style="background:var(--ok)"></span><span><b>Tudo certo</b> · nenhum ponto de atenção</span></div>';
  const grupos = new Set(al.map((a) => a.grupo).filter(Boolean));
  const resumo = al.slice(0, 2).map((a) => esc(a.titulo)).join(' · ');
  return '<div class="status"><span class="bola" style="background:' + COR_NIVEL[al[0].nivel] + '"></span><span><b>Atenção em ' + grupos.size + (grupos.size === 1 ? ' grupo' : ' grupos') + '</b> · ' + resumo + '</span>' +
    '<button type="button" class="link-btn" data-ir="atencao">Ver pontos de atenção →</button></div>';
}

function kpis(P) {
  const k = P.kpis;
  const card = (rot, val, apoio) => '<div class="card"><div class="kpi-rotulo">' + esc(rot) + '</div><div class="kpi-valor">' + val + '</div><div class="kpi-apoio">' + apoio + '</div></div>';
  const faixa = k.precoMin && k.precoMax ? 'de ' + brl(k.precoMin.valor) + ' (' + esc(k.precoMin.grupo) + ') a ' + brl(k.precoMax.valor) + ' (' + esc(k.precoMax.grupo) + ')' : 'sem dados no período';
  return '<div class="kpis">' +
    card('Ofertas publicadas', n(k.publicadas), k.mediaDia == null ? 'sem dados no período' : 'média de ' + n(k.mediaDia) + ' por dia' + (P.periodo === 'hoje' ? '' : ' (' + k.diasComDado + (k.diasComDado === 1 ? ' dia' : ' dias') + ' com dados)')) +
    card('Aproveitamento da fila', pc(k.aproveitamento), k.naFila ? n(k.publicadas) + ' de ' + n(k.naFila) + ' que entraram' : 'nada entrou na fila') +
    card('Desconto médio', pc(k.descontoMedio), k.descontoMedio == null ? 'sem dados no período' : 'ponderado pelo volume') +
    card('Preço médio', brl(k.precoMedio), faixa) +
    card('Cliques Awin', k.awin ? n(k.awin.cliques) : '—', k.awin ? brl(k.awin.aprovado) + ' aprovado' : 'sem leitura da Awin no período') +
    '</div>';
}

function grafico(P) {
  const s = P.serie;
  const max = Math.max(0, ...s.totais);
  const titulo = 'Publicações por ' + (s.tipo === 'hora' ? 'hora' : 'dia');
  if (!max) return '<section class="card"><h3>' + titulo + '</h3><p class="card-sub">sem publicações no período</p>' + vazio() + '</section>';
  const topo = Math.max(2, Math.ceil(max / 2) * 2); // eixo com 3 marcas: 0, metade e topo
  const N = s.rotulos.length;
  const passo = N <= 14 ? 1 : Math.ceil(N / 8);
  const grade = 'grid-template-columns:repeat(' + N + ',minmax(0,1fr))';
  let cols = '';
  let rots = '';
  s.rotulos.forEach((r, i) => {
    const t = s.totais[i];
    let seg = '';
    for (const g of s.grupos) {
      const v = s.valores[g][i];
      if (v) seg += '<i style="height:' + (v / t) * 100 + '%;background:' + esc(P.grupos.find((x) => x.nome === g)?.cor || '#827c78') + '"></i>';
    }
    const dica = r + ': ' + n(t) + (t === 1 ? ' publicação' : ' publicações') + (t ? ' (' + s.grupos.filter((g) => s.valores[g][i]).map((g) => g + ' ' + s.valores[g][i]).join(', ') + ')' : '');
    cols += '<div class="col" title="' + esc(dica) + '">' + (t && N <= 14 ? '<span class="tot">' + n(t) + '</span>' : '') +
      '<div class="pilha" style="height:' + (t / topo) * 100 + '%">' + seg + '</div></div>';
    rots += '<span>' + (i % passo === 0 ? esc(r) : '') + '</span>';
  });
  const legenda = s.grupos.filter((g) => s.valores[g].some(Boolean)).map((g) => '<span><span class="quad" style="background:' + esc(P.grupos.find((x) => x.nome === g)?.cor) + '"></span>' + esc(g) + '</span>').join('');
  return '<section class="card" aria-label="' + titulo + '"><h3>' + titulo + '</h3><p class="card-sub">' + (s.pico ? 'pico em ' + esc(s.pico.rotulo) + ' com ' + n(s.pico.total) : '') + '</p>' +
    '<div class="grafico"><div class="eixo" aria-hidden="true"><span>' + n(topo) + '</span><span>' + n(topo / 2) + '</span><span>0</span></div><div>' +
    '<div class="plot" role="img" aria-label="' + esc(titulo + ', pico de ' + n(max)) + '"><div class="linha-grade" style="top:0"></div><div class="linha-grade" style="top:50%"></div>' +
    '<div class="colunas" style="' + grade + '">' + cols + '</div></div><div class="rotulos" style="' + grade + '" aria-hidden="true">' + rots + '</div></div></div>' +
    '<div class="legenda">' + legenda + '</div></section>';
}

function funil(P) {
  const f = P.funil;
  const barra = (rot, val, extra, larg) => '<div class="funil-item"><div class="funil-topo"><span>' + rot + '</span><span><b>' + n(val) + '</b>' + (extra ? ' <span class="pct">' + extra + '</span>' : '') + '</span></div>' +
    '<div class="trilho" role="presentation"><i style="width:' + Math.max(val ? 1.5 : 0, larg) + '%;background:var(--accent)"></i></div></div>';
  if (!f.avaliadas && !f.publicadas) return '<section class="card"><h3>Funil de ofertas</h3><p class="card-sub">da busca até o grupo</p>' + vazio() + '</section>';
  const base = f.avaliadas || 1;
  const mini = (rot, val, cls) => '<div class="mini"><span>' + rot + '</span><b class="' + (cls || '') + '">' + n(val) + '</b></div>';
  return '<section class="card"><h3>Funil de ofertas</h3><p class="card-sub">da busca até o grupo</p>' +
    barra('Avaliadas na busca', f.avaliadas, '', 100) +
    barra('Entraram na fila', f.naFila, pc(f.pctFila) + ' das avaliadas', (f.naFila / base) * 100) +
    barra('Publicadas', f.publicadas, pc(f.pctPublicadas) + ' da fila', (f.publicadas / base) * 100) +
    '<div class="minis">' + mini('Barradas ao postar', f.barradas) + mini('Repetidas (não saíram)', f.duplicados) + mini('Envio sem confirmação', f.incertos, f.incertos > 0 ? 'warn' : '') + mini('Falhas de envio', f.erros, f.erros > 0 ? 'crit' : '') + '</div></section>';
}

function atencao(P) {
  const lista = P.alertas.map((a) => '<li class="alerta">' + badge(a.nivel, a.rotuloNivel) + '<div><div class="alerta-titulo">' + esc(a.titulo) + '</div><div class="alerta-detalhe">' + esc(a.detalhe) + '</div></div>' +
    '<button type="button" class="acao" data-aba-ir="' + esc(a.acao.aba) + '">' + esc(a.acao.rotulo) + '</button></li>').join('');
  return '<section class="card" id="atencao"><h3>Pontos de atenção</h3><p class="card-sub">' + (P.alertas.length ? 'do mais grave para o mais leve' : 'nenhum no período') + '</p>' + (lista ? '<ul class="alertas">' + lista + '</ul>' : vazio('Tudo certo neste período.')) + '</section>';
}

function spark(serie) {
  const max = Math.max(1, ...serie);
  return '<span class="spark" aria-hidden="true">' + serie.map((v, i) => '<i class="' + (i === serie.length - 1 ? 'ult' : '') + '" style="height:' + Math.max(4, (v / max) * 100) + '%"></i>').join('') + '</span>';
}

function tabela(P) {
  if (!P.grupos.length) return '<section class="card"><h3>Comparativo por grupo</h3>' + vazio() + '</section>';
  const linhas = P.grupos.map((g) => '<tr><th scope="row"><span class="quad" style="background:' + esc(g.cor) + '"></span>' + esc(g.nome) + '</th>' +
    '<td>' + spark(g.sparkline) + '</td><td>' + n(g.publicadas) + '<span class="pct">' + pc(g.pctTotal) + '</span></td><td>' + pc(g.aprovFila) + '</td><td>' + pc(g.desconto) + '</td><td>' + brl(g.preco) + '</td>' +
    '<td>' + pc(g.cupom) + '</td><td>' + pc(g.frete) + '</td><td>' + pc(g.full) + '</td><td class="' + (g.filaVaziaAlta ? 'warn' : '') + '">' + n(g.filaVazia) + '</td><td class="' + (g.sobraAlta ? 'crit' : '') + '">' + n(g.sobra) + '</td>' +
    '<td>' + badge(g.status.nivel, g.status.rotulo) + '</td></tr>').join('');
  return '<section class="card"><h3>Comparativo por grupo</h3><p class="card-sub">' + esc(P.inicio === P.fim ? P.inicio : P.inicio + ' a ' + P.fim) + '</p><div class="rolagem"><table><thead><tr>' +
    ['Grupo', 'Por dia', 'Publicadas', 'Aprov. fila', 'Desconto', 'Preço médio', 'Cupom', 'Frete grátis', 'FULL', 'Fila vazia', 'Sobra', 'Status'].map((h) => '<th scope="col">' + h + '</th>').join('') +
    '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
    '<p class="rodape">Aprov. fila = publicadas ÷ entraram na fila. Fila vazia = horários de envio sem nenhuma oferta para postar. Sobra = ofertas que ficaram na fila no fim do último dia.</p></section>';
}

function cards(P) {
  return '<div class="cards4">' + P.grupos.map((g) => {
    const dl = [['Recusadas na busca', n(g.recusadas)], ['Entraram na fila', n(g.naFila)], ['Barradas ao postar', n(g.barradas)], ['Repetidas', n(g.duplicados)], ['Envio sem confirmação', n(g.incertos)], ['Membros reais', g.membrosReais == null ? '—' : n(g.membrosReais)]];
    return '<section class="card"><div class="gcard-topo"><div><div class="gcard-nome">' + esc(g.nome) + '</div><div class="gcard-fontes">' + n(g.fontes) + (g.fontes === 1 ? ' fonte' : ' fontes') + '</div></div>' + badge(g.status.nivel, g.status.rotulo) + '</div>' +
      '<div class="gcard-total">' + n(g.publicadas) + '</div><dl class="lista-dl">' + dl.map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('') + '</dl></section>';
  }).join('') + '</div>';
}

function fontes(P, todas) {
  const lista = todas ? P.fontes : P.fontes.slice(0, 10);
  const itens = lista.map((f) => {
    const canal = f.tipo === 'canal';
    const t = f.total || 1;
    const meio = Math.max(0, f.meio - f.fim);
    const recusas = f.motivos.slice(0, 4).map(([m, v]) => esc(m) + ' ' + n(v)).join(' · ');
    return '<div class="fonte"><div class="fonte-nome"><span>' + esc(f.nome) + '</span><span class="pilula">' + (canal ? 'canal' : 'busca') + '</span></div>' +
      '<div class="fonte-num">' + n(f.total) + (canal ? ' lidas → ' : ' avaliadas → ') + n(f.meio) + (canal ? ' com link → ' : ' na fila → ') + '<b>' + n(f.fim) + (canal ? ' aceitas' : ' publicadas') + '</b> (' + pc(f.taxa) + ')</div>' +
      '<div class="trilho" role="presentation"><i style="width:' + (f.fim / t) * 100 + '%;background:var(--accent)"></i><i style="width:' + (meio / t) * 100 + '%;background:var(--recusa)"></i></div>' +
      (recusas ? '<div class="fonte-recusas">Recusas: ' + recusas + '</div>' : '') + '</div>';
  }).join('');
  const mais = !todas && P.fontes.length > 10 ? '<p><button type="button" class="link-btn" data-aba-ir="fontes">Ver todas as ' + n(P.fontes.length) + ' fontes →</button></p>' : '';
  return '<section class="card"><h3>Funil das fontes</h3><p class="card-sub">ordenado pelas que mais trazem ofertas</p>' + (itens || vazio()) + mais + '</section>';
}

function categoriasSem(P) {
  const l = P.categoriasSemPublicacao.map((c) => '<li><span>' + esc(c.nome) + '</span><span class="pilula">' + esc(c.loja) + '</span></li>').join('');
  return '<section class="card"><h3>Categorias sem publicação</h3><p class="card-sub">buscas ligadas que não publicaram no período</p>' + (l ? '<ul class="cats">' + l + '</ul>' : vazio(P.periodo === 'hoje' ? 'Veja em 7 ou 30 dias.' : 'Todas as categorias publicaram no período.')) + '</section>';
}

function categoriasTabela(P) {
  if (!P.categorias.length) return '<section class="card"><h3>Categorias</h3>' + vazio() + '</section>';
  const linhas = P.categorias.map((c) => '<tr><th scope="row">' + esc(c.nome) + '</th><td><span class="pilula">' + esc(c.loja) + '</span></td><td>' + n(c.encontrados) + '</td><td>' + n(c.aceitos) + '</td><td class="' + (c.publicadas ? '' : 'warn') + '">' + n(c.publicadas) + '</td></tr>').join('');
  return '<section class="card"><h3>Categorias de busca</h3><p class="card-sub">vistas na busca → aprovadas nos filtros → publicadas</p><div class="rolagem"><table><thead><tr>' +
    ['Categoria', 'Loja', 'Vistas', 'Aprovadas', 'Publicadas'].map((h) => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div></section>';
}

function monetizacao(P) {
  const m = P.monetizacao;
  const card = (rot, val, extra) => '<div class="card"><div class="kpi-rotulo">' + rot + '</div><div class="kpi-valor" style="font-size:22px">' + val + '</div>' + (extra || '') + '</div>';
  return '<section aria-label="Monetização"><h3 style="font-size:16px;margin:8px 0 10px">Monetização</h3><div class="monet">' +
    card('Awin pendente', brl(m.awinPendente)) + card('Awin aprovado', brl(m.awinAprovado)) + card('Cliques nos links Awin', n(m.cliques)) +
    card('Mercado Livre', '—', m.painelML ? '<a class="kpi-apoio" href="' + esc(m.painelML) + '" target="_blank" rel="noopener">Ver no painel do Mercado Livre →</a>' : '') + '</div></section>';
}

function desenhar() {
  const P = A[periodo];
  guardarUrl();
  if (!P) return ($('#conteudo').innerHTML = vazio('Ainda não há dados.'));
  cabecalho(P);
  let html = '';
  if (aba === 'resumo') {
    html = faixaStatus(P) + kpis(P) + '<div class="duas">' + grafico(P) + funil(P) + '</div>' + atencao(P) + tabela(P) + cards(P) +
      '<div class="duas iguais">' + fontes(P, false) + categoriasSem(P) + '</div>' + monetizacao(P);
  } else if (aba === 'grupos') html = tabela(P) + cards(P);
  else if (aba === 'fontes') html = fontes(P, true);
  else html = categoriasTabela(P) + categoriasSem(P);
  $('#conteudo').innerHTML = html;
}

document.addEventListener('click', (e) => {
  const p = e.target.closest('.periodos button');
  if (p) { periodo = p.dataset.p; return desenhar(); }
  const t = e.target.closest('[data-aba]');
  if (t) { e.preventDefault(); aba = t.dataset.aba; desenhar(); return window.scrollTo({ top: 0 }); }
  const ir = e.target.closest('[data-aba-ir]');
  if (ir) { aba = ir.dataset.abaIr; desenhar(); return window.scrollTo({ top: 0 }); }
  const sec = e.target.closest('[data-ir]');
  if (sec) document.getElementById(sec.dataset.ir)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.querySelector('.abas').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = ABAS.indexOf(aba) + (e.key === 'ArrowRight' ? 1 : -1);
  aba = ABAS[(i + ABAS.length) % ABAS.length];
  desenhar();
  document.querySelector('.abas [data-aba="' + aba + '"]').focus();
});
$('#busca').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.menu li').forEach((li) => { li.hidden = q && !li.textContent.toLowerCase().includes(q); });
});
$('#busca').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const alvo = [...document.querySelectorAll('.menu li:not([hidden]) [data-aba]')][0];
  if (alvo) alvo.click();
});
desenhar();
`;

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NOMES = { hoje: 'Hoje', '7d': '7 dias', '30d': '30 dias' };

const MENU = [
  ['PAINEL', [['Visão geral', null], ['Centro de operações', null]]],
  ['DESEMPENHO', [['Analytics de produtos', 'resumo'], ['Grupos', 'grupos'], ['Fontes', 'fontes'], ['Categorias', 'categorias']]],
  ['OPERAÇÃO', [['Mapeamento de fontes', null], ['Regras e filtros', null], ['Números WhatsApp', null]]],
];

function menuHtml() {
  return MENU.map(([secao, itens]) => `<div><h2>${secao}</h2><ul>${itens
    .map(([rot, aba]) =>
      aba
        ? `<li><a href="?aba=${aba}" data-aba="${aba}">${aba === 'resumo' ? '<span class="ponto" aria-hidden="true"></span>' : ''}${escHtml(rot)}</a></li>`
        : `<li><span aria-disabled="true" title="Ainda sem tela">${escHtml(rot)}</span></li>`
    )
    .join('')}</ul></div>`).join('');
}

/** O HTML completo, com os dados embutidos. */
export function htmlDoPainel(painel) {
  const json = JSON.stringify(painel).replace(/</g, '\\u003c');
  const periodos = Object.keys(painel.analytics || painel.periodos || {}).map((p) => `<button type="button" data-p="${escHtml(p)}" aria-pressed="false">${escHtml(NOMES[p] || p)}</button>`).join('');
  const abas = [['resumo', 'Resumo'], ['grupos', 'Grupos'], ['fontes', 'Fontes'], ['categorias', 'Categorias']]
    .map(([k, r]) => `<button type="button" role="tab" data-aba="${k}" aria-selected="false" aria-controls="conteudo">${r}</button>`)
    .join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Analytics de produtos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="app">
<aside class="menu">
<div><div class="marca-nome">Achadinhos da Vic<span class="estrela" aria-hidden="true">✦</span></div><div class="marca-sub">Painel dos grupos</div></div>
<label class="busca"><span class="sr">Buscar no menu</span><input id="busca" type="search" placeholder="Buscar ou ir para…" autocomplete="off"></label>
<nav aria-label="Menu do painel">${menuHtml()}</nav>
</aside>
<main class="conteudo">
<div class="miolo">
<div class="cab"><div><h1>Analytics de produtos</h1><p class="sub" id="sub">Carregando…</p></div><div class="periodos" role="group" aria-label="Período">${periodos}</div></div>
<div class="abas" role="tablist" aria-label="Seções">${abas}</div>
<div id="conteudo" role="tabpanel" style="display:flex;flex-direction:column;gap:12px"><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div></div>
<footer><ul class="notas">${(painel.notasAnalytics || NOTAS_PAINEL).map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul></footer>
</div>
</main>
</div>
<script type="application/json" id="dados">${json}</script>
<script>${JS}</script>
</body>
</html>
`;
}

export const NOTAS_PAINEL = [
  'Membros reais excluem você e o bot.',
  'Visualizações por post não aparecem: os canais são privados, e o Telegram só mostra isso em canal público.',
  'Recusadas na busca = ofertas que não passaram nos filtros do grupo (nicho, marca, vendas, desconto…) e nem entraram na fila.',
  'Barradas ao postar = estavam na fila e não saíram (link, vendas, nicho ou marca conferidos de novo). As repetidas aparecem à parte.',
];

/**
 * Grava a pasta do site (index.html, dados.json, _headers, robots.txt) e devolve o hash do conteúdo —
 * para a publicação pular quando nada mudou. A hora de "atualizado" fica fora do hash.
 */
export function gravarSite(painel, base = PASTA_ANALYTICS) {
  const pasta = pastaSite(base);
  fs.mkdirSync(pasta, { recursive: true });
  const arquivos = {
    'index.html': htmlDoPainel(painel),
    'dados.json': JSON.stringify(painel),
    _headers: '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n',
    'robots.txt': 'User-agent: *\nDisallow: /\n',
  };
  for (const [nome, conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(pasta, nome), conteudo);
  fs.writeFileSync(path.join(base, 'relatorio.html'), arquivos['index.html']); // cópia local (4-relatorio.bat)
  const semHora = JSON.stringify({ ...painel, atualizadoEm: null, hora: null });
  return crypto.createHash('sha256').update(semHora).digest('hex').slice(0, 16);
}
