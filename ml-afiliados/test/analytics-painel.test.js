import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
const { gerarDia } = await import('../src/analytics/dia.js');
const { montarPainel, textoDoPainel, diasDoPeriodo } = await import('../src/analytics/relatorio.js');
const { gravarSite, pastaSite } = await import('../src/analytics/pagina.js');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-pn-'));
const storeVazio = { data: {}, list: () => [] };
const em = (dia, hora) => `${dia}T${String(hora + 3).padStart(2, '0')}:00:00.000Z`; // hora local de São Paulo
const AGORA = new Date(em('2026-10-14', 20));
const pub = (dia, extra) => ({ t: em(dia, 12), tipo: 'publicado', grupo: 'Perfumes', loja: 'ml', origem: 'coleta', fonte: 'Mercado Livre: Perfumes', hora: '12:00', preco: 100, descontoPct: 30, vendidos: '+100 vendidos', cupom: false, freteGratis: true, full: false, nome: 'Perfume', ...extra });

function montarBase() {
  const base = pasta();
  const eventosOntem = [
    pub('2026-10-13', { nome: 'Perfume Ontem', descontoPct: 50 }),
    { t: em('2026-10-13', 7), tipo: 'na_fila', grupo: 'Perfumes', origem: 'coleta', fonte: 'Mercado Livre: Perfumes' },
    { t: em('2026-10-13', 7), tipo: 'recusado', grupo: 'Perfumes', origem: 'coleta', fonte: 'Mercado Livre: Beleza (perfumes)', detalhe: 'fora do nicho' },
    { t: em('2026-10-13', 9), tipo: 'barrado', grupo: 'Perfumes', origem: 'coleta', fonte: 'Mercado Livre: Perfumes', detalhe: 'sem dado de vendas' },
  ];
  const storeOntem = { data: { funil: { '2026-10-13': { '@promobigodeperfumes': { lidas: 5, comLink: 4, aceitas: 2, motivos: { 'limite por hora': 2 } } } }, stats: { '2026-10-13': { categorias: { Perfumes: { encontrados: 50, aceitos: 3 }, 'Beleza (perfumes)': { encontrados: 40, aceitos: 0 } } } } }, list: () => [] };
  gerarDia('2026-10-13', { store: storeOntem, base, eventos: eventosOntem, membros: { Perfumes: 10 } });
  fs.writeFileSync(path.join(base, 'membros.json'), JSON.stringify({ '2026-10-07': { Perfumes: 4 }, '2026-10-13': { Perfumes: 10 }, '2026-10-14': { Perfumes: 12 } }));
  fs.writeFileSync(path.join(base, 'awin.json'), JSON.stringify({
    dias: { '2026-10-14': { total: { cliques: 7, pendentes: { vendas: 1, comissao: 5.5 }, aprovadas: { vendas: 0, comissao: 0 }, recusadas: { vendas: 0, comissao: 0 } } } },
    periodo30: null,
  }));
  return base;
}

test('períodos: hoje, 7 e 30 dias e um dia específico', () => {
  assert.deepEqual(diasDoPeriodo('hoje', AGORA), ['2026-10-14']);
  assert.equal(diasDoPeriodo('7d', AGORA).length, 7);
  assert.equal(diasDoPeriodo('30d', AGORA)[0], '2026-09-15');
  assert.deepEqual(diasDoPeriodo('2026-10-01', AGORA), ['2026-10-01']);
});

test('painel: junta os dias gravados com o de hoje (ao vivo), fontes, funil, membros e dinheiro separados', () => {
  const base = montarBase();
  const eventosHoje = [pub('2026-10-14', { nome: 'Perfume Hoje', descontoPct: 10 }), pub('2026-10-14', { nome: 'Perfume Canal', fonte: '@promobigodeperfumes', origem: 'espelho', descontoPct: 20 })];
  const p = montarPainel({ base, store: storeVazio, eventos: eventosHoje, agora: AGORA });
  const s7 = p.periodos['7d'];
  const P = s7.grupos.Perfumes;
  assert.equal(P.publicadas, 3);
  assert.deepEqual([P.recusadas, P.barradas], [1, 1], 'recusada na busca ≠ barrada na hora de postar');
  assert.equal(P.porDia['2026-10-13'], 1);
  assert.equal(P.porDia['2026-10-14'], 2);
  assert.equal(P.porDia['2026-10-08'], 0, 'dia sem dado aparece como zero no gráfico');
  assert.equal(P.fontes['Mercado Livre: Beleza (perfumes)'].soRecusa, true);
  assert.equal(P.fontes['Mercado Livre: Perfumes'].parteDaFila, 100);
  assert.deepEqual(s7.categoriasParadas, ['Beleza (perfumes)']);
  assert.equal(s7.funil['@promobigodeperfumes'].aceitas, 2);
  assert.deepEqual(s7.awin.pendentes, { vendas: 1, comissao: 5.5 });
  assert.deepEqual(s7.awin.aprovadas, { vendas: 0, comissao: 0 });
  assert.deepEqual(p.membros.Perfumes, { atual: 12, dia: 2, semana: 8, inicio: 8, desde: '2026-10-07' });
  assert.equal(p.periodos.hoje.grupos.Perfumes.publicadas, 2);

  const texto = textoDoPainel(p, '7d');
  assert.match(texto, /Perfumes: 3 publicadas/);
  assert.match(texto, /recusadas na busca/);
  assert.match(texto, /barradas na hora de postar/);
  assert.match(texto, /pendente R\$\s?5,50/);
  assert.match(texto, /inclui você e o bot/);
  assert.match(texto, /ver no painel do ML/);
  assert.match(texto, /só recusa/);
});

test('painel sem nenhum dado ainda: gera texto e página sem quebrar', () => {
  const base = pasta();
  const p = montarPainel({ base, store: storeVazio, eventos: [], agora: AGORA });
  assert.match(textoDoPainel(p, '7d'), /Ainda não há dados neste período/);
  gravarSite(p, base);
  assert.deepEqual(fs.readdirSync(pastaSite(base)).sort(), ['_headers', 'dados.json', 'index.html', 'robots.txt']);
  assert.ok(fs.existsSync(path.join(base, 'relatorio.html')));
});

test('site publicado: sem token, cookie, chat id, e-mail nem link de afiliado; noindex; menos de 500 KB; hash ignora só a hora', () => {
  const base = montarBase();
  // nome de produto "malicioso" não vira HTML (o navegador escapa) nem leva link
  const eventos = [pub('2026-10-14', { nome: '<img src=x onerror=alert(1)> Perfume' })];
  const p = montarPainel({ base, store: storeVazio, eventos, agora: AGORA });
  const h1 = gravarSite(p, base);
  const pasta = pastaSite(base);
  const tudo = fs.readdirSync(pasta).map((f) => fs.readFileSync(path.join(pasta, f), 'utf8')).join('\n');
  assert.doesNotMatch(tudo, /meli\.la|tidd\.ly|awin1\.com|matt_word|[?&]tag=|cookie|token|-100\d{6,}|\b\d{8,10}:[\w-]{30,}|[\w.+-]+@[\w-]+\.[\w.]+/i);
  assert.doesNotMatch(fs.readFileSync(path.join(pasta, 'index.html'), 'utf8'), /<img src=x/);
  assert.match(fs.readFileSync(path.join(pasta, '_headers'), 'utf8'), /X-Robots-Tag: noindex/);
  assert.match(fs.readFileSync(path.join(pasta, 'robots.txt'), 'utf8'), /Disallow: \//);
  assert.ok(fs.statSync(path.join(pasta, 'index.html')).size < 500_000);
  assert.equal(gravarSite({ ...p, hora: 'outra', atualizadoEm: 'x' }, base), h1);
  assert.notEqual(gravarSite(montarPainel({ base, store: storeVazio, eventos: [...eventos, pub('2026-10-14')], agora: AGORA }), base), h1);
});
