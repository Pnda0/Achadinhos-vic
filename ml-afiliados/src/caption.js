/**
 * Monta a mensagem do WhatsApp — mesmo formato do "criador de legendas" do curso,
 * com os extras que agora temos (cupom, frete, nota, oferta relâmpago).
 */
import { settings } from './config.js';
import { casaTermo, formatBRL, log, normalizar } from './util.js';

const TITULOS_PRONTOS = {
  alto: ['DESCONTÃO DE VERDADE 😱', 'CORRE QUE ACABA 🏃', 'QUEIMA TOTAL 🔥', 'BUGOU O PREÇO 🤯', 'METADE DO PREÇO 💸'],
  medio: ['ACHADINHO DO DIA 💎', 'OFERTA BOA DEMAIS 👀', 'BAIXOU O PREÇO 📉', 'VALE A PENA ✅', 'PROMO RELÂMPAGO ⚡'],
  baixo: ['OLHA ESSA OFERTA 👇', 'DESCONTINHO ESPERTO 😉', 'BOA PEDIDA 👍', 'ACHADO DO DIA 🛒'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Título pronto por faixa de desconto. `titulos` troca as listas padrão (ex.: as do nicho fitness). */
export function tituloPronto(p, titulos) {
  const d = p.descontoPct || 0;
  const faixa = d >= 50 ? 'alto' : d >= 25 ? 'medio' : 'baixo';
  const lista = titulos?.[faixa]?.length ? titulos[faixa] : TITULOS_PRONTOS[faixa];
  return pick(lista);
}

/** Títulos e tema que valem para ESTE produto: os do grupo, ou os gerais se ele for um "extra" do nicho. */
export function estiloDoProduto(p, grupo = {}) {
  const doTema = !grupo.termosTema || grupo.termosTema.some((t) => casaTermo(normalizar(p.nome), t));
  return doTema ? { titulos: grupo.titulos, tema: grupo.tema } : { titulos: null, tema: null };
}

/** Prompt adaptado do nó "CRIA UM TITULO CRIATIVO" do curso. */
export function promptTitulo(p, tema) {
  return `Você cria manchetes para canal brasileiro de ofertas (WhatsApp/Telegram).${tema ? `\nTema do canal: ${tema}.` : ''}

ESTILO: humor leve, popular, natural, "gente como a gente". Engraçado sem exagero.

TAREFA: gerar APENAS 1 manchete baseada no produto.

REGRAS:
- Máx. 4 palavras, em MAIÚSCULO
- Máx. 2 emojis
- Clara relação com o produto
- Humor simples OU frase direta (se o humor não encaixar)

PROIBIDO: duplo sentido; conteúdo sexual, agressivo ou confuso; hashtags, links ou qualquer texto extra.

LÓGICA: produto → principal benefício → frase curta (ou destacar o desconto alto)

ENTRADA:
Produto: ${p.nome}
Valor: ${formatBRL(p.precoAtual)}${p.precoOriginal ? `\nValor original: ${formatBRL(p.precoOriginal)}` : ''}${p.descontoPct ? `\nDesconto: ${p.descontoPct}%` : ''}

SAÍDA: somente a manchete.`;
}

/** Título com IA (API compatível com OpenAI). Sem chave ou com erro -> título pronto. */
export async function gerarTitulo(p, { titulos, tema, fetchImpl = fetch } = {}) {
  const { baseUrl, apiKey, model } = settings.llm;
  if (!apiKey) return tituloPronto(p, titulos);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        max_tokens: 30,
        messages: [{ role: 'user', content: promptTitulo(p, tema) }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const t = json.choices?.[0]?.message?.content?.split('\n')[0]?.replace(/["*#]/g, '').trim();
    if (!t || t.length > 60) throw new Error('resposta vazia/grande');
    return t.toUpperCase();
  } catch (e) {
    log(`  IA indisponível (${e.message}) — usando título pronto`);
    return tituloPronto(p, titulos);
  }
}

/** Nome curto: as 6 primeiras palavras (igual ao curso), sem cortar no meio de um hífen solto. */
export function nomeCurto(nome, palavras = 6) {
  return nome.split(/\s+/).slice(0, palavras).join(' ').replace(/[\s\-–,]+$/, '');
}

/** Hora (Brasília) em que o preço da Amazon foi consultado — a Amazon exige mostrar isso. */
export function horaConsulta(p) {
  const d = p.precoConsultadoEm ? new Date(p.precoConsultadoEm) : new Date();
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: settings.tz });
}

/** Nome da loja que aparece em cima do link. */
export const nomeLoja = (p) => (p.loja === 'amazon' ? 'Amazon' : p.loja === 'shopee' ? 'Shopee' : p.loja === 'awin' ? p.lojaNome || 'Loja parceira' : 'Mercado Livre');

/** Título de um cupom/promoção de loja parceira (não passa pela IA: precisa dizer a loja). */
export function tituloCupom(p) {
  return `${p.cupom ? 'CUPOM' : 'PROMO'} ${String(p.lojaNome || 'DA LOJA').toUpperCase()} ${p.cupom ? '🎟️' : '🔥'}`;
}

const diaMes = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: settings.tz });

/** Onde clicar: "🛒 Ver oferta no Mercado Livre:" + link. Loja parceira vira "na loja X" (o gênero do nome varia). */
function chamada(p, acao = 'Ver oferta') {
  const onde = p.loja === 'amazon' ? 'na Amazon' : p.loja === 'shopee' ? 'na Shopee' : p.loja === 'awin' ? `na loja ${nomeLoja(p)}` : 'no Mercado Livre';
  return `🛒 ${acao} ${onde}:\n${p.linkAfiliado}`;
}

/** Código de cupom em `monospace`: no Telegram, um toque copia. */
const linhaCodigo = (cupom) => `🎟️ Cupom: \`${cupom}\` (toque para copiar)`;

/** Cupom ou promoção de loja (Awin): o que é, o código, até quando vale e o link. */
function legendaCupom(p, { titulo, mensagemAdicional }) {
  return [
    `*${(titulo || tituloCupom(p)).toUpperCase()}*`,
    p.nome.slice(0, 140),
    p.descricao,
    [p.cupom && linhaCodigo(p.cupom), p.validade && `⏳ Vale até ${diaMes(p.validade)}`].filter(Boolean).join('\n'),
    chamada(p, p.cupom ? 'Usar o cupom' : 'Ver promoção'),
    mensagemAdicional,
  ]
    .filter((s) => s && s.trim())
    .join('\n\n');
}

/** Economia em reais só quando pesa (R$ 30 ou mais); abaixo disso o % já diz tudo. */
export const ECONOMIA_MINIMA = 30;

const centavos = (n) => Math.round(n * 100) / 100;

/** Valor de um cupom do ML em reais ("R$ 15 OFF com Cupom" -> 15). Cupom em % fica de fora: pode ter teto. */
export function valorCupomReais(cupom) {
  const m = String(cupom || '').match(/^R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*OFF/i);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

/** "⭐ 4,7 · +250 mil vendidos" — funciona com só a nota ou só as vendas. */
function linhaProva(p) {
  const nota = p.nota && p.nota >= 4 ? p.nota.toFixed(1).replace('.', ',') : null;
  const vendidos = p.vendidos ? p.vendidos.replace(/(\d)mil\b/i, '$1 mil') : null;
  if (nota) return `⭐ ${[nota, vendidos].filter(Boolean).join(' · ')}`;
  return vendidos && `🛍️ ${vendidos}`;
}

/**
 * Cupom do ML em reais já com a conta feita ("R$ 54,34 com o cupom de R$ 15"); se não der para ter certeza, só o cupom.
 * Preço com condição ("no Pix") fica sem conta: não dá para garantir que o cupom acumula com ela.
 */
function linhaCupomML(p) {
  const v = p.precoObs ? null : valorCupomReais(p.cupom);
  const final = v && p.precoAtual > v ? centavos(p.precoAtual - v) : null;
  return final ? `🎟️ *${formatBRL(final)}* com o cupom de ${formatBRL(v)}` : `🎟️ ${p.cupom.replace(/ com Cupom$/i, '')} com cupom`;
}

/** Cabeçalho com a loja, no estilo dos grandes grupos ("🧡 AMAZON"); a cor do coração lembra a da loja. */
const CORACAO = { amazon: '🧡', shopee: '🧡', awin: '💜' };
export const cabecalhoLoja = (p) => `${CORACAO[p.loja] || '💛'} *${nomeLoja(p).toUpperCase()}*`;

/**
 * Post de produto (formato pedido pelo dono em 20/10/2026, inspirado num grupo grande): loja no topo, nome em
 * negrito, "de R$ X por R$ Y", a economia (sempre), cupom, frete, nota e vendidos, "use o link" e o aviso em citação.
 * `titulo` só vale para cupom/promoção de loja; produto não tem mais título.
 */
export function montarLegenda(p, { titulo, mensagemAdicional = '' } = {}) {
  // Post copiado de um canal (espelho com "copiarTexto"): sai como o canal escreveu, já com os links do dono.
  if (p.textoPronto) return [p.textoPronto, mensagemAdicional].filter((s) => s && s.trim()).join('\n\n');
  if (p.tipo === 'cupom') return legendaCupom(p, { titulo, mensagemAdicional });
  const linhasPreco = [];
  if (p.precoAtual) {
    const temDe = p.precoOriginal && p.precoOriginal > p.precoAtual;
    linhasPreco.push(`💰 ${temDe ? `de ${formatBRL(p.precoOriginal)} ` : ''}por *${formatBRL(p.precoAtual)}*${p.precoObs ? ` ${p.precoObs}` : ''}`);
    const economia = temDe ? centavos(p.precoOriginal - p.precoAtual) : 0;
    const pct = p.descontoPct || (temDe ? Math.round((economia / p.precoOriginal) * 100) : 0);
    if (economia > 0) linhasPreco.push(`💸 Economia de ${formatBRL(economia)}${pct ? ` (${pct}% OFF)` : ''}`);
    else if (pct) linhasPreco.push(`💸 ${pct}% OFF`);
  } else {
    linhasPreco.push(`💰 *Confira o preço no link*${p.descontoPct ? ` (${p.descontoPct}% OFF)` : ''}`);
  }

  const extras = [];
  // O "menor preço em 30 dias" (src/precos.js) não aparece no post: o dono não gostou (20/10/2026). Só pesa na fila.
  if (p.cupom) extras.push(p.loja === 'amazon' || p.loja === 'awin' || p.loja === 'shopee' ? linhaCodigo(p.cupom) : linhaCupomML(p));
  if (p.frete) extras.push(`🚚 ${p.frete}${p.full ? ' ⚡FULL' : ''}`);
  extras.push(linhaProva(p));
  if (p.fimRelampago) extras.push('⏳ Oferta relâmpago — acaba hoje!');

  // A Amazon exige mostrar a hora do preço; nas outras lojas, o aviso de sempre.
  const aviso = p.loja === 'amazon' && p.precoAtual ? `Preço da Amazon às ${horaConsulta(p)} — pode mudar` : 'Oferta válida por tempo limitado';
  return [
    cabecalhoLoja(p),
    `*${nomeCurto(p.nome)}*`,
    linhasPreco.join('\n'),
    extras.filter(Boolean).join('\n'),
    `🔗 use o link:\n${p.linkAfiliado}`,
    `> _${aviso}_`,
    mensagemAdicional,
  ]
    .filter((s) => s && s.trim())
    .join('\n\n');
}
