/**
 * Analytics — dinheiro. Só leitura.
 *
 * Awin: API de relatórios (cliques, vendas e comissão por loja), 1x por dia às 21h52, em data/analytics/awin.json.
 * Comissão PENDENTE (a loja ainda pode cancelar) e APROVADA ficam separadas: nunca somadas como dinheiro garantido.
 * Busca o dia de hoje, os dias recentes que faltam (até 7) e o total dos últimos 30 dias — numa venda, o status
 * muda de pendente para aprovada (ou recusada) semanas depois, e o total de 30 dias mostra isso.
 *
 * Shopee (03/11/2026): relatório de conversões da API de afiliados (conversionReport), mesmos horários, em
 * data/analytics/shopee.json — cada pedido com o dia da compra, a situação (pendente, concluído, cancelado) e a
 * comissão de cada item. Busca os últimos 30 dias a cada vez (a situação muda depois).
 *
 * Mercado Livre e Amazon: não há API de relatório de afiliado; o painel mostra o link para o painel de cada um
 * (pedido do dono, 03/11/2026).
 */
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.js';
import { diaLocal, log } from '../util.js';
import { PASTA_ANALYTICS } from './dia.js';

export const PAINEL_ML = 'https://www.mercadolivre.com.br/afiliados';
export const PAINEL_AMAZON = 'https://associados.amazon.com.br/home/reports';
export const PAINEL_SHOPEE = 'https://affiliate.shopee.com.br/report/conversion_report';
export const PAINEL_AWIN = 'https://ui.awin.com/';
export const arquivoAwin = (base = PASTA_ANALYTICS) => path.join(base, 'awin.json');
export const arquivoShopee = (base = PASTA_ANALYTICS) => path.join(base, 'shopee.json');
const MANTER_DIAS = 180;

export function lerAwin(base = PASTA_ANALYTICS) {
  try {
    const d = JSON.parse(fs.readFileSync(arquivoAwin(base), 'utf8'));
    return d && typeof d === 'object' ? { dias: d.dias || {}, periodo30: d.periodo30 || null, atualizadoEm: d.atualizadoEm || null } : { dias: {}, periodo30: null };
  } catch {
    return { dias: {}, periodo30: null };
  }
}

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Linha do relatório da Awin -> o que guardamos (sem ids de conta nem nome do titular). */
function loja(x) {
  return {
    loja: String(x.advertiserName || x.advertiserId || 'loja'),
    cliques: Number(x.clicks) || 0,
    pendentes: { vendas: Number(x.pendingNo) || 0, comissao: centavos(x.pendingComm) },
    aprovadas: { vendas: (Number(x.confirmedNo) || 0) + (Number(x.bonusNo) || 0), comissao: centavos((Number(x.confirmedComm) || 0) + (Number(x.bonusComm) || 0)) },
    recusadas: { vendas: Number(x.declinedNo) || 0, comissao: centavos(x.declinedComm) },
  };
}

function somar(lojas) {
  const t = { cliques: 0, pendentes: { vendas: 0, comissao: 0 }, aprovadas: { vendas: 0, comissao: 0 }, recusadas: { vendas: 0, comissao: 0 } };
  for (const l of lojas) {
    t.cliques += l.cliques;
    for (const k of ['pendentes', 'aprovadas', 'recusadas']) {
      t[k].vendas += l[k].vendas;
      t[k].comissao = centavos(t[k].comissao + l[k].comissao);
    }
  }
  return t;
}

async function relatorio(awin, inicio, fim) {
  const id = await awin.publisher();
  const r = await awin.chamar('GET', `/publishers/${id}/reports/advertiser?startDate=${inicio}&endDate=${fim}&region=BR&timezone=${encodeURIComponent(settings.tz)}`);
  const lojas = (Array.isArray(r) ? r : []).map(loja);
  return { lojas, total: somar(lojas) };
}

const diaMenos = (agora, n) => diaLocal(new Date(agora.getTime() - n * 86_400_000), settings.tz);

/**
 * Atualiza data/analytics/awin.json. Usa a fila de chamadas da classe Awin (20 por minuto). Nunca lança erro:
 * devolve null se a Awin não estiver configurada ou se a API falhar.
 */
export async function registrarAwin({ awin, base = PASTA_ANALYTICS, agora = new Date(), diasParaTras = 7 } = {}) {
  if (!awin?.configurada?.()) return null;
  try {
    const guardado = lerAwin(base);
    const hoje = diaLocal(agora, settings.tz);
    // Hoje e ontem sempre (ontem ainda recebe cliques atrasados); os outros dias recentes só se faltarem.
    const dias = [];
    for (let i = diasParaTras; i >= 0; i--) {
      const dia = diaMenos(agora, i);
      if (i <= 1 || !guardado.dias[dia]) dias.push(dia);
    }
    for (const dia of dias) guardado.dias[dia] = await relatorio(awin, dia, dia);
    guardado.periodo30 = { inicio: diaMenos(agora, 29), fim: hoje, ...(await relatorio(awin, diaMenos(agora, 29), hoje)) };
    guardado.atualizadoEm = agora.toISOString();
    for (const k of Object.keys(guardado.dias).sort().slice(0, -MANTER_DIAS)) delete guardado.dias[k];
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(arquivoAwin(base) + '.tmp', JSON.stringify(guardado, null, 1));
    fs.renameSync(arquivoAwin(base) + '.tmp', arquivoAwin(base));
    return guardado;
  } catch (e) {
    log(`  📊 relatório da Awin indisponível (${String(e.message).split('\n')[0]})`);
    return null;
  }
}

export function lerShopee(base = PASTA_ANALYTICS) {
  try {
    const d = JSON.parse(fs.readFileSync(arquivoShopee(base), 'utf8'));
    return { pedidos: d?.pedidos || {}, atualizadoEm: d?.atualizadoEm || null };
  } catch {
    return { pedidos: {}, atualizadoEm: null };
  }
}

/** Situação do pedido na Shopee -> a nossa: cancelado / concluido / pendente (o resto, inclusive "não pago"). */
export function situacaoShopee(status) {
  const s = String(status || '').toUpperCase();
  if (/CANCEL|INVALID|FAIL/.test(s)) return 'cancelado';
  if (/COMPLET/.test(s)) return 'concluido';
  return 'pendente';
}

const CONSULTA_SHOPEE = (ini, fim, scroll) =>
  `{ conversionReport(purchaseTimeStart: ${ini}, purchaseTimeEnd: ${fim}, limit: 500${scroll ? `, scrollId: ${JSON.stringify(scroll)}` : ''}) {` +
  ' nodes { purchaseTime conversionId totalCommission orders { orderId orderStatus items { itemId itemName qty itemTotalCommission } } }' +
  ' pageInfo { hasNextPage scrollId } } }';

/** Uma conversão da API -> os pedidos dela, no nosso formato (sem dados do comprador). */
export function pedidosDaConversao(c, tz = settings.tz) {
  const dia = diaLocal(new Date(Number(c.purchaseTime) * 1000), tz);
  const pedidos = c.orders || [];
  return pedidos.map((o) => {
    const itens = (o.items || []).map((i) => ({ id: String(i.itemId ?? ''), nome: String(i.itemName || 'produto').slice(0, 100), qtd: Number(i.qty) || 1, comissao: centavos(i.itemTotalCommission) }));
    const soma = centavos(itens.reduce((s, i) => s + i.comissao, 0));
    return {
      chave: `${c.conversionId}:${o.orderId}`,
      dia,
      situacao: situacaoShopee(o.orderStatus),
      // Pedido sem comissão por item: a comissão da conversão (só quando ela tem um pedido só).
      comissao: soma || (pedidos.length === 1 ? centavos(c.totalCommission) : 0),
      itens,
    };
  });
}

/**
 * Atualiza data/analytics/shopee.json com as compras dos últimos 30 dias. Nunca lança erro: null se a Shopee não
 * estiver configurada ou se a API falhar.
 */
export async function registrarShopee({ shopee, base = PASTA_ANALYTICS, agora = new Date() } = {}) {
  if (!shopee?.ligada?.()) return null;
  try {
    const guardado = lerShopee(base);
    const fim = Math.floor(agora.getTime() / 1000);
    const ini = fim - 30 * 86_400;
    let scroll = null;
    for (let pagina = 0; pagina < 20; pagina++) {
      const d = await shopee.graphql(CONSULTA_SHOPEE(ini, fim, scroll));
      const r = d.conversionReport || {};
      for (const c of r.nodes || []) for (const { chave, ...p } of pedidosDaConversao(c)) guardado.pedidos[chave] = p;
      if (!r.pageInfo?.hasNextPage || !r.pageInfo?.scrollId) break;
      scroll = r.pageInfo.scrollId;
    }
    const limite = diaLocal(new Date(agora.getTime() - MANTER_DIAS * 86_400_000), settings.tz);
    for (const [k, p] of Object.entries(guardado.pedidos)) if (p.dia < limite) delete guardado.pedidos[k];
    guardado.atualizadoEm = agora.toISOString();
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(arquivoShopee(base) + '.tmp', JSON.stringify(guardado, null, 1));
    fs.renameSync(arquivoShopee(base) + '.tmp', arquivoShopee(base));
    return guardado;
  } catch (e) {
    log(`  📊 relatório da Shopee indisponível (${String(e.message).split('\n')[0]})`);
    return null;
  }
}

/** Os pedidos da Shopee de uma lista de dias: totais por situação e os produtos que mais renderam. */
export function dinheiroShopee(shopee, dias) {
  const noPeriodo = new Set(dias);
  const t = { pedidos: 0, pendente: 0, concluido: 0, cancelado: 0, produtos: [] };
  const porProduto = {};
  let algum = false;
  for (const p of Object.values(shopee?.pedidos || {})) {
    if (!noPeriodo.has(p.dia)) continue;
    algum = true;
    t[p.situacao] = centavos(t[p.situacao] + (p.comissao || 0));
    if (p.situacao === 'cancelado') continue;
    t.pedidos++;
    for (const i of p.itens || []) {
      const x = (porProduto[i.id || i.nome] ??= { nome: i.nome, vendas: 0, comissao: 0 });
      x.vendas += i.qtd || 1;
      x.comissao = centavos(x.comissao + (i.comissao || 0));
    }
  }
  t.produtos = Object.values(porProduto).sort((a, b) => b.comissao - a.comissao || b.vendas - a.vendas).slice(0, 10);
  return algum || shopee?.atualizadoEm ? t : null;
}
