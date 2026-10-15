/**
 * Analytics no Telegram do dono (nunca nos grupos): 3 a 5 linhas de destaque no resumo das 22h e um resumo da
 * semana toda segunda às 9h. Textos curtos, números redondos. O Telegram aceita até 4096 caracteres por mensagem:
 * o que passar disso é cortado com "…" (o resto está no painel).
 */
const brl = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const sinal = (n) => (n == null ? '' : n > 0 ? ` (+${n})` : n < 0 ? ` (${n})` : ' (=)');
export const LIMITE_TELEGRAM = 3900; // folga para a conversão em HTML (&amp; etc.)

/** Corta no fim de uma linha, com "…" e o aviso de que o resto está no painel. */
export function cortar(texto, limite = LIMITE_TELEGRAM) {
  if (texto.length <= limite) return texto;
  const fim = '\n… (o resto está no painel)';
  const corte = texto.lastIndexOf('\n', limite - fim.length);
  return texto.slice(0, corte > 0 ? corte : limite - fim.length) + fim;
}

/** Fontes somadas entre os grupos: { nome: { publicadas, naFila, recusadas } }. */
function fontesSomadas(periodo) {
  const t = {};
  for (const G of Object.values(periodo?.grupos || {})) {
    for (const [nome, F] of Object.entries(G.fontes)) {
      const x = (t[nome] ??= { publicadas: 0, naFila: 0, recusadas: 0 });
      x.publicadas += F.publicadas;
      x.naFila += F.naFila;
      x.recusadas += F.recusadas;
    }
  }
  return t;
}

function melhorEPior(periodo) {
  const fontes = Object.entries(fontesSomadas(periodo));
  const melhor = fontes.filter(([, f]) => f.publicadas).sort((a, b) => b[1].publicadas - a[1].publicadas)[0] || null;
  // Pior: a que mais recusa sem trazer nada para a fila (ou com o menor aproveitamento entre as que recusam muito).
  const candidatas = fontes.filter(([, f]) => f.recusadas >= 20).map(([n, f]) => [n, f, f.naFila / (f.naFila + f.recusadas)]);
  const pior = candidatas.sort((a, b) => a[2] - b[2] || b[1].recusadas - a[1].recusadas)[0] || null;
  return { melhor, pior: pior && pior[2] < 0.1 ? pior : null };
}

const linhaMembros = (membros, chave) => {
  const partes = Object.entries(membros || {}).map(([g, m]) => `${g} ${m.atual}${sinal(m[chave])}`);
  return partes.length ? `👥 Membros${chave === 'semana' ? ' (na semana)' : ' (hoje)'}: ${partes.join(' · ')} — inclui você e o bot` : null;
};

/** 3 a 5 linhas para o fim do resumo das 22h. */
export function destaquesDoDia(painel, { url = null } = {}) {
  const semana = painel.periodos['7d'];
  const hoje = painel.periodos.hoje;
  const linhas = [];
  const { melhor, pior } = melhorEPior(semana);
  if (melhor) linhas.push(`🥇 Melhor fonte (7 dias): ${melhor[0]} — ${melhor[1].publicadas} publicadas`);
  if (pior) linhas.push(`🪫 Fonte que quase não aproveita (7 dias): ${pior[0]} — ${pior[1].recusadas} recusadas, ${pior[1].naFila} na fila`);
  const membros = linhaMembros(painel.membros, 'dia');
  if (membros) linhas.push(membros);
  const vazias = Object.entries(hoje?.grupos || {}).filter(([, G]) => G.filaVazia).map(([g, G]) => `${g} ${G.filaVazia}x`);
  if (vazias.length) linhas.push(`🕳️ Fila vazia na hora de postar hoje: ${vazias.join(', ')}`);
  const aw = semana?.awin;
  if (aw && (aw.cliques || aw.pendentes.comissao || aw.aprovadas.comissao)) linhas.push(`💰 Awin (7 dias): ${aw.cliques} cliques · ${brl(aw.pendentes.comissao)} pendente · ${brl(aw.aprovadas.comissao)} aprovado`);
  const saida = linhas.slice(0, 5);
  if (url) saida.push(`📊 Painel: ${url}`);
  return saida;
}

/** Resumo da semana (segunda, 9h). */
export function resumoSemanal(painel, { url = null } = {}) {
  const s = painel.periodos['7d'];
  const grupos = Object.entries(s?.grupos || {}).sort((a, b) => b[1].publicadas - a[1].publicadas);
  const total = grupos.reduce((n, [, G]) => n + G.publicadas, 0);
  const l = ['📅 *Resumo da semana*', '', `📤 Ofertas publicadas: *${total}*`];
  for (const [g, G] of grupos) l.push(`   • ${g}: ${G.publicadas}${G.filaVazia ? ` (fila vazia ${G.filaVazia}x)` : ''}`);
  const { melhor, pior } = melhorEPior(s);
  if (melhor) l.push('', `🥇 Melhor fonte: ${melhor[0]} — ${melhor[1].publicadas} publicadas`);
  if (pior) l.push(`🪫 Fonte que quase não aproveita: ${pior[0]} — ${pior[1].recusadas} recusadas, ${pior[1].naFila} na fila`);
  const canais = Object.entries(s?.funil || {}).sort((a, b) => b[1].aceitas - a[1].aceitas);
  if (canais.length) l.push('', '📡 Canais acompanhados (lidas → aceitas):', ...canais.slice(0, 6).map(([c, f]) => `   • ${c}: ${f.lidas} → ${f.aceitas}`));
  if (s?.categoriasParadas?.length) l.push('', `💤 Categorias do ML sem nenhuma publicação: ${s.categoriasParadas.slice(0, 5).join(', ')}${s.categoriasParadas.length > 5 ? '…' : ''}`);
  const membros = linhaMembros(painel.membros, 'semana');
  if (membros) l.push('', membros);
  if (s?.awin) l.push('', `💰 Awin: ${s.awin.cliques} cliques · ${brl(s.awin.pendentes.comissao)} pendente · ${brl(s.awin.aprovadas.comissao)} aprovado`);
  l.push(`🛒 Mercado Livre: ver no painel do ML — ${painel.painelML}`);
  if (url) l.push('', `📊 Painel completo: ${url}`);
  return cortar(l.join('\n'));
}
