/**
 * Nota da oferta (0 a 100) — decide quem vai para a frente da fila (05/11/2026, o dono: "quero que você ranqueie as
 * promoções... as marcas que te falei são prioridade, desconto é bom também"). Antes a ordem era uma soma de
 * preferências (feminino, marca, tipo) e, entre as empatadas, as copiadas mais novas passavam na frente de tudo; agora
 * cada oferta ganha uma nota só, com critérios claros, e o /fila mostra a fila nessa ordem.
 *
 *   Marca ............ até 40  com "ordem" (Fitness, a lista do dono em ordem de prioridade): a 1ª = 40, a última = 15,
 *                      em degraus iguais; sem ordem: marca que o dono pediu = 35, posta pelo Claude por conta = 15;
 *                      sem marca = 0 (config/marcas.json > "nivel")
 *   Desconto ......... até 30  0,5 ponto por % de desconto (até 60%); mais que isso costuma ser "de" inflado
 *   Público .......... feminino 25, neutro 0, masculino -40 (o público é de meninas, 15/10/2026: masculino só quando
 *                      não há outra; o limite de 1 masculino a cada N continua à parte)
 *   Tipo do grupo .... até 20  "prioridade" do grupo (Fitness: tênis e suplementos de marca, 04/11/2026)
 *   Vendas ........... até 10  10 mil+ = 10, mil = 7,5, cem = 5; sem número (Amazon dos canais) = 5
 *   Avaliação ........ -5 a 5  4,8+ = 5; 4,5+ = 3; abaixo de 4 = -5; sem nota = 2
 *   Menor preço 30 d .     5
 *   Novidade ......... -5 a 5  chegou há menos de 1 h = 5, há menos de 3 h = 2, mais de 1 dia = -5
 *   Mesma loja do último post: -8 (para revezar ML, Amazon, Shopee sem travar a melhor oferta)
 *   Mandada pelo dono no privado do bot: +100 (ele escolheu: sai na frente de tudo; 05/11/2026)
 *   Mesma marca de um dos 3 últimos posts: -15 (05/11/2026, o dono: "só tem coisa da Nike aí" — a fila tinha 40 Nike do
 *   catálogo da Awin com notas parecidas; sem isso saíam marcas iguais seguidas)
 *   Marca que já saiu nas últimas 24 h no grupo: -8 por post dela (até -32), para variar as marcas no dia
 *   Preço acima do "precoBom" do grupo (grupos.json): -1 a cada R$ 15 acima (até -25). Fitness: R$ 250
 *   (06/11/2026, o dono: "tô achando os produtos da Nike muito caros, tem como dar uma variada nas marcas")
 *
 * A soma vai de uns -50 a 135 pontos; a nota mostrada é ela em 0 a 100. A fila sai pela soma (`bruta`).
 */
import { loadMarcas } from './config.js';
import { generoDoProduto } from './genero.js';
import { listaDeMarcas, marcaDoProduto } from './marcas.js';
import { lerVendas } from './ml/vendas.js';

const MAXIMO = 40 + 30 + 25 + 20 + 10 + 5 + 5 + 5; // a melhor oferta possível

/** Marcas que o Claude acrescentou por conta própria (config/marcas.json > "nivel" > "secundarias"). */
function secundarias(cfg = loadMarcas()) {
  return new Set((cfg?.nivel?.secundarias || []).map((m) => String(m).toLowerCase()));
}

/** Posição da marca na "ordem" do dono (config/marcas.json > nivel.ordem): { i, n, grande } ou null. */
export function posicaoDaMarca(marca, cfg = loadMarcas()) {
  if (!marca) return null;
  for (const [nicho, lista] of Object.entries(cfg?.nivel?.ordem || {})) {
    const i = lista.findIndex((m) => String(m).toLowerCase() === String(marca).toLowerCase());
    if (i >= 0) return { i, n: lista.length, grande: i < (Number(cfg.nivel.grandes?.[nicho]) || 0) };
  }
  return null;
}

/** Pontos da marca: pela ordem do dono (40 a 15) ou, sem ordem, 35 / 15 (secundária) / 0. */
export function pontosDaMarca(marca, cfg = loadMarcas(), extras = secundarias(cfg)) {
  if (!marca) return 0;
  const pos = posicaoDaMarca(marca, cfg);
  if (pos) return Math.round((40 - (25 * pos.i) / Math.max(1, pos.n - 1)) * 10) / 10;
  return extras.has(marca.toLowerCase()) ? 15 : 35;
}

/**
 * Monta a função de nota de um grupo. `prioridade(p)` = peso do tipo de produto no grupo (prioridadeDoGrupo, 0 se não
 * for), `genero(p)` = 'f' | 'm' | null. Devolve (p, { ultimo, agora }) => { nota, partes }.
 */
export function notaDaOferta({ prioridade = () => 0, genero = generoDoProduto, cfg, precoBom = null } = {}) {
  const conf = cfg || loadMarcas();
  const lista = listaDeMarcas(conf);
  const extras = secundarias(conf);
  return (p, { ultimo, recentes = ultimo ? [ultimo] : [], doDia = [], agora = Date.now() } = {}) => {
    const partes = {};
    const marca = lista.length ? marcaDoProduto(p, lista) : null;
    partes.marca = pontosDaMarca(marca, conf, extras);
    partes.desconto = Math.min(60, Math.max(0, Number(p.descontoPct) || 0)) * 0.5;
    partes.publico = { f: 25, m: -40 }[genero(p)] ?? 0;
    partes.tipo = Math.min(20, 10 * (Number(prioridade(p)) || 0));
    const vendas = lerVendas(p.vendidos)?.minimo;
    partes.vendas = vendas ? Math.min(10, 2.5 * Math.log10(1 + vendas)) : 5;
    const n = Number(p.nota);
    partes.avaliacao = !(n > 0) ? 2 : n >= 4.8 ? 5 : n >= 4.5 ? 3 : n >= 4 ? 0 : -5;
    partes.menorPreco = p.menorPreco30d ? 5 : 0;
    const idadeH = p.coletadoEm ? (agora - Date.parse(p.coletadoEm)) / 3_600_000 : 2;
    partes.novidade = idadeH < 1 ? 5 : idadeH < 3 ? 2 : idadeH > 24 ? -5 : 0;
    partes.loja = ultimo && (ultimo.loja || 'ml') === (p.loja || 'ml') ? -8 : 0;
    partes.repetida = marca && recentes.some((r) => marcaDoProduto(r, lista) === marca) ? -15 : 0;
    const noDia = marca ? doDia.filter((r) => marcaDoProduto(r, lista) === marca).length : 0;
    partes.marcaNoDia = -8 * Math.min(4, noDia);
    const preco = Number(p.precoAtual);
    partes.preco = precoBom && preco > precoBom ? -Math.min(25, Math.round((preco - precoBom) / 15)) : 0;
    if (p.manual) partes.doDono = 100;
    const bruta = Object.values(partes).reduce((s, v) => s + v, 0);
    return { nota: Math.round(Math.max(0, Math.min(MAXIMO, bruta)) * 100 / MAXIMO), bruta, partes, marca };
  };
}
