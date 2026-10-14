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
export const nomeLoja = (p) => (p.loja === 'amazon' ? 'Amazon' : p.loja === 'awin' ? p.lojaNome || 'Loja parceira' : 'Mercado Livre');

/** Título de um cupom/promoção de loja parceira (não passa pela IA: precisa dizer a loja). */
export function tituloCupom(p) {
  return `${p.cupom ? 'CUPOM' : 'PROMO'} ${String(p.lojaNome || 'DA LOJA').toUpperCase()} ${p.cupom ? '🎟️' : '🔥'}`;
}

const diaMes = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: settings.tz });

/** Cupom ou promoção de loja (Awin): o que é, o código, até quando vale e o link. */
function legendaCupom(p, { titulo, mensagemAdicional }) {
  return [
    `*${(titulo || tituloCupom(p)).toUpperCase()}*`,
    p.nome.slice(0, 140),
    p.descricao,
    [p.cupom && `🎟️ Cupom: *${p.cupom}*`, p.validade && `⏳ Vale até ${diaMes(p.validade)}`].filter(Boolean).join('\n'),
    `🏬 ${nomeLoja(p)}:\n🛒 ${p.linkAfiliado}`,
    mensagemAdicional,
  ]
    .filter((s) => s && s.trim())
    .join('\n\n');
}

export function montarLegenda(p, { titulo, mensagemAdicional = '' } = {}) {
  if (p.tipo === 'cupom') return legendaCupom(p, { titulo, mensagemAdicional });
  const linhasPreco = [];
  if (p.precoAtual) {
    if (p.precoOriginal && p.precoOriginal > p.precoAtual) linhasPreco.push(`~De ${formatBRL(p.precoOriginal)}~`);
    linhasPreco.push(
      `🔥 *Por ${formatBRL(p.precoAtual)}*${p.precoObs ? ` ${p.precoObs}` : ''}${p.descontoPct ? ` (${p.descontoPct}% OFF)` : ''}`
    );
  } else {
    linhasPreco.push(`🔥 *Confira o preço no link*${p.descontoPct ? ` (${p.descontoPct}% OFF)` : ''}`);
  }

  const extras = [];
  if (p.cupom) extras.push(p.loja === 'amazon' || p.loja === 'awin' ? `🎟️ Cupom: *${p.cupom}*` : `🎟️ ${p.cupom.replace(/ com Cupom$/i, '')} com cupom`);
  if (p.frete) extras.push(`🚚 ${p.frete}${p.full ? ' ⚡FULL' : ''}`);
  if (p.nota && p.nota >= 4) extras.push(`⭐ ${p.nota.toFixed(1)}${p.vendidos ? ` · ${p.vendidos}` : ''}`);
  if (p.fimRelampago) extras.push('⏳ Oferta relâmpago — acaba hoje!');

  return [
    `*${(titulo || tituloPronto(p)).toUpperCase()}*`,
    nomeCurto(p.nome),
    linhasPreco.join('\n'),
    extras.join('\n'),
    p.loja === 'amazon'
      ? `🏬 Amazon:\n🛒 ${p.linkAfiliado}${p.precoAtual ? `\n\n⏱️ Preço da Amazon às ${horaConsulta(p)} — pode mudar.` : ''}`
      : `🏬 ${nomeLoja(p)}:\n🛒 ${p.linkAfiliado}`,
    mensagemAdicional,
  ]
    .filter((s) => s && s.trim())
    .join('\n\n');
}
