import { test } from 'node:test';
import assert from 'node:assert/strict';

const { porcento, aproveitamento, mediaPonderada, regrasDoGrupo, queda, funilDasFontes, montarPeriodo, lojaDaCategoria, coresDosGrupos, LIMITES } = await import('../src/analytics/produtos.js');
const { htmlDoPainel } = await import('../src/analytics/pagina.js');

const G = (extra = {}) => ({ publicadas: 0, naFila: 0, recusadas: 0, barradas: 0, duplicados: 0, incertos: 0, erros: 0, filaVazia: 0, filaFim: null, porDia: {}, porHora: {}, fontes: {}, ...extra });
const DIAS = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'];
const HOJE = '2026-10-21';

test('fórmulas: porcentagem e aproveitamento sem dividir por zero; média ponderada ignora vazio e peso zero', () => {
  assert.equal(porcento(1, 0), null);
  assert.equal(porcento(0, 0), null);
  assert.equal(porcento(1, 3), 33.3);
  assert.equal(aproveitamento(1228, 2276), 54);
  assert.equal(aproveitamento(5, 0), null);
  // 476 a 40% e 341 a 42%: ponderado, não a média simples (41)
  assert.equal(mediaPonderada([[40, 476], [42, 341]]), 40.8);
  assert.equal(mediaPonderada([[null, 10], [30, 0], [50, 2]]), 50);
  assert.equal(mediaPonderada([[null, 10]]), null);
  assert.equal(mediaPonderada([]), null);
});

test('regras: pausado não alerta; parado ≥ 48 h com sobra ou outros publicando = crítico; antes disso não', () => {
  assert.deepEqual(regrasDoGrupo(G({ filaFim: 264 }), { nome: 'Geral', ativo: false, horasSemPublicar: 200 }), { status: { rotulo: 'Pausado', nivel: 'info' }, alertas: [] });
  const parado = regrasDoGrupo(G({ filaFim: 264, incertos: 6 }), { nome: 'Geral', horasSemPublicar: 49, desde: '15/10 21:57' });
  assert.equal(parado.status.rotulo, 'Parado');
  assert.equal(parado.alertas[0].nivel, 'critico');
  assert.match(parado.alertas[0].detalhe, /15\/10 21:57 · 264 ofertas sobrando na fila · 6 envios sem confirmação/);
  assert.equal(regrasDoGrupo(G({ filaFim: 0 }), { nome: 'X', horasSemPublicar: 60, outrosPublicaram: true }).status.rotulo, 'Parado');
  assert.equal(regrasDoGrupo(G({ filaFim: 0 }), { nome: 'X', horasSemPublicar: 60, outrosPublicaram: false }).status.rotulo, 'Normal', 'ninguém publicou e nada sobrou: não é o grupo');
  assert.equal(regrasDoGrupo(G({ filaFim: 10 }), { nome: 'X', horasSemPublicar: 47.9 }).alertas.length, 0);
  assert.equal(regrasDoGrupo(G({ filaFim: 10 }), { nome: 'X', horasSemPublicar: null }).alertas.length, 0, 'sem registro de publicação não inventa');
});

test('regras: barradas > 10% = alto (10% exato não); fila vazia > 100 ou > 20% = atenção', () => {
  assert.equal(regrasDoGrupo(G({ naFila: 100, barradas: 10 }), { nome: 'F' }).alertas.length, 0);
  const alto = regrasDoGrupo(G({ naFila: 493, barradas: 101 }), { nome: 'Fitness' });
  assert.equal(alto.status.rotulo, 'Barradas altas');
  assert.match(alto.alertas[0].detalhe, /101 barradas de 493 que entraram na fila \(20,5%\)/);
  assert.equal(regrasDoGrupo(G({ naFila: 0, barradas: 5 }), { nome: 'F' }).alertas.length, 0, 'sem fila: sem divisão por zero');
  assert.equal(regrasDoGrupo(G({ filaVazia: 101, publicadas: 2000 }), { nome: 'B' }).status.rotulo, 'Falta oferta');
  assert.equal(regrasDoGrupo(G({ filaVazia: 30, publicadas: 100 }), { nome: 'B' }).status.rotulo, 'Falta oferta', '23% das tentativas');
  assert.equal(regrasDoGrupo(G({ filaVazia: 20, publicadas: 100 }), { nome: 'B' }).status.rotulo, 'Normal');
  assert.equal(LIMITES.paradoHoras, 48);
});

test('regras: queda compara o último dia COMPLETO com a média; hoje (parcial) fica de fora', () => {
  const porDia = { '2026-10-15': 84, '2026-10-16': 34, '2026-10-17': 10, '2026-10-18': 3, '2026-10-19': 3, '2026-10-20': 4, '2026-10-21': 0 };
  const q = queda(porDia, DIAS, HOJE);
  assert.deepEqual(q, { media: 23, ultimo: 4, dia: '2026-10-20', caiu: true });
  const r = regrasDoGrupo(G({ porDia, publicadas: 138 }), { nome: 'Perfumes', dias: DIAS, hoje: HOJE });
  assert.equal(r.status.rotulo, 'Em queda');
  assert.match(r.alertas[0].detalhe, /De 23 para 4 por dia \(20\/10\)/);
  assert.equal(queda({ '2026-10-21': 5 }, ['2026-10-21'], HOJE), null, 'só hoje: sem base');
  assert.equal(queda({}, DIAS, HOJE), null, 'média zero: sem base');
  assert.equal(queda({ a: 10, b: 3 }, ['a', 'b'], HOJE).caiu, false, '3 de média 6,5 não é < 25%');
});

test('fontes: canais e buscas no mesmo funil, ordenados pelas que mais trazem; motivos somados entre grupos', () => {
  const P = {
    funil: { '@canal': { lidas: 100, comLink: 50, aceitas: 10, motivos: { 'limite por hora': 5 } } },
    grupos: {
      Beleza: G({ fontes: { 'Shopee: Beleza': { naFila: 30, recusadas: 70, publicadas: 25, recusas: { 'desconto baixo': 40, 'sem marca da lista': 30 } }, '@canal': { naFila: 9, publicadas: 9 } } }),
      Fitness: G({ fontes: { 'Shopee: Beleza': { naFila: 0, recusadas: 10, publicadas: 0, recusas: { 'desconto baixo': 10 } } } }),
    },
  };
  const f = funilDasFontes(P);
  assert.deepEqual(f.map((x) => [x.nome, x.tipo, x.total, x.meio, x.fim]), [['Shopee: Beleza', 'busca', 110, 30, 25], ['@canal', 'canal', 100, 50, 10]]);
  assert.deepEqual(f[0].motivos, [['desconto baixo', 50], ['sem marca da lista', 30]]);
  assert.equal(f[0].taxa, 22.7);
  assert.deepEqual(funilDasFontes({}), []);
});

test('período completo: KPIs ponderados, série empilhada, funil, alertas ordenados, grupo sem dados não quebra', () => {
  const P = {
    dias: DIAS,
    diasComDado: DIAS.slice(0, 6),
    awin: { cliques: 12, aprovadas: { comissao: 3.5 }, pendentes: { comissao: 8 } },
    categorias: { 'Beleza e Cuidado Pessoal': { encontrados: 900, aceitos: 40 }, 'Shopee: Beleza': { encontrados: 300, aceitos: 80 } },
    funil: {},
    grupos: {
      Beleza: G({ publicadas: 476, naFila: 600, recusadas: 1000, filaVazia: 214, descontoMedio: 40, precoMedio: 100, porDia: { '2026-10-15': 100, '2026-10-20': 50 }, fontes: { 'Shopee: Beleza': { publicadas: 10, naFila: 10, recusadas: 0 } } }),
      Fitness: G({ publicadas: 341, naFila: 500, recusadas: 900, barradas: 101, descontoMedio: 42, precoMedio: 300, porDia: { '2026-10-15': 60, '2026-10-20': 40 } }),
    },
  };
  const ctx = {
    gruposConfig: [{ nome: 'Beleza', ativo: true }, { nome: 'Fitness', ativo: true }, { nome: 'Geral', ativo: false }, { nome: 'Perfumes', ativo: true }],
    categoriasAtivas: [{ nome: 'Beleza e Cuidado Pessoal', loja: 'Mercado Livre' }, { nome: 'Shopee: Beleza', loja: 'Shopee' }],
    membros: { Beleza: { atual: 5 }, Perfumes: { atual: 1 } },
    hoje: HOJE,
    agora: new Date('2026-10-21T15:00:00Z'),
    ultimaPublicacao: { Beleza: '2026-10-21T14:00:00Z', Fitness: '2026-10-21T13:00:00Z' },
  };
  const R = montarPeriodo('7d', P, ctx);
  assert.equal(R.kpis.publicadas, 817);
  assert.equal(R.kpis.mediaDia, 136.2); // 817 em 6 dias com dados
  assert.equal(R.kpis.aproveitamento, 74.3); // 817 de 1100
  assert.equal(R.kpis.descontoMedio, 40.8);
  assert.equal(R.kpis.precoMedio, 183.5);
  assert.deepEqual([R.kpis.precoMin.grupo, R.kpis.precoMax.grupo], ['Beleza', 'Fitness']);
  assert.deepEqual(R.kpis.awin, { cliques: 12, aprovado: 3.5, pendente: 8 });
  assert.deepEqual(R.serie.rotulos[0], '15/10');
  assert.deepEqual(R.serie.totais, [160, 0, 0, 0, 0, 90, 0]);
  assert.deepEqual(R.serie.pico, { rotulo: '15/10', total: 160 });
  assert.deepEqual(R.funil, { avaliadas: 3000, naFila: 1100, publicadas: 817, pctFila: 36.7, pctPublicadas: 74.3, barradas: 101, duplicados: 0, incertos: 0, erros: 0 });
  assert.deepEqual(R.alertas.map((a) => a.nivel), ['alto', 'atencao', 'aviso']);
  assert.equal(R.alertas[2].titulo, '1 categoria sem nenhuma publicação');
  assert.deepEqual(R.categoriasSemPublicacao, [{ nome: 'Beleza e Cuidado Pessoal', loja: 'Mercado Livre' }]);
  const porNome = Object.fromEntries(R.grupos.map((g) => [g.nome, g]));
  assert.deepEqual(R.grupos.map((g) => g.nome), ['Beleza', 'Fitness', 'Geral', 'Perfumes']);
  assert.equal(porNome.Geral.status.rotulo, 'Pausado');
  assert.equal(porNome.Perfumes.publicadas, 0); // configurado, sem dados no período
  assert.equal(porNome.Perfumes.aprovFila, null);
  assert.equal(porNome.Perfumes.membrosReais, 0);
  assert.equal(porNome.Beleza.membrosReais, 3); // sem você e o bot
  assert.equal(porNome.Beleza.pctTotal, 58.3);
  assert.equal(porNome.Beleza.filaVaziaAlta, true);

  const hoje = montarPeriodo('hoje', { ...P, dias: [HOJE], diasComDado: [HOJE] }, ctx);
  assert.equal(hoje.serie.tipo, 'hora');
  assert.equal(hoje.serie.rotulos.length, 14);
  assert.deepEqual(hoje.categoriasSemPublicacao, []);

  const vazio = montarPeriodo('30d', { dias: [], grupos: {}, funil: {} }, { hoje: HOJE });
  assert.deepEqual([vazio.kpis.publicadas, vazio.kpis.aproveitamento, vazio.kpis.descontoMedio, vazio.kpis.precoMin, vazio.kpis.awin, vazio.serie.pico], [0, null, null, null, null, null]);
  assert.deepEqual(vazio.alertas, []);
});

test('cores e lojas: rosa só na Beleza, grupos novos em cinza; loja pela categoria', () => {
  const c = coresDosGrupos(['Beleza', 'Fitness', 'Geral', 'Perfumes', 'Casa']);
  assert.equal(c.Beleza, '#d27d99');
  assert.notEqual(c.Casa, '#d27d99');
  assert.equal(lojaDaCategoria('Shopee: Beleza'), 'Shopee');
  assert.equal(lojaDaCategoria('Perfumes (relâmpago)'), 'Mercado Livre');
});

test('página: tokens do tema, período e abas acessíveis, dados escapados, sem número fixo', () => {
  const painel = { hora: '21/10, 11:32', periodos: { hoje: {}, '7d': {}, '30d': {} }, analytics: { '7d': { nGrupos: 1 } } };
  const html = htmlDoPainel({ ...painel, notas: [], extra: '</script><script>alert(1)</script>' });
  assert.match(html, /--bg:#121111/);
  assert.match(html, /--accent:#d27d99/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Achadinhos da Vic<span class="estrela" aria-hidden="true">✦<\/span>/);
  assert.doesNotMatch(html, /<\/script><script>alert/, 'dados não fecham o script');
  assert.doesNotMatch(html.split('<script type="application/json"')[0], /1\.228|1\.043|41,2/);
});
