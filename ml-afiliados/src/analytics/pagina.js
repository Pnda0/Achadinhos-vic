/**
 * Analytics — a página do painel (um arquivo só, sem CDN, gráficos em SVG desenhados no navegador).
 * Os dados vão embutidos (abre com dois cliques, sem servidor) e também em dados.json ao lado.
 * Celular primeiro: 360 px sem rolagem lateral; claro/escuro automático.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ANALYTICS } from './dia.js';

export const pastaSite = (base = PASTA_ANALYTICS) => path.join(base, 'site');

const CSS = `
/* cores da marca (logo e site): vinho, rosa, creme e dourado */
:root{color-scheme:light;--bg:#f9f5ec;--surface:#fffdf8;--line:#ecdcd6;--text:#2b1210;--text2:#6e5552;--muted:#75605c;--marca:#7a1712;--rosa:#c25f80;--rosa-texto:#a8466a;--ouro:#f2b85c;--bar:#7a1712;--bar-hover:#a8261d;--warn:#9a5b00;--good:#2f7a3a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a0d0c;--surface:#25130f;--line:#3d2421;--text:#f9f5ec;--text2:#dcc6c1;--muted:#ab938e;--marca:#e08ca6;--rosa:#e08ca6;--rosa-texto:#e08ca6;--ouro:#f2b85c;--bar:#d17b96;--bar-hover:#e9a3b9;--warn:#f2b85c;--good:#6fcf86}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a0d0c;--surface:#25130f;--line:#3d2421;--text:#f9f5ec;--text2:#dcc6c1;--muted:#ab938e;--marca:#e08ca6;--rosa:#e08ca6;--rosa-texto:#e08ca6;--ouro:#f2b85c;--bar:#d17b96;--bar-hover:#e9a3b9;--warn:#f2b85c;--good:#6fcf86}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0}
.marca{display:block;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--rosa-texto)}
.marca::after{content:" ✦";color:var(--ouro)}
h2{font-size:17px;margin:28px 0 10px}
h3{font-size:18px;margin:0}
.topo{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between}
.atualizado{font-size:15px;font-weight:600;color:var(--text2)}
.abas{display:flex;gap:6px;margin:14px 0 4px;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}
.abas button{flex:1;min-height:44px;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;font:inherit;font-weight:600;cursor:pointer}
.abas button[aria-selected="true"]{background:var(--marca);color:var(--bg);border-color:var(--marca)}
.cartoes{display:grid;grid-template-columns:1fr;gap:12px}
@media (min-width:700px){.cartoes{grid-template-columns:1fr 1fr}}
.cartao{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}
.grande{color:var(--marca);font-size:34px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.rotulo{color:var(--text2);font-size:13px}
.linhas{display:grid;grid-template-columns:1fr auto;gap:2px 12px;margin:10px 0 0;font-size:14px}
.linhas dt{color:var(--text2)}
.linhas dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.aviso{color:var(--warn);font-weight:600}
.bom{color:var(--good)}
.grafico{margin-top:12px;max-width:440px}
.grafico svg{display:block;width:100%;height:auto;overflow:visible}
.grafico text{fill:var(--muted);font-size:10px}
.grafico .barra{fill:var(--bar)}
.grafico .barra.ativa{fill:var(--bar-hover)}
.grafico .base{stroke:var(--line)}
.dica{position:fixed;pointer-events:none;background:var(--text);color:var(--bg);padding:6px 9px;border-radius:8px;font-size:13px;z-index:10;display:none;max-width:240px}
.fontes{width:100%;border-collapse:collapse;font-size:14px}
.fontes th,.fontes td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
.fontes th:first-child,.fontes td:first-child{text-align:left}
.fontes th{cursor:pointer;color:var(--text2);font-weight:600;white-space:nowrap;user-select:none}
.fontes th[aria-sort="descending"]::after{content:" ▼"}
.fontes th[aria-sort="ascending"]::after{content:" ▲"}
@media (max-width:699px){
 .fontes thead{display:none}
 .fontes tr{display:block;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px 12px;margin-bottom:8px}
 .fontes td{display:flex;justify-content:space-between;gap:12px;border:0;padding:3px 0;text-align:right}
 .fontes td::before{content:attr(data-r);color:var(--text2);text-align:left}
 .fontes td:first-child{font-weight:700;font-size:15px}
 .fontes td:first-child::before{content:none}
}
.lista{list-style:none;padding:0;margin:0}
.lista li{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;overflow-wrap:anywhere}
details.cartao{margin-bottom:8px;padding:0}
details.cartao>summary{padding:14px;min-height:44px;cursor:pointer;list-style-position:inside}
details.cartao>.tabela{padding:0 12px 12px;overflow-x:auto}
.dobra>summary{cursor:pointer;list-style-position:inside}
.dobra>summary h2{display:inline}
.notas{color:var(--text2);font-size:13px;padding-left:18px}
a{color:var(--marca)}
:focus-visible{outline:2px solid var(--rosa);outline-offset:2px}
.vazio{color:var(--text2);padding:12px 0}
`;

// O navegador desenha tudo a partir de DADOS (nada de innerHTML com texto vindo das ofertas sem escapar).
const JS = `
const D = JSON.parse(document.getElementById('dados').textContent);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = (v) => (v ?? 0).toLocaleString('pt-BR');
const brl = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sinal = (v) => (v == null ? '—' : v > 0 ? '+' + v : String(v));
const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
let periodo = 'hoje';
try { periodo = localStorage.getItem('periodo') || 'hoje'; } catch {}
if (!D.periodos[periodo]) periodo = Object.keys(D.periodos)[0];

const dica = document.createElement('div');
dica.className = 'dica';
dica.setAttribute('role', 'tooltip');
document.body.appendChild(dica);
function mostrarDica(e) {
  const alvo = e.target.closest('[data-dica]');
  document.querySelectorAll('.barra.ativa').forEach((b) => b.classList.remove('ativa'));
  if (!alvo) return (dica.style.display = 'none');
  alvo.querySelector('.barra')?.classList.add('ativa');
  dica.textContent = alvo.dataset.dica;
  dica.style.display = 'block';
  const r = alvo.getBoundingClientRect();
  const x = Math.min(window.innerWidth - dica.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - dica.offsetWidth / 2));
  dica.style.left = x + 'px';
  dica.style.top = Math.max(8, r.top - dica.offsetHeight - 8) + 'px';
}
document.addEventListener('pointerover', mostrarDica);
document.addEventListener('focusin', mostrarDica);
document.addEventListener('scroll', () => (dica.style.display = 'none'), { passive: true });

/** Barras verticais de uma série só (sem legenda: o título diz o que é). Alvo de toque = coluna inteira. */
function barras(pontos, titulo) {
  const L = 320, A = 96, topo = 14, base = A - 16;
  const max = Math.max(1, ...pontos.map((p) => p.v));
  const w = L / pontos.length;
  const larg = Math.max(2, Math.min(28, w - 2));
  const passo = pontos.length <= 8 ? 1 : Math.ceil(pontos.length / 7);
  const mostrar = (i) => i % passo === 0;
  let s = '<svg viewBox="0 0 ' + L + ' ' + A + '" role="img" aria-label="' + esc(titulo) + '">';
  s += '<line class="base" x1="0" x2="' + L + '" y1="' + base + '" y2="' + base + '"/>';
  pontos.forEach((p, i) => {
    const h = p.v ? Math.max(2, ((base - topo) * p.v) / max) : 0;
    const x = i * w + (w - larg) / 2;
    s += '<g data-dica="' + esc(p.r + ': ' + n(p.v)) + '" tabindex="0">';
    s += '<rect x="' + i * w + '" y="0" width="' + w + '" height="' + A + '" fill="transparent"/>';
    if (h) s += '<path class="barra" d="M' + x + ',' + base + 'V' + (base - h + 2) + 'q0,-2 2,-2h' + (larg - 4) + 'q2,0 2,2V' + base + 'z"/>';
    if (mostrar(i)) s += '<text x="' + (i * w + w / 2) + '" y="' + (A - 3) + '" text-anchor="middle">' + esc(p.r) + '</text>';
    s += '</g>';
  });
  if (max > 1) s += '<text x="0" y="9">' + esc('máx. ' + n(max)) + '</text>';
  return s + '</svg>';
}

function cartaoGrupo(nome, G) {
  const m = D.membros[nome];
  const dias = Object.keys(G.porDia).sort();
  const P = D.periodos[periodo];
  const comeco = P.diasComDado?.[0];
  const grafico = periodo !== 'hoje' && dias.length > 1 && (P.diasComDado?.length || 0) <= 1
    ? '<p class="rotulo">' + (comeco ? 'Histórico começa em ' + dm(comeco) + ': o gráfico por dia aparece a partir do 2º dia.' : 'Ainda sem histórico neste período.') + '</p>'
    : periodo === 'hoje' || dias.length === 1
    ? barras(Array.from({ length: 14 }, (_, i) => { const h = String(i + 8).padStart(2, '0'); return { r: h + 'h', v: G.porHora[h] || 0 }; }), 'Publicações por hora')
    : barras(dias.map((d) => ({ r: dm(d), v: G.porDia[d] })), 'Publicações por dia');
  const linha = (rot, val, cls) => '<dt>' + esc(rot) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</dd>';
  let dl = linha('Entraram na fila', n(G.naFila)) + linha('Recusadas na busca', n(G.recusadas)) + linha('Barradas na hora de postar', n(G.barradas)) + linha('Repetidas (não saíram)', n(G.duplicados));
  if (G.incertos || G.erros) dl += linha('Envio sem confirmação / falhas', n(G.incertos) + ' / ' + n(G.erros), 'aviso');
  dl += linha('Horários com a fila vazia', n(G.filaVazia), G.filaVazia ? 'aviso' : '');
  if (G.filaFim != null) dl += linha(periodo === 'hoje' ? 'Na fila agora' : 'Sobraram na fila (último dia)', n(G.filaFim));
  if (G.descontoMedio != null) dl += linha('Desconto médio', G.descontoMedio + '%') + linha('Preço médio', brl(G.precoMedio)) + linha('Com cupom · frete grátis · FULL', (G.pctCupom ?? 0) + '% · ' + (G.pctFreteGratis ?? 0) + '% · ' + (G.pctFull ?? 0) + '%');
  if (m) dl += linha('Membros (inclui você e o bot)', n(m.atual) + ' <span class="rotulo">(' + sinal(m.dia) + ' no dia, ' + sinal(m.semana) + ' na semana)</span>');
  return '<article class="cartao"><div class="rotulo">' + esc(nome) + '</div><div class="grande">' + n(G.publicadas) + '</div><div class="rotulo">publicadas</div>' +
    '<div class="grafico">' + grafico + '</div><dl class="linhas">' + dl + '</dl></article>';
}

const COLS = [
  ['fonte', 'Fonte'], ['grupo', 'Grupo'], ['publicadas', 'Publicadas'], ['naFila', 'Na fila'], ['parteDaFila', '% da fila'],
  ['recusadas', 'Recusadas na busca'], ['aproveitamento', 'Aproveitamento'], ['motivo', 'Principal recusa'],
];
let ordem = { col: 'publicadas', desc: true };
function tabelaFontes(P, soGrupo) {
  const linhas = [];
  for (const [g, G] of Object.entries(P.grupos)) for (const [f, F] of Object.entries(G.fontes)) {
    if (soGrupo && g !== soGrupo) continue;
    const motivo = Object.entries(F.recusas).sort((a, b) => b[1] - a[1])[0];
    linhas.push({ fonte: f, grupo: g, publicadas: F.publicadas, naFila: F.naFila, parteDaFila: F.parteDaFila, recusadas: F.recusadas, aproveitamento: F.aproveitamento, motivo: motivo ? motivo[0] + ' (' + motivo[1] + ')' : '', soRecusa: F.soRecusa });
  }
  if (!linhas.length) return '<p class="vazio">Ainda não há dados neste período.</p>';
  const { col, desc } = ordem;
  linhas.sort((a, b) => { const x = a[col] ?? -1, y = b[col] ?? -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * (desc ? -1 : 1); });
  const pct = (v) => (v == null ? '—' : v + '%');
  const cols = soGrupo ? COLS.filter(([k]) => k !== 'grupo') : COLS;
  let s = '<table class="fontes"><thead><tr>' + cols.map(([k, r]) => '<th data-col="' + k + '"' + (k === col ? ' aria-sort="' + (desc ? 'descending' : 'ascending') + '"' : '') + '>' + r + '</th>').join('') + '</tr></thead><tbody>';
  for (const l of linhas) {
    s += '<tr><td>' + esc(l.fonte) + (l.soRecusa ? ' <span class="aviso">· só recusa</span>' : '') + '</td>' + (soGrupo ? '' : '<td data-r="Grupo">' + esc(l.grupo) + '</td>') + '<td data-r="Publicadas">' + n(l.publicadas) + '</td><td data-r="Na fila">' + n(l.naFila) + '</td><td data-r="% da fila">' + pct(l.parteDaFila) +
      '</td><td data-r="Recusadas na busca">' + n(l.recusadas) + '</td><td data-r="Aproveitamento">' + pct(l.aproveitamento) + '</td><td data-r="Principal recusa">' + esc(l.motivo || '—') + '</td></tr>';
  }
  return s + '</tbody></table>';
}

function desenhar() {
  const P = D.periodos[periodo];
  document.querySelectorAll('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.p === periodo)));
  const grupos = Object.entries(P.grupos).sort((a, b) => b[1].publicadas - a[1].publicadas);
  const total = grupos.reduce((s, [, G]) => s + G.publicadas, 0);
  const aw = P.awin;
  $('#resumo').innerHTML = '<div class="cartao"><div class="grande">' + n(total) + '</div><div class="rotulo">ofertas publicadas nos ' + grupos.length + ' grupos</div>' +
    '<dl class="linhas">' + (aw ? '<dt>Awin — pendente</dt><dd>' + brl(aw.pendentes.comissao) + '</dd><dt>Awin — aprovado</dt><dd class="bom">' + brl(aw.aprovadas.comissao) + '</dd><dt>Cliques nos links da Awin</dt><dd>' + n(aw.cliques) + '</dd>' : '<dt>Awin</dt><dd class="rotulo">aguardando a 1ª leitura</dd>') +
    '<dt>Mercado Livre</dt><dd><a href="' + esc(D.painelML) + '" target="_blank" rel="noopener">ver no painel do ML</a></dd></dl></div>';
  $('#grupos').innerHTML = grupos.length ? grupos.map(([nome, G]) => cartaoGrupo(nome, G)).join('') : '<p class="vazio">Ainda não há dados neste período.</p>';
  $('#fontes').innerHTML = grupos.length ? grupos.map(([g, G]) => '<details class="cartao" data-grupo="' + esc(g) + '"><summary><strong>' + esc(g) + '</strong> — ' + n(Object.keys(G.fontes).length) + (Object.keys(G.fontes).length === 1 ? ' fonte, ' : ' fontes, ') + n(G.publicadas) + ' publicadas</summary><div class="tabela">' + tabelaFontes(P, g) + '</div></details>').join('') : '<p class="vazio">Ainda não há dados neste período.</p>';
  const funil = Object.entries(P.funil).sort((a, b) => b[1].aceitas - a[1].aceitas);
  $('#funil').innerHTML = funil.length ? funil.map(([f, x]) => {
    const mot = Object.entries(x.motivos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => esc(k) + ' ' + n(v)).join(' · ');
    return '<li><strong>' + esc(f) + '</strong><br>' + n(x.lidas) + ' lidas → ' + n(x.comLink) + ' com link de loja → <strong>' + n(x.aceitas) + ' aceitas</strong>' + (mot ? '<br><span class="rotulo">' + mot + '</span>' : '') + '</li>';
  }).join('') : '<li class="vazio">Nenhuma mensagem nova dos canais neste período.</li>';
  $('#paradas').innerHTML = P.categoriasParadas?.length ? '<h2>Categorias do Mercado Livre sem nenhuma publicação</h2><ul class="lista">' + P.categoriasParadas.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' : '';
  const top = grupos.flatMap(([g, G]) => G.top10.map((t) => ({ ...t, g }))).sort((a, b) => (b.descontoPct || 0) - (a.descontoPct || 0)).slice(0, 10);
  $('#top').innerHTML = top.length ? top.map((t) => '<li><strong>' + esc(t.nome) + '</strong><br><span class="rotulo">' + esc(t.g) + ' · ' + (t.descontoPct != null ? t.descontoPct + '% OFF · ' : '') + (t.preco != null ? brl(t.preco) + ' · ' : '') + esc(t.fonte) + (t.hora ? ' · ' + esc(t.hora) : '') + '</span></li>').join('') : '<li class="vazio">Sem publicações com preço registrado neste período.</li>';
}

document.querySelector('.abas').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  periodo = b.dataset.p;
  try { localStorage.setItem('periodo', periodo); } catch {}
  desenhar();
});
document.getElementById('fontes').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  ordem = { col: th.dataset.col, desc: ordem.col === th.dataset.col ? !ordem.desc : true };
  const det = th.closest('details');
  det.querySelector('.tabela').innerHTML = tabelaFontes(D.periodos[periodo], det.dataset.grupo);
});
desenhar();
`;

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NOMES = { hoje: 'Hoje', '7d': '7 dias', '30d': '30 dias' };

/** O HTML completo, com os dados embutidos. */
export function htmlDoPainel(painel) {
  const json = JSON.stringify(painel).replace(/</g, '\\u003c');
  const abas = Object.keys(painel.periodos).map((p) => `<button type="button" role="tab" data-p="${escHtml(p)}">${escHtml(NOMES[p] || p)}</button>`).join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Painel dos Grupos</title>
<style>${CSS}</style>
</head>
<body>
<main>
<div class="topo"><h1><span class="marca">Achadinhos da Vic</span>Painel dos grupos</h1><div class="atualizado">Atualizado ${escHtml(painel.hora)}</div></div>
<div class="abas" role="tablist">${abas}</div>
<section id="resumo"></section>
<h2>Grupos</h2>
<section class="cartoes" id="grupos"></section>
<h2>Fontes de cada grupo</h2>
<section id="fontes"></section>
<h2>Canais acompanhados</h2>
<ul class="lista" id="funil"></ul>
<section id="paradas"></section>
<details class="dobra"><summary><h2>Maiores descontos publicados</h2></summary>
<ul class="lista" id="top"></ul>
</details>
<h2>Como ler</h2>
<ul class="notas">${painel.notas.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ul>
</main>
<script type="application/json" id="dados">${json}</script>
<script>${JS}</script>
</body>
</html>
`;
}

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
