/**
 * Analytics de produtos — o objeto completo que a tela mostra, por período (hoje / 7d / 30d). Tudo é calculado
 * aqui, a partir do agregado do relatorio.js; a página (pagina.js) só desenha. Nenhum número é inventado: o que
 * não existe nos dados vem como null e a tela mostra "sem dados no período".
 */

/** Limites dos alertas e dos status (pedido do dono, 21/10/2026). */
export const LIMITES = {
  paradoHoras: 48, // crítico: grupo ligado sem publicar há tanto tempo
  barradasPct: 10, // alto: barradas ao postar ÷ entraram na fila
  filaVaziaHorarios: 100, // atenção: horários de envio com a fila vazia no período...
  filaVaziaPct: 20, // ...ou essa fração das tentativas de envio
  quedaPct: 25, // atenção: último dia completo abaixo desta fração da média diária
  sobraAlta: 100, // tabela: sobra na fila em vermelho acima disto
};

export const NIVEIS = ['critico', 'alto', 'atencao', 'aviso', 'info', 'ok'];
const ROTULO_NIVEL = { critico: 'Crítico', alto: 'Alto', atencao: 'Atenção', aviso: 'Aviso', info: 'Info', ok: 'Normal' };

/** Cores dos grupos (diferem em claridade): o rosa só no primeiro; grupos novos seguem a escala de cinzas. */
const CORES = { Beleza: '#d27d99', Fitness: '#bdb6b1', Geral: '#827c78', Perfumes: '#534e4b' };
const CINZAS_EXTRAS = ['#a39d99', '#6b6562', '#45403e', '#3a3634'];
export const ORDEM_GRUPOS = ['Beleza', 'Fitness', 'Geral', 'Perfumes'];

export function coresDosGrupos(nomes) {
  const cores = {};
  let extra = 0;
  for (const n of nomes) cores[n] = CORES[n] || CINZAS_EXTRAS[extra++ % CINZAS_EXTRAS.length];
  return cores;
}

const redondo1 = (n) => Math.round(n * 10) / 10;

/** Parte ÷ todo em % (1 casa), ou null quando o todo é zero ou não existe. */
export function porcento(parte, todo) {
  return todo > 0 && Number.isFinite(parte) ? redondo1((parte / todo) * 100) : null;
}

/** Média ponderada de [valor, peso]; ignora valor nulo e peso zero. null se não sobra nada. */
export function mediaPonderada(pares) {
  const validos = pares.filter(([v, p]) => typeof v === 'number' && Number.isFinite(v) && p > 0);
  const peso = validos.reduce((s, [, p]) => s + p, 0);
  return peso ? redondo1(validos.reduce((s, [v, p]) => s + v * p, 0) / peso) : null;
}

/** Aproveitamento da fila: publicadas ÷ entraram na fila (%). */
export const aproveitamento = (publicadas, naFila) => porcento(publicadas, naFila);

/** Loja de uma categoria de busca, pelo nome ("Shopee: Beleza", "Amazon: ...", "Awin: ..."; o resto é ML). */
export function lojaDaCategoria(nome) {
  const m = String(nome).match(/^(Shopee|Amazon|Awin):/);
  return m ? m[1] : 'Mercado Livre';
}

const ddmm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const HORAS = Array.from({ length: 14 }, (_, i) => String(i + 8).padStart(2, '0')); // envios das 8h às 21h

/**
 * Dias completos do período (hoje ainda não acabou) e a comparação do último deles com a média diária.
 * null quando não há base (menos de 2 dias completos, ou média zero).
 */
export function queda(porDia, dias, hoje) {
  const completos = dias.filter((d) => d !== hoje);
  if (completos.length < 2) return null;
  const media = completos.reduce((s, d) => s + (porDia[d] || 0), 0) / completos.length;
  if (!media) return null;
  const ultimo = porDia[completos.at(-1)] || 0;
  return { media: redondo1(media), ultimo, dia: completos.at(-1), caiu: ultimo < media * (LIMITES.quedaPct / 100) };
}

/**
 * Regras de alerta de um grupo (seção "Pontos de atenção"). Devolve a lista de alertas do grupo, do mais grave
 * para o menos; o status do grupo é o primeiro deles (ou Normal / Pausado).
 */
export function regrasDoGrupo(G, { nome, ativo = true, horasSemPublicar = null, desde = null, outrosPublicaram = false, dias = [], hoje = null }) {
  if (!ativo) return { status: { rotulo: 'Pausado', nivel: 'info' }, alertas: [] };
  const alertas = [];
  const sobra = G.filaFim ?? 0;
  if (horasSemPublicar != null && horasSemPublicar >= LIMITES.paradoHoras && (sobra > 0 || outrosPublicaram)) {
    alertas.push({
      nivel: 'critico', grupo: nome, status: 'Parado',
      titulo: `${nome} sem publicar há ${Math.floor(horasSemPublicar / 24)} dias`,
      detalhe: [desde ? `Última publicação em ${desde}` : 'Nenhuma publicação registrada', `${sobra} ofertas sobrando na fila`, `${G.incertos || 0} envios sem confirmação`].join(' · '),
      acao: { rotulo: 'Ver mapeamento', aba: 'fontes' },
    });
  }
  const pctBarradas = porcento(G.barradas || 0, G.naFila || 0);
  if (pctBarradas != null && pctBarradas > LIMITES.barradasPct) {
    alertas.push({
      nivel: 'alto', grupo: nome, status: 'Barradas altas',
      titulo: `${nome}: muitas ofertas barradas ao postar`,
      detalhe: `${G.barradas} barradas de ${G.naFila} que entraram na fila (${String(pctBarradas).replace('.', ',')}%)`,
      acao: { rotulo: 'Ver regras', aba: 'grupos' },
    });
  }
  const tentativas = (G.filaVazia || 0) + (G.publicadas || 0);
  const pctVazia = porcento(G.filaVazia || 0, tentativas);
  if ((G.filaVazia || 0) > LIMITES.filaVaziaHorarios || (pctVazia != null && pctVazia > LIMITES.filaVaziaPct)) {
    alertas.push({
      nivel: 'atencao', grupo: nome, status: 'Falta oferta',
      titulo: `${nome}: fila vazia em ${G.filaVazia} horários de envio`,
      detalhe: `${String(pctVazia ?? 0).replace('.', ',')}% das tentativas de envio sem oferta · ${G.recusadas || 0} recusadas na busca`,
      acao: { rotulo: 'Ajustar filtros', aba: 'grupos' },
    });
  }
  const q = queda(G.porDia || {}, dias, hoje);
  if (q?.caiu) {
    alertas.push({
      nivel: 'atencao', grupo: nome, status: 'Em queda',
      titulo: `${nome}: publicações em queda`,
      detalhe: `De ${String(q.media).replace('.', ',')} para ${q.ultimo} por dia (${ddmm(q.dia)})`,
      acao: { rotulo: 'Ver fontes', aba: 'fontes' },
    });
  }
  const primeiro = alertas[0];
  return { status: primeiro ? { rotulo: primeiro.status, nivel: primeiro.nivel } : { rotulo: 'Normal', nivel: 'ok' }, alertas };
}

/** Funil de cada fonte: canais (lidas → com link → aceitas) e buscas próprias (avaliadas → na fila → publicadas). */
export function funilDasFontes(P) {
  const lista = [];
  for (const [nome, f] of Object.entries(P.funil || {})) {
    lista.push({ nome, tipo: 'canal', total: f.lidas || 0, meio: f.comLink || 0, fim: f.aceitas || 0, motivos: { ...(f.motivos || {}) } });
  }
  const canais = new Set(lista.map((f) => f.nome));
  const buscas = {};
  for (const G of Object.values(P.grupos || {})) {
    for (const [nome, F] of Object.entries(G.fontes || {})) {
      if (canais.has(nome)) continue;
      const x = (buscas[nome] ??= { nome, tipo: 'busca', total: 0, meio: 0, fim: 0, motivos: {} });
      x.total += (F.naFila || 0) + (F.recusadas || 0);
      x.meio += F.naFila || 0;
      x.fim += F.publicadas || 0;
      for (const [m, n] of Object.entries(F.recusas || {})) x.motivos[m] = (x.motivos[m] || 0) + n;
    }
  }
  lista.push(...Object.values(buscas));
  return lista
    .map((f) => ({ ...f, taxa: porcento(f.fim, f.total), motivos: Object.entries(f.motivos).sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => b.fim - a.fim || b.meio - a.meio || b.total - a.total);
}

/** Categorias de busca ligadas hoje: quanto cada uma trouxe no período e quanto publicou. */
export function categoriasDoPeriodo(P, categoriasAtivas) {
  const publicadas = {};
  for (const G of Object.values(P.grupos || {})) {
    for (const [fn, F] of Object.entries(G.fontes || {})) {
      const cat = fn.startsWith('Mercado Livre: ') ? fn.slice(15) : fn.startsWith('Shopee: ') ? fn : null;
      if (cat) publicadas[cat] = (publicadas[cat] || 0) + (F.publicadas || 0);
    }
  }
  return categoriasAtivas.map(({ nome, loja }) => ({
    nome,
    loja,
    encontrados: P.categorias?.[nome]?.encontrados ?? 0,
    aceitos: P.categorias?.[nome]?.aceitos ?? 0,
    publicadas: publicadas[nome] || 0,
  }));
}

/**
 * Um período inteiro. `ctx`: gruposConfig [{nome, ativo}], ultimaPublicacao {grupo: ISO}, categoriasAtivas
 * [{nome, loja}], membros (painel.membros), painelML, hoje ("AAAA-MM-DD"), agora (Date).
 */
export function montarPeriodo(periodo, P, ctx) {
  const { gruposConfig = [], ultimaPublicacao = {}, categoriasAtivas = [], membros = {}, painelML = null, hoje = null, agora = new Date() } = ctx;
  const dias = P.dias || [];
  const ativoDe = Object.fromEntries(gruposConfig.map((g) => [g.nome, g.ativo !== false]));
  const nomes = [...new Set([...gruposConfig.map((g) => g.nome), ...Object.keys(P.grupos || {})])].sort(
    (a, b) => (ORDEM_GRUPOS.indexOf(a) + 1 || 99) - (ORDEM_GRUPOS.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );
  const cores = coresDosGrupos(nomes);
  const G = (n) => P.grupos?.[n] || { publicadas: 0, naFila: 0, recusadas: 0, barradas: 0, duplicados: 0, incertos: 0, erros: 0, filaVazia: 0, filaFim: null, porDia: {}, porHora: {}, fontes: {} };
  const total = nomes.reduce((s, n) => s + (G(n).publicadas || 0), 0);
  const naFila = nomes.reduce((s, n) => s + (G(n).naFila || 0), 0);
  const recusadas = nomes.reduce((s, n) => s + (G(n).recusadas || 0), 0);

  // KPIs
  const comPreco = nomes.filter((n) => G(n).precoMedio != null && G(n).publicadas > 0);
  const menor = comPreco.reduce((m, n) => (!m || G(n).precoMedio < G(m).precoMedio ? n : m), null);
  const maior = comPreco.reduce((m, n) => (!m || G(n).precoMedio > G(m).precoMedio ? n : m), null);
  const diasComDado = (P.diasComDado || []).length;
  const kpis = {
    publicadas: total,
    mediaDia: diasComDado ? redondo1(total / diasComDado) : null,
    diasComDado,
    aproveitamento: aproveitamento(total, naFila),
    naFila,
    descontoMedio: mediaPonderada(nomes.map((n) => [G(n).descontoMedio, G(n).publicadas])),
    precoMedio: mediaPonderada(nomes.map((n) => [G(n).precoMedio, G(n).publicadas])),
    precoMin: menor ? { valor: G(menor).precoMedio, grupo: menor } : null,
    precoMax: maior ? { valor: G(maior).precoMedio, grupo: maior } : null,
    awin: P.awin ? { cliques: P.awin.cliques, aprovado: P.awin.aprovadas.comissao, pendente: P.awin.pendentes.comissao } : null,
  };

  // Publicações por dia (ou por hora, em "hoje"), empilhadas por grupo
  const porHora = periodo === 'hoje';
  const chaves = porHora ? HORAS : dias;
  const valores = Object.fromEntries(nomes.map((n) => [n, chaves.map((k) => (porHora ? G(n).porHora?.[k] : G(n).porDia?.[k]) || 0)]));
  const totais = chaves.map((_, i) => nomes.reduce((s, n) => s + valores[n][i], 0));
  const iPico = totais.reduce((m, v, i) => (v > totais[m] ? i : m), 0);
  const serie = {
    tipo: porHora ? 'hora' : 'dia',
    rotulos: chaves.map((k) => (porHora ? `${k}h` : ddmm(k))),
    grupos: nomes,
    valores,
    totais,
    pico: totais[iPico] > 0 ? { rotulo: porHora ? `${chaves[iPico]}h` : ddmm(chaves[iPico]), total: totais[iPico] } : null,
  };

  // Funil de ofertas
  const soma = (k) => nomes.reduce((s, n) => s + (G(n)[k] || 0), 0);
  const funil = {
    avaliadas: naFila + recusadas,
    naFila,
    publicadas: total,
    pctFila: porcento(naFila, naFila + recusadas),
    pctPublicadas: porcento(total, naFila),
    barradas: soma('barradas'),
    duplicados: soma('duplicados'),
    incertos: soma('incertos'),
    erros: soma('erros'),
  };

  // Grupos: regras, status, tabela e cartões
  const alertas = [];
  const grupos = nomes.map((nome) => {
    const g = G(nome);
    const ultima = ultimaPublicacao[nome] ? new Date(ultimaPublicacao[nome]) : null;
    const horasSemPublicar = ultima ? (agora - ultima) / 3_600_000 : null;
    const desde = ultima ? ultima.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: ctx.tz || 'America/Sao_Paulo' }).replace(',', '') : null;
    const outrosPublicaram = nomes.some((o) => o !== nome && G(o).publicadas > 0);
    const r = regrasDoGrupo(g, { nome, ativo: ativoDe[nome] ?? true, horasSemPublicar, desde, outrosPublicaram, dias, hoje });
    alertas.push(...r.alertas);
    const m = membros[nome];
    return {
      nome,
      cor: cores[nome],
      ativo: ativoDe[nome] ?? true,
      status: r.status,
      publicadas: g.publicadas || 0,
      pctTotal: porcento(g.publicadas || 0, total),
      aprovFila: aproveitamento(g.publicadas || 0, g.naFila || 0),
      desconto: g.descontoMedio ?? null,
      preco: g.precoMedio ?? null,
      cupom: g.pctCupom ?? null,
      frete: g.pctFreteGratis ?? null,
      full: g.pctFull ?? null,
      filaVazia: g.filaVazia || 0,
      filaVaziaAlta: (g.filaVazia || 0) > LIMITES.filaVaziaHorarios,
      sobra: g.filaFim ?? null,
      sobraAlta: (g.filaFim ?? 0) > LIMITES.sobraAlta,
      sparkline: dias.map((d) => g.porDia?.[d] || 0),
      fontes: Object.keys(g.fontes || {}).length,
      recusadas: g.recusadas || 0,
      naFila: g.naFila || 0,
      barradas: g.barradas || 0,
      duplicados: g.duplicados || 0,
      incertos: g.incertos || 0,
      erros: g.erros || 0,
      membrosReais: m?.atual != null ? Math.max(0, m.atual - 2) : null, // sem você e o bot
    };
  });

  const categorias = categoriasDoPeriodo(P, categoriasAtivas);
  const semPublicacao = periodo === 'hoje' ? [] : categorias.filter((c) => !c.publicadas);
  if (semPublicacao.length) {
    alertas.push({
      nivel: 'aviso', grupo: null, status: null,
      titulo: `${semPublicacao.length} ${semPublicacao.length === 1 ? 'categoria' : 'categorias'} sem nenhuma publicação`,
      detalhe: semPublicacao.slice(0, 4).map((c) => c.nome).join(' · ') + (semPublicacao.length > 4 ? ` e mais ${semPublicacao.length - 4}` : ''),
      acao: { rotulo: 'Ver categorias', aba: 'categorias' },
    });
  }
  alertas.sort((a, b) => NIVEIS.indexOf(a.nivel) - NIVEIS.indexOf(b.nivel));

  return {
    periodo,
    inicio: dias[0] ? ddmm(dias[0]) : null,
    fim: dias.at(-1) ? ddmm(dias.at(-1)) : null,
    nGrupos: nomes.length,
    kpis,
    serie,
    funil,
    alertas: alertas.map((a) => ({ ...a, rotuloNivel: ROTULO_NIVEL[a.nivel] })),
    grupos,
    fontes: funilDasFontes(P),
    categorias,
    categoriasSemPublicacao: semPublicacao.map(({ nome, loja }) => ({ nome, loja })),
    monetizacao: {
      awinPendente: P.awin ? P.awin.pendentes.comissao : null,
      awinAprovado: P.awin ? P.awin.aprovadas.comissao : null,
      cliques: P.awin ? P.awin.cliques : null,
      mercadoLivre: null, // sem integração: a tela leva ao painel do ML
      painelML,
    },
  };
}

/** Os três períodos do painel. */
export function montarAnalytics(painel, ctx) {
  return Object.fromEntries(Object.entries(painel.periodos).map(([p, P]) => [p, montarPeriodo(p, P, { ...ctx, membros: painel.membros, painelML: painel.painelML })]));
}
