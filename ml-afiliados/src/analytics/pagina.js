/**
 * Analytics de produtos — a página do painel (um arquivo só; gráficos em HTML/CSS; tema escuro com o rosa da marca).
 * Todos os números vêm de painel.analytics (src/analytics/produtos.js) e do resto do painel (relatorio.js): a página
 * só desenha. Os dados vão embutidos (abre com dois cliques, sem servidor) e também em dados.json ao lado.
 * Os cliques dos links dos posts são lidos na hora de /api/cliques (o porteiro do painel online); no arquivo do PC
 * eles não aparecem. Período e aba ficam na URL (?periodo=7d&aba=produtos).
 *
 * Abas (03/11/2026, pedido do dono: "o mais útil, sem encher de informação"; quem mais olha é a prima dele):
 * Visão geral, Produtos (ranking de cliques), Ganhos (todas as plataformas), Grupos, Fontes (com o mapa fonte ×
 * grupo), Categorias, Centro de operações, Regras e filtros, WhatsApp.
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
.busca{position:relative;display:block}
.busca svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--text-4);pointer-events:none}
.busca input{width:100%;background:var(--surface);border:1px solid var(--border-2);border-radius:10px;color:var(--text);padding:8px 10px 8px 32px;font:inherit}
.busca input::placeholder{color:var(--text-4)}
.menu h2{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--text-4);margin:10px 8px 4px}
.menu ul{list-style:none;margin:0;padding:0}
.menu li>a{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;color:var(--text-2);text-decoration:none;font-size:13px}
.menu li a:hover{background:var(--surface-2);color:var(--text)}
.menu li a[aria-current="page"]{background:var(--surface-2);color:var(--text);font-weight:600}
.menu li a[aria-current="page"]::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
.conteudo{padding:28px 24px 48px;min-width:0}
.miolo{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.cab{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end;justify-content:space-between}
h1{font-size:30px;font-weight:700;margin:0;line-height:1.2}
.sub{margin:4px 0 0;color:var(--text-3);font-size:13px}
.periodos{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:3px}
.periodos[hidden]{display:none}
.periodos button,.acao,.link-btn,.chip{font:inherit;cursor:pointer}
.periodos button{background:none;border:0;color:var(--text-2);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;min-height:32px}
.periodos button[aria-pressed="true"]{background:var(--surface-2);color:var(--text)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;min-width:0}
.card h3{font-size:16px;font-weight:600;margin:0}
.card .card-sub{color:var(--text-3);font-size:13px;margin:2px 0 14px}
.status{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px 18px;font-size:13px;color:var(--text-2)}
.bola{width:9px;height:9px;border-radius:50%;flex:none;display:inline-block}
.link-btn{background:none;border:0;color:var(--accent);padding:0;font-size:13px;font-weight:600}
.status .link-btn{margin-left:auto}
.link-btn:hover{color:var(--accent-hover)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.kpi-rotulo{font-size:12px;color:var(--text-4);font-weight:500}
.kpi-valor{font-size:28px;font-weight:700;line-height:1.2;margin:6px 0 2px}
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
th:first-child,td:first-child,th.esq{text-align:left}
tbody th{text-align:left;font-weight:600;color:var(--text);font-size:13px}
td.nome{text-align:left;white-space:normal;min-width:220px;color:var(--text)}
td.pos{color:var(--text-4);width:28px}
.spark{display:inline-flex;align-items:flex-end;gap:2px;height:22px;vertical-align:middle}
.spark i{display:block;width:5px;background:var(--text-4);border-radius:1px;min-height:1px}
.spark i.ult{background:var(--accent)}
.pct{color:var(--text-4);font-size:12px;margin-left:4px}
.warn{color:var(--warn)}.crit{color:var(--crit)}.ok{color:var(--ok)}
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
.barras{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.barras li .funil-topo{margin-bottom:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{background:var(--surface);border:1px solid var(--border-2);color:var(--text-2);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600}
.chip[aria-pressed="true"]{border-color:var(--accent);color:var(--text);background:var(--surface-2)}
.filtro{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:var(--text-3)}
.aviso-box{background:var(--info-bg);color:var(--info);border-radius:10px;padding:10px 14px;font-size:13px}
details{border-top:1px solid var(--border);padding:8px 0}
details:first-of-type{border-top:0}
summary{cursor:pointer;font-weight:600;font-size:13px}
.marcas{color:var(--text-3);font-size:13px;margin:6px 0 0}
.regras-lista{margin:0;padding-left:18px;color:var(--text-2);font-size:13px;display:flex;flex-direction:column;gap:6px}
.vazio{color:var(--text-3);font-size:13px;padding:6px 0}
.notas{color:var(--text-4);font-size:12px;padding-left:18px;margin:6px 0 0}
.esqueleto{background:var(--surface);border:1px solid var(--border);border-radius:14px;height:120px;animation:pisca 1.2s ease-in-out infinite alternate}
@keyframes pisca{from{opacity:.55}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.esqueleto{animation:none}}
@media (max-width:1100px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cards4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){.app{grid-template-columns:minmax(0,1fr)}.menu{border-right:0;border-bottom:1px solid var(--border);padding:16px}.menu nav{display:flex;flex-wrap:wrap;gap:4px 16px}.menu nav>div{min-width:140px}.conteudo{padding:20px 16px 40px}.duas,.duas.iguais{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.kpis,.cards4{grid-template-columns:minmax(0,1fr)}.alerta{grid-template-columns:minmax(0,1fr)}h1{font-size:24px}}
`;

// O navegador desenha tudo a partir de DADOS (texto vindo das ofertas sempre escapado). Sem barras invertidas aqui
// e sem crase/cifrão-chave: este código vai dentro de um texto do Node.
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
const card = (titulo, sub, corpo, id) => '<section class="card"' + (id ? ' id="' + id + '"' : '') + '><h3>' + titulo + '</h3>' + (sub ? '<p class="card-sub">' + sub + '</p>' : '') + corpo + '</section>';
const kpi = (rot, val, apoio) => '<div class="card"><div class="kpi-rotulo">' + esc(rot) + '</div><div class="kpi-valor">' + val + '</div><div class="kpi-apoio">' + (apoio || '') + '</div></div>';
const LOJA = { m: 'Mercado Livre', s: 'Shopee', a: 'Awin' };
const NOME_LOJA = { ml: 'Mercado Livre', shopee: 'Shopee', awin: 'Awin', amazon: 'Amazon' };
const TITULOS = { resumo: 'Visão geral', produtos: 'Produtos', ganhos: 'Ganhos', grupos: 'Grupos', fontes: 'Fontes', categorias: 'Categorias', operacao: 'Centro de operações', regras: 'Regras e filtros', whatsapp: 'WhatsApp' };
const ABAS = Object.keys(TITULOS);
const SEM_PERIODO = ['operacao', 'regras'];
const url = new URLSearchParams(location.search);
let periodo = A[url.get('periodo')] ? url.get('periodo') : (A['7d'] ? '7d' : Object.keys(A)[0]);
let aba = ABAS.includes(url.get('aba')) ? url.get('aba') : 'resumo';
let filtroProduto = url.get('busca') || '';
let grupoProduto = '';
let todosProdutos = false;

// Cliques dos posts: lidos na hora do painel online (o arquivo do PC não tem como ler).
const CL = { estado: location.protocol.indexOf('http') === 0 ? 'carregando' : 'off', linhas: [] };
function lerCliques() {
  if (CL.estado === 'off') return;
  const dias = (D.periodos && D.periodos['30d'] && D.periodos['30d'].dias) || [];
  fetch('api/cliques?desde=' + encodeURIComponent(dias[0] || ''), { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j) => { CL.linhas = j.linhas || []; CL.estado = 'ok'; })
    .catch(() => { CL.estado = 'erro'; })
    .then(desenhar);
}

function guardarUrl() {
  const u = new URL(location.href);
  u.searchParams.set('periodo', periodo);
  u.searchParams.set('aba', aba);
  if (filtroProduto) u.searchParams.set('busca', filtroProduto); else u.searchParams.delete('busca');
  try { history.replaceState(null, '', u); } catch {}
}

function cabecalho(P) {
  $('#titulo').textContent = TITULOS[aba];
  document.title = TITULOS[aba] + ' · Painel da Vic';
  $('#sub').textContent = SEM_PERIODO.includes(aba) ? 'agora · atualizado ' + D.hora : (P.inicio === P.fim ? P.inicio : P.inicio + ' a ' + P.fim) + ' · atualizado ' + D.hora;
  $('.periodos').hidden = SEM_PERIODO.includes(aba);
  document.querySelectorAll('.periodos button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === periodo)));
  document.querySelectorAll('.menu [data-aba]').forEach((a) => (a.dataset.aba === aba ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

// ---------- cliques ----------
function cliquesDoPeriodo() {
  const dias = new Set((D.periodos && D.periodos[periodo] && D.periodos[periodo].dias) || []);
  const info = {};
  for (const p of D.produtos || []) info[p.g + '|' + p.c] = p;
  const r = { total: 0, tg: 0, wa: 0, porGrupo: {}, porLoja: {}, prods: {}, postados: 0 };
  for (const p of D.produtos || []) if (dias.has(p.dia)) r.postados++;
  for (const [dia, caminho, qtd] of CL.linhas) {
    if (!dias.has(dia)) continue;
    const canal = caminho.charAt(0);
    const grupo = (D.letras || {})[caminho.charAt(1)] || 'Outro';
    const cod = caminho.slice(2);
    r.total += qtd;
    if (canal === 'w') r.wa += qtd; else r.tg += qtd;
    r.porGrupo[grupo] = (r.porGrupo[grupo] || 0) + qtd;
    const loja = LOJA[cod.charAt(0)] || 'Outra';
    r.porLoja[loja] = (r.porLoja[loja] || 0) + qtd;
    const p = info[grupo + '|' + cod];
    if (!p) continue;
    const x = r.prods[cod] || (r.prods[cod] = { nome: p.n, loja: NOME_LOJA[p.l] || p.l, preco: p.p, desc: p.d, dia: p.dia, grupos: [], total: 0, tg: 0, wa: 0 });
    if (!x.grupos.includes(grupo)) x.grupos.push(grupo);
    x.total += qtd;
    if (canal === 'w') x.wa += qtd; else x.tg += qtd;
  }
  r.ranking = Object.values(r.prods).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  return r;
}

function avisoCliques() {
  if (CL.estado === 'off') return '<p class="aviso-box">Os cliques aparecem só no painel online (este é o arquivo do PC).</p>';
  if (CL.estado === 'carregando') return '<p class="aviso-box">Carregando os cliques…</p>';
  if (CL.estado === 'erro') return '<p class="aviso-box">Não consegui ler os cliques agora. Recarregue a página em alguns minutos.</p>';
  return '';
}

function barras(mapa, cores) {
  const itens = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  if (!itens.length) return vazio('Nenhum clique no período.');
  const max = Math.max(...itens.map((x) => x[1]));
  return '<ul class="barras">' + itens.map(([k, v]) => '<li><div class="funil-topo"><span>' + esc(k) + '</span><span><b>' + n(v) + '</b></span></div><div class="trilho"><i style="width:' + Math.max(2, (v / max) * 100) + '%;background:' + ((cores && cores[k]) || 'var(--accent)') + '"></i></div></li>').join('') + '</ul>';
}

function tabelaRanking(lista, limite, comCanal) {
  if (!lista.length) return vazio(CL.estado === 'ok' ? 'Nenhum produto clicado no período.' : '');
  const linhas = lista.slice(0, limite).map((x, i) => '<tr><td class="pos">' + (i + 1) + '</td><td class="nome">' + esc(x.nome) + '</td><td><span class="pilula">' + esc(x.loja) + '</span></td><td>' + esc(x.grupos.join(', ')) + '</td><td>' + brl(x.preco) + (x.desc ? '<span class="pct">-' + n(x.desc) + '%</span>' : '') + '</td>' +
    (comCanal ? '<td>' + n(x.tg) + '</td><td>' + n(x.wa) + '</td>' : '') + '<td><b>' + n(x.total) + '</b></td></tr>').join('');
  const cab = ['#', 'Produto', 'Loja', 'Grupo', 'Preço'].concat(comCanal ? ['Telegram', 'WhatsApp'] : []).concat(['Cliques']);
  return '<div class="rolagem"><table><thead><tr>' + cab.map((h) => '<th scope="col"' + (h === 'Produto' ? ' class="esq"' : '') + '>' + h + '</th>').join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
}

function corDosGrupos(P) {
  const c = {};
  for (const g of P.grupos || []) c[g.nome] = g.cor;
  return c;
}

function abaProdutos(P) {
  const C = cliquesDoPeriodo();
  const q = filtroProduto.toLowerCase();
  let lista = C.ranking.filter((x) => (!grupoProduto || x.grupos.includes(grupoProduto)) && (!q || x.nome.toLowerCase().includes(q)));
  const grupos = Object.keys(C.porGrupo).filter((g) => g !== 'Outro').sort();
  const chips = grupos.length > 1 ? '<div class="chips" role="group" aria-label="Grupo"><button type="button" class="chip" data-grupo="" aria-pressed="' + String(!grupoProduto) + '">Todos</button>' + grupos.map((g) => '<button type="button" class="chip" data-grupo="' + esc(g) + '" aria-pressed="' + String(grupoProduto === g) + '">' + esc(g) + '</button>').join('') + '</div>' : '';
  const filtro = q ? '<span>Buscando “' + esc(filtroProduto) + '” · <button type="button" class="link-btn" data-limpar>limpar</button></span>' : '';
  const comClique = Object.keys(C.prods).length;
  const kp = '<div class="kpis">' +
    kpi('Cliques nos links', CL.estado === 'ok' ? n(C.total) : '—', CL.estado === 'ok' ? (C.postados ? 'média de ' + n(Math.round((C.total / C.postados) * 10) / 10) + ' por produto postado' : 'nenhum produto postado com link do site') : '') +
    kpi('No Telegram', CL.estado === 'ok' ? n(C.tg) : '—', CL.estado === 'ok' && C.total ? pc(Math.round((C.tg / C.total) * 1000) / 10) + ' dos cliques' : '') +
    kpi('No WhatsApp', CL.estado === 'ok' ? n(C.wa) : '—', CL.estado === 'ok' && C.total ? pc(Math.round((C.wa / C.total) * 1000) / 10) + ' dos cliques' : '') +
    kpi('Produtos clicados', CL.estado === 'ok' ? n(comClique) : '—', C.postados ? 'de ' + n(C.postados) + ' postados com link do site' : '') + '</div>';
  const limite = todosProdutos ? 500 : 20;
  const mais = lista.length > 20 ? '<p><button type="button" class="link-btn" data-todos>' + (todosProdutos ? 'Mostrar só os 20 primeiros' : 'Ver todos os ' + n(lista.length)) + '</button></p>' : '';
  return avisoCliques() + kp +
    card('Mais clicados', 'quem clicou no link do post (Telegram e WhatsApp)', '<div class="filtro">' + chips + filtro + '</div>' + tabelaRanking(lista, limite, true) + mais) +
    '<div class="duas iguais">' + card('Cliques por grupo', '', barras(C.porGrupo, corDosGrupos(P))) + card('Cliques por loja', 'Amazon fica de fora: o link dela vai direto', barras(C.porLoja)) + '</div>';
}

// ---------- visão geral ----------
function faixaStatus(P) {
  const al = P.alertas.filter((a) => a.nivel !== 'aviso' && a.nivel !== 'info');
  if (!al.length) return '<div class="status"><span class="bola" style="background:var(--ok)"></span><span><b>Tudo certo</b> · nenhum ponto de atenção</span></div>';
  const grupos = new Set(al.map((a) => a.grupo).filter(Boolean));
  const resumo = al.slice(0, 2).map((a) => esc(a.titulo)).join(' · ');
  return '<div class="status"><span class="bola" style="background:' + COR_NIVEL[al[0].nivel] + '"></span><span><b>Atenção em ' + grupos.size + (grupos.size === 1 ? ' grupo' : ' grupos') + '</b> · ' + resumo + '</span>' +
    '<button type="button" class="link-btn" data-ir="atencao">Ver pontos de atenção →</button></div>';
}

function kpisGerais(P) {
  const k = P.kpis;
  const m = P.monetizacao || {};
  const C = cliquesDoPeriodo();
  return '<div class="kpis">' +
    kpi('Ofertas publicadas', n(k.publicadas), k.mediaDia == null ? 'sem dados no período' : 'média de ' + n(k.mediaDia) + ' por dia') +
    kpi('Cliques nos links', CL.estado === 'ok' ? n(C.total) : '—', CL.estado === 'ok' ? n(Object.keys(C.prods).length) + ' produtos clicados' : CL.estado === 'off' ? 'só no painel online' : 'carregando…') +
    kpi('Ganhos aprovados', brl(m.aprovado), m.pendente ? brl(m.pendente) + ' ainda pendente' : 'Awin e Shopee') +
    kpi('Desconto médio', pc(k.descontoMedio), k.precoMedio == null ? '' : 'preço médio ' + brl(k.precoMedio)) +
    '</div>';
}

function grafico(P) {
  const s = P.serie;
  const max = Math.max(0, ...s.totais);
  const titulo = 'Publicações por ' + (s.tipo === 'hora' ? 'hora' : 'dia');
  if (!max) return card(titulo, 'sem publicações no período', vazio());
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
      if (v) seg += '<i style="height:' + (v / t) * 100 + '%;background:' + esc((P.grupos.find((x) => x.nome === g) || {}).cor || '#827c78') + '"></i>';
    }
    const dica = r + ': ' + n(t) + (t === 1 ? ' publicação' : ' publicações') + (t ? ' (' + s.grupos.filter((g) => s.valores[g][i]).map((g) => g + ' ' + s.valores[g][i]).join(', ') + ')' : '');
    cols += '<div class="col" title="' + esc(dica) + '">' + (t && N <= 14 ? '<span class="tot">' + n(t) + '</span>' : '') +
      '<div class="pilha" style="height:' + (t / topo) * 100 + '%">' + seg + '</div></div>';
    rots += '<span>' + (i % passo === 0 ? esc(r) : '') + '</span>';
  });
  const legenda = s.grupos.filter((g) => s.valores[g].some(Boolean)).map((g) => '<span><span class="quad" style="background:' + esc((P.grupos.find((x) => x.nome === g) || {}).cor) + '"></span>' + esc(g) + '</span>').join('');
  return '<section class="card" aria-label="' + titulo + '"><h3>' + titulo + '</h3><p class="card-sub">' + (s.pico ? 'pico em ' + esc(s.pico.rotulo) + ' com ' + n(s.pico.total) : '') + '</p>' +
    '<div class="grafico"><div class="eixo" aria-hidden="true"><span>' + n(topo) + '</span><span>' + n(topo / 2) + '</span><span>0</span></div><div>' +
    '<div class="plot" role="img" aria-label="' + esc(titulo + ', pico de ' + n(max)) + '"><div class="linha-grade" style="top:0"></div><div class="linha-grade" style="top:50%"></div>' +
    '<div class="colunas" style="' + grade + '">' + cols + '</div></div><div class="rotulos" style="' + grade + '" aria-hidden="true">' + rots + '</div></div></div>' +
    '<div class="legenda">' + legenda + '</div></section>';
}

function topClicados() {
  const C = cliquesDoPeriodo();
  const corpo = CL.estado !== 'ok' ? avisoCliques() : C.ranking.length
    ? '<ul class="cats">' + C.ranking.slice(0, 5).map((x, i) => '<li><span>' + (i + 1) + '. ' + esc(x.nome) + '</span><b>' + n(x.total) + '</b></li>').join('') + '</ul><p><button type="button" class="link-btn" data-aba-ir="produtos">Ver o ranking completo →</button></p>'
    : vazio('Nenhum clique no período ainda.');
  return card('Mais clicados', 'os 5 primeiros do período', corpo);
}

function atencao(P) {
  const lista = P.alertas.map((a) => '<li class="alerta">' + badge(a.nivel, a.rotuloNivel) + '<div><div class="alerta-titulo">' + esc(a.titulo) + '</div><div class="alerta-detalhe">' + esc(a.detalhe) + '</div></div>' +
    '<button type="button" class="acao" data-aba-ir="' + esc(a.acao.aba) + '">' + esc(a.acao.rotulo) + '</button></li>').join('');
  return card('Pontos de atenção', P.alertas.length ? 'do mais grave para o mais leve' : 'nenhum no período', lista ? '<ul class="alertas">' + lista + '</ul>' : vazio('Tudo certo neste período.'), 'atencao');
}

// ---------- ganhos ----------
function abaGanhos(P) {
  const m = P.monetizacao || {};
  const C = cliquesDoPeriodo();
  const cl = (loja) => (CL.estado === 'ok' ? n(C.porLoja[loja] || 0) : '—');
  const vendas = (m.awin ? m.awin.vendas : 0) + (m.shopee ? m.shopee.pedidos : 0);
  const painel = (u) => (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">abrir →</a>' : '');
  const pn = D.paineis || {};
  const linha = (nome, cliques, v, pend, apr, link) => '<tr><th scope="row">' + nome + '</th><td>' + cliques + '</td><td>' + v + '</td><td>' + pend + '</td><td>' + apr + '</td><td>' + link + '</td></tr>';
  const semApi = '<span class="pct">sem API: veja no painel</span>';
  const tabela = '<div class="rolagem"><table><thead><tr>' + ['Plataforma', 'Cliques nos posts', 'Vendas', 'Pendente', 'Aprovado', 'Painel'].map((h) => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' +
    linha('Shopee', cl('Shopee'), m.shopee ? n(m.shopee.pedidos) : '—', m.shopee ? brl(m.shopee.pendente) : '—', m.shopee ? brl(m.shopee.aprovado) : '—', painel(pn.shopee)) +
    linha('Awin', cl('Awin'), m.awin ? n(m.awin.vendas) : '—', m.awin ? brl(m.awin.pendente) : '—', m.awin ? brl(m.awin.aprovado) : '—', painel(pn.awin)) +
    linha('Mercado Livre', cl('Mercado Livre'), semApi, '', '', painel(pn.ml)) +
    linha('Amazon', '<span class="pct">link direto</span>', semApi, '', '', painel(pn.amazon)) +
    '</tbody></table></div><p class="rodape">Pendente = a loja ainda pode cancelar (devolução, pedido não pago); só entra em “aprovado” quando a loja confirma. Shopee e Awin são atualizadas às 12h30 e 21h52.</p>';
  const prods = m.shopee && m.shopee.produtos && m.shopee.produtos.length
    ? '<div class="rolagem"><table><thead><tr><th scope="col" class="esq">Produto</th><th scope="col">Vendas</th><th scope="col">Comissão</th></tr></thead><tbody>' +
      m.shopee.produtos.map((x) => '<tr><td class="nome">' + esc(x.nome) + '</td><td>' + n(x.vendas) + '</td><td>' + brl(x.comissao) + '</td></tr>').join('') + '</tbody></table></div>'
    : vazio(m.shopee ? 'Nenhuma venda da Shopee no período.' : 'A Shopee ainda não mandou o relatório.');
  return '<div class="kpis">' +
    kpi('Aprovado', brl(m.aprovado), 'Awin + Shopee, já confirmado') +
    kpi('Pendente', brl(m.pendente), 'pode mudar até a loja confirmar') +
    kpi('Vendas', n(vendas), 'Awin + Shopee (sem as canceladas)') +
    kpi('Cliques nos links', CL.estado === 'ok' ? n(C.total) : '—', 'todas as lojas, menos Amazon') + '</div>' +
    card('Por plataforma', 'no período escolhido', tabela) +
    card('O que vendeu na Shopee', 'produtos com comissão no período', prods);
}

// ---------- grupos, fontes, categorias ----------
function funil(P) {
  const f = P.funil;
  const barra = (rot, val, extra, larg) => '<div class="funil-item"><div class="funil-topo"><span>' + rot + '</span><span><b>' + n(val) + '</b>' + (extra ? ' <span class="pct">' + extra + '</span>' : '') + '</span></div>' +
    '<div class="trilho" role="presentation"><i style="width:' + Math.max(val ? 1.5 : 0, larg) + '%;background:var(--accent)"></i></div></div>';
  if (!f.avaliadas && !f.publicadas) return card('Funil de ofertas', 'da busca até o grupo', vazio());
  const base = f.avaliadas || 1;
  const mini = (rot, val, cls) => '<div class="mini"><span>' + rot + '</span><b class="' + (cls || '') + '">' + n(val) + '</b></div>';
  return card('Funil de ofertas', 'da busca até o grupo',
    barra('Avaliadas na busca', f.avaliadas, '', 100) +
    barra('Entraram na fila', f.naFila, pc(f.pctFila) + ' das avaliadas', (f.naFila / base) * 100) +
    barra('Publicadas', f.publicadas, pc(f.pctPublicadas) + ' da fila', (f.publicadas / base) * 100) +
    '<div class="minis">' + mini('Barradas ao postar', f.barradas) + mini('Repetidas (não saíram)', f.duplicados) + mini('Envio sem confirmação', f.incertos, f.incertos > 0 ? 'warn' : '') + mini('Falhas de envio', f.erros, f.erros > 0 ? 'crit' : '') + '</div>');
}

function spark(serie) {
  const max = Math.max(1, ...serie);
  return '<span class="spark" aria-hidden="true">' + serie.map((v, i) => '<i class="' + (i === serie.length - 1 ? 'ult' : '') + '" style="height:' + Math.max(4, (v / max) * 100) + '%"></i>').join('') + '</span>';
}

function tabela(P) {
  if (!P.grupos.length) return card('Comparativo por grupo', '', vazio());
  const linhas = P.grupos.map((g) => '<tr><th scope="row"><span class="quad" style="background:' + esc(g.cor) + '"></span>' + esc(g.nome) + '</th>' +
    '<td>' + spark(g.sparkline) + '</td><td>' + n(g.publicadas) + '<span class="pct">' + pc(g.pctTotal) + '</span></td><td>' + pc(g.aprovFila) + '</td><td>' + pc(g.desconto) + '</td><td>' + brl(g.preco) + '</td>' +
    '<td>' + pc(g.cupom) + '</td><td>' + pc(g.frete) + '</td><td class="' + (g.filaVaziaAlta ? 'warn' : '') + '">' + n(g.filaVazia) + '</td>' +
    '<td>' + (g.membrosReais == null ? '—' : n(g.membrosReais)) + '</td><td>' + badge(g.status.nivel, g.status.rotulo) + '</td></tr>').join('');
  return card('Comparativo por grupo', esc(P.inicio === P.fim ? P.inicio : P.inicio + ' a ' + P.fim), '<div class="rolagem"><table><thead><tr>' +
    ['Grupo', 'Por dia', 'Publicadas', 'Aprov. fila', 'Desconto', 'Preço médio', 'Cupom', 'Frete grátis', 'Fila vazia', 'Membros', 'Status'].map((h) => '<th scope="col">' + h + '</th>').join('') +
    '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
    '<p class="rodape">Aprov. fila = publicadas ÷ entraram na fila. Fila vazia = horários de envio sem nenhuma oferta para postar. Membros = sem você e o bot.</p>');
}

function fontes(P) {
  const itens = P.fontes.map((f) => {
    const canal = f.tipo === 'canal';
    const t = f.total || 1;
    const meio = Math.max(0, f.meio - f.fim);
    const recusas = f.motivos.slice(0, 4).map(([m, v]) => esc(m) + ' ' + n(v)).join(' · ');
    return '<div class="fonte"><div class="fonte-nome"><span>' + esc(f.nome) + '</span><span class="pilula">' + (canal ? 'canal' : 'busca') + '</span></div>' +
      '<div class="fonte-num">' + n(f.total) + (canal ? ' lidas → ' : ' avaliadas → ') + n(f.meio) + (canal ? ' com link → ' : ' na fila → ') + '<b>' + n(f.fim) + (canal ? ' aceitas' : ' publicadas') + '</b> (' + pc(f.taxa) + ')</div>' +
      '<div class="trilho" role="presentation"><i style="width:' + (f.fim / t) * 100 + '%;background:var(--accent)"></i><i style="width:' + (meio / t) * 100 + '%;background:var(--recusa)"></i></div>' +
      (recusas ? '<div class="fonte-recusas">Recusas: ' + recusas + '</div>' : '') + '</div>';
  }).join('');
  return card('Funil das fontes', 'ordenado pelas que mais trazem ofertas', itens || vazio());
}

/** Mapa fonte × grupo: quantas ofertas de cada fonte saíram em cada grupo. */
function mapaFontes(P) {
  const G = (D.periodos && D.periodos[periodo] && D.periodos[periodo].grupos) || {};
  const grupos = P.grupos.map((g) => g.nome).filter((g) => G[g]);
  const linhas = {};
  for (const g of grupos) for (const [f, F] of Object.entries(G[g].fontes || {})) if (F.publicadas) (linhas[f] = linhas[f] || {})[g] = F.publicadas;
  const ord = Object.entries(linhas).sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0));
  if (!ord.length) return card('Mapa das fontes', 'de onde vem o que sai em cada grupo', vazio());
  return card('Mapa das fontes', 'publicadas de cada fonte em cada grupo', '<div class="rolagem"><table><thead><tr><th scope="col">Fonte</th>' + grupos.map((g) => '<th scope="col">' + esc(g) + '</th>').join('') + '<th scope="col">Total</th></tr></thead><tbody>' +
    ord.map(([f, v]) => '<tr><th scope="row">' + esc(f) + '</th>' + grupos.map((g) => '<td>' + (v[g] ? n(v[g]) : '<span class="pct">·</span>') + '</td>').join('') + '<td><b>' + n(Object.values(v).reduce((s, x) => s + x, 0)) + '</b></td></tr>').join('') + '</tbody></table></div>');
}

function categoriasSem(P) {
  const l = P.categoriasSemPublicacao.map((c) => '<li><span>' + esc(c.nome) + '</span><span class="pilula">' + esc(c.loja) + '</span></li>').join('');
  return card('Categorias sem publicação', 'buscas ligadas que não publicaram no período', l ? '<ul class="cats">' + l + '</ul>' : vazio(P.periodo === 'hoje' ? 'Veja em 7 ou 30 dias.' : 'Todas as categorias publicaram no período.'));
}

function categoriasTabela(P) {
  if (!P.categorias.length) return card('Categorias', '', vazio());
  const linhas = P.categorias.map((c) => '<tr><th scope="row">' + esc(c.nome) + '</th><td><span class="pilula">' + esc(c.loja) + '</span></td><td>' + n(c.encontrados) + '</td><td>' + n(c.aceitos) + '</td><td class="' + (c.publicadas ? '' : 'warn') + '">' + n(c.publicadas) + '</td></tr>').join('');
  return card('Categorias de busca', 'vistas na busca → aprovadas nos filtros → publicadas', '<div class="rolagem"><table><thead><tr>' +
    ['Categoria', 'Loja', 'Vistas', 'Aprovadas', 'Publicadas'].map((h) => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div>');
}

// ---------- operação, regras, WhatsApp ----------
function quando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = (Date.now() - d.getTime()) / 3600000;
  const txt = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ha = h < 1 ? 'há ' + Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? 'há ' + Math.round(h) + ' h' : 'há ' + Math.round(h / 24) + ' dias';
  return txt + ' <span class="pct">' + ha + '</span>';
}

function abaOperacao() {
  const O = D.operacao || { grupos: [] };
  const H = A.hoje || A[periodo];
  const hoje = {};
  for (const g of (H && H.grupos) || []) hoje[g.nome] = g;
  const linhas = O.grupos.map((g) => {
    const x = hoje[g.nome] || {};
    const parado = g.ativo && g.ultima && Date.now() - new Date(g.ultima).getTime() > 6 * 3600000;
    const st = !g.ativo ? badge('info', 'Pausado') : parado ? badge('atencao', 'Sem postar há 6 h+') : g.fila ? badge('ok', 'Postando') : badge('atencao', 'Fila vazia');
    return '<tr><th scope="row">' + esc(g.nome) + '</th><td>' + st + '</td><td>' + n(g.fila) + '</td><td>' + quando(g.ultima) + '</td><td>' + n(x.publicadas || 0) + '</td><td class="' + (x.incertos ? 'warn' : '') + '">' + n(x.incertos || 0) + '</td><td class="' + (x.erros ? 'crit' : '') + '">' + n(x.erros || 0) + '</td></tr>';
  }).join('');
  const R = D.regras || {};
  const wa = R.whatsapp || {};
  const tab = '<div class="rolagem"><table><thead><tr>' + ['Grupo', 'Agora', 'Na fila', 'Último post', 'Publicadas hoje', 'Sem confirmação', 'Falhas'].map((h) => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
    '<p class="rodape">Posts a cada 3 min das 8h às 21h59; buscas às 7h, 12h e 17h. “Sem confirmação” = o Telegram não respondeu: pode ter saído, e o bot não repete.</p>';
  const whats = '<dl class="lista-dl"><dt>Espelho no WhatsApp</dt><dd>' + (wa.ligado ? '<span class="ok">ligado</span>' : 'desligado') + '</dd><dt>Ritmo</dt><dd>1 mensagem a cada ' + n(wa.intervaloMin) + ' min</dd><dt>Último envio</dt><dd>' + quando(O.whatsappUltimo) + '</dd></dl>';
  return card('Como está agora', 'atualizado ' + esc(D.hora), tab) + '<div class="duas iguais">' + card('WhatsApp', '', whats + '<p><button type="button" class="link-btn" data-aba-ir="whatsapp">Ver números do WhatsApp →</button></p>') + atencao(A[periodo] || H) + '</div>';
}

function abaRegras() {
  const R = D.regras;
  if (!R) return vazio('Sem as regras nesta versão do painel.');
  const sim = (b) => (b ? 'sim' : 'não');
  const linhas = R.grupos.map((g) => '<tr><th scope="row">' + esc(g.nome) + '</th><td>' + (g.ativo ? '<span class="ok">ligado</span>' : 'pausado') + '</td><td>' + (g.descontoMinimo == null ? '—' : n(g.descontoMinimo) + '%') + '</td><td>' + brl(g.precoMinimo) + ' a ' + brl(g.precoMaximo) + '</td><td>' + (g.notaMinima == null ? '—' : n(g.notaMinima)) + '</td><td>' + sim(g.soMarcas) + '</td><td>' + (g.masculinoCada ? '1 a cada ' + n(g.masculinoCada) : 'sem limite') + '</td><td>' + (g.diasSemRepetir == null ? '—' : n(g.diasSemRepetir) + ' dias') + '</td><td>' + sim(g.whatsapp) + '</td></tr>').join('');
  const tab = '<div class="rolagem"><table><thead><tr>' + ['Grupo', 'Situação', 'Desconto mín.', 'Preço', 'Nota mín.', 'Só marcas', 'Masculino', 'Não repete por', 'WhatsApp'].map((h) => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
  const gerais = [
    'Público principal: meninas. Produtos femininos saem primeiro, depois os neutros; masculino no máximo na proporção da coluna “Masculino”.',
    'Marcas da lista passam na frente em todos os grupos; com “só marcas”, o grupo só posta marca da lista.',
    'Mercado Livre na busca direta: só com mais de ' + n(R.vendasMinimasML) + ' vendas.',
    R.shopeeUmACada ? 'Shopee: no máximo 1 a cada ' + n(R.shopeeUmACada) + ' posts (a comissão é baixa).' : '',
    R.awinCatalogo && R.awinCatalogo.umACada ? 'Produtos das lojas da Awin: 1 a cada ' + n(R.awinCatalogo.umACada) + ' posts' + (R.awinCatalogo.maxPorDia ? ', até ' + n(R.awinCatalogo.maxPorDia) + ' por dia em cada grupo.' : '.') : '',
    'Nada é postado duas vezes no mesmo grupo dentro do prazo de “Não repete por”.',
    R.whatsapp ? 'WhatsApp: 1 mensagem a cada ' + n(R.whatsapp.intervaloMin) + ' min no total (mais rápido arrisca o número ser banido).' : '',
  ].filter(Boolean);
  const marcas = (R.marcas || []).map((l) => '<details><summary>' + esc(l.lista) + (l.nicho ? ' <span class="pct">' + esc(l.nicho) + '</span>' : '') + ' · ' + n(l.marcas.length) + ' marcas</summary><p class="marcas">' + l.marcas.map(esc).join(' · ') + '</p></details>').join('');
  return card('Por grupo', 'as regras que valem agora', tab) +
    card('Regras gerais', '', '<ul class="regras-lista">' + gerais.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>') +
    card('Marcas que saem primeiro', 'toque numa lista para ver as marcas', marcas || vazio('Nenhuma marca na lista.')) +
    '<p class="rodape">Para mudar uma regra, peça ao Alan.</p>';
}

function abaWhatsApp(P) {
  const W = P.whatsapp || [];
  const C = cliquesDoPeriodo();
  const cliquesWa = {};
  if (CL.estado === 'ok') {
    const dias = new Set((D.periodos && D.periodos[periodo] && D.periodos[periodo].dias) || []);
    for (const [dia, caminho, qtd] of CL.linhas) if (dias.has(dia) && caminho.charAt(0) === 'w') { const g = (D.letras || {})[caminho.charAt(1)] || 'Outro'; cliquesWa[g] = (cliquesWa[g] || 0) + qtd; }
  }
  const total = W.reduce((s, g) => s + g.enviadas, 0);
  const falhas = W.reduce((s, g) => s + g.falhas, 0);
  const R = (D.regras && D.regras.whatsapp) || {};
  const linhas = W.filter((g) => g.enviadas || g.falhas || cliquesWa[g.nome]).map((g) => '<tr><th scope="row">' + esc(g.nome) + '</th><td>' + spark(g.porDia) + '</td><td>' + n(g.enviadas) + '</td><td class="' + (g.falhas ? 'crit' : '') + '">' + n(g.falhas) + '</td><td>' + (CL.estado === 'ok' ? n(cliquesWa[g.nome] || 0) : '—') + '</td></tr>').join('');
  return '<div class="kpis">' +
    kpi('Mensagens enviadas', n(total), 'no período, todos os grupos') +
    kpi('Falhas', n(falhas), falhas ? 'veja o log do bot' : 'nenhuma') +
    kpi('Cliques vindos do WhatsApp', CL.estado === 'ok' ? n(C.wa) : '—', CL.estado === 'ok' && total ? n(Math.round((C.wa / total) * 10) / 10) + ' por mensagem' : '') +
    kpi('Ritmo', R.intervaloMin ? '1 a cada ' + n(R.intervaloMin) + ' min' : '—', R.ligado ? 'espelho ligado' : 'espelho desligado') + '</div>' +
    card('Por grupo', 'o que saiu no Telegram e foi também para o WhatsApp', linhas ? '<div class="rolagem"><table><thead><tr>' + ['Grupo', 'Por dia', 'Enviadas', 'Falhas', 'Cliques'].map((h) => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div>' : vazio('Nada foi para o WhatsApp no período.'));
}

// ---------- desenho ----------
function desenhar() {
  const P = A[periodo];
  guardarUrl();
  if (!P) return ($('#conteudo').innerHTML = vazio('Ainda não há dados.'));
  cabecalho(P);
  let html = '';
  if (aba === 'resumo') html = faixaStatus(P) + kpisGerais(P) + '<div class="duas">' + grafico(P) + topClicados() + '</div>' + atencao(P);
  else if (aba === 'produtos') html = abaProdutos(P);
  else if (aba === 'ganhos') html = abaGanhos(P);
  else if (aba === 'grupos') html = tabela(P) + '<div class="duas iguais">' + funil(P) + card('Cliques por grupo', 'nos links dos posts', CL.estado === 'ok' ? barras(cliquesDoPeriodo().porGrupo, corDosGrupos(P)) : avisoCliques()) + '</div>';
  else if (aba === 'fontes') html = mapaFontes(P) + fontes(P);
  else if (aba === 'categorias') html = categoriasTabela(P) + categoriasSem(P);
  else if (aba === 'operacao') html = abaOperacao();
  else if (aba === 'regras') html = abaRegras();
  else if (aba === 'whatsapp') html = abaWhatsApp(P);
  $('#conteudo').innerHTML = html;
}

function irPara(nova) {
  aba = nova;
  desenhar();
  window.scrollTo({ top: 0 });
}

document.addEventListener('click', (e) => {
  const p = e.target.closest('.periodos button');
  if (p) { periodo = p.dataset.p; return desenhar(); }
  const t = e.target.closest('[data-aba]');
  if (t) { e.preventDefault(); return irPara(t.dataset.aba); }
  const ir = e.target.closest('[data-aba-ir]');
  if (ir) return irPara(ir.dataset.abaIr);
  const g = e.target.closest('[data-grupo]');
  if (g) { grupoProduto = g.dataset.grupo; return desenhar(); }
  if (e.target.closest('[data-todos]')) { todosProdutos = !todosProdutos; return desenhar(); }
  if (e.target.closest('[data-limpar]')) { filtroProduto = ''; $('#busca').value = ''; document.querySelectorAll('.menu li').forEach((li) => { li.hidden = false; }); return desenhar(); }
  const sec = e.target.closest('[data-ir]');
  if (sec) document.getElementById(sec.dataset.ir)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#busca').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.menu li').forEach((li) => { li.hidden = q && !li.textContent.toLowerCase().includes(q); });
});
// Enter: vai para a aba que combina; se nenhuma combina, procura o produto no ranking.
$('#busca').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  const alvo = [...document.querySelectorAll('.menu li:not([hidden]) [data-aba]')][0];
  if (alvo && q) return alvo.click();
  filtroProduto = q;
  document.querySelectorAll('.menu li').forEach((li) => { li.hidden = false; });
  irPara('produtos');
});
if (filtroProduto) $('#busca').value = filtroProduto;
desenhar();
lerCliques();
`;

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NOMES = { hoje: 'Hoje', '7d': '7 dias', '30d': '30 dias' };

const MENU = [
  ['PAINEL', [['Visão geral', 'resumo'], ['Produtos', 'produtos'], ['Ganhos', 'ganhos']]],
  ['DESEMPENHO', [['Grupos', 'grupos'], ['Fontes', 'fontes'], ['Categorias', 'categorias']]],
  ['OPERAÇÃO', [['Centro de operações', 'operacao'], ['Regras e filtros', 'regras'], ['WhatsApp', 'whatsapp']]],
];

const LUPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

function menuHtml() {
  return MENU.map(([secao, itens]) => `<div><h2>${secao}</h2><ul>${itens.map(([rot, aba]) => `<li><a href="?aba=${aba}" data-aba="${aba}">${escHtml(rot)}</a></li>`).join('')}</ul></div>`).join('');
}

/** O HTML completo, com os dados embutidos. */
export function htmlDoPainel(painel) {
  const json = JSON.stringify(painel).replace(/</g, '\\u003c');
  const periodos = Object.keys(painel.analytics || painel.periodos || {}).map((p) => `<button type="button" data-p="${escHtml(p)}" aria-pressed="false">${escHtml(NOMES[p] || p)}</button>`).join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Painel da Vic</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="app">
<aside class="menu">
<div><div class="marca-nome">Achadinhos da Vic<span class="estrela" aria-hidden="true">✦</span></div><div class="marca-sub">Painel dos grupos</div></div>
<label class="busca">${LUPA}<span class="sr">Buscar aba ou produto</span><input id="busca" type="search" placeholder="Buscar aba ou produto…" autocomplete="off"></label>
<nav aria-label="Menu do painel">${menuHtml()}</nav>
</aside>
<main class="conteudo">
<div class="miolo">
<div class="cab"><div><h1 id="titulo">Visão geral</h1><p class="sub" id="sub">Carregando…</p></div><div class="periodos" role="group" aria-label="Período">${periodos}</div></div>
<div id="conteudo" aria-live="polite" style="display:flex;flex-direction:column;gap:12px"><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div></div>
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
  'Cliques = toques no link do post (desde 03/11/2026). Prévias automáticas de link não contam; a Amazon fica de fora porque o link dela vai direto.',
  'Visualizações por post não aparecem: o Telegram não mostra isso para o bot, e o WhatsApp também não.',
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
