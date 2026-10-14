/**
 * Analytics — dinheiro. Só leitura.
 *
 * Awin: API de relatórios (cliques, vendas e comissão por loja), 1x por dia às 21h52, em data/analytics/awin.json.
 * Comissão PENDENTE (a loja ainda pode cancelar) e APROVADA ficam separadas: nunca somadas como dinheiro garantido.
 * Busca o dia de hoje, os dias recentes que faltam (até 7) e o total dos últimos 30 dias — numa venda, o status
 * muda de pendente para aprovada (ou recusada) semanas depois, e o total de 30 dias mostra isso.
 *
 * Mercado Livre: não há API de relatório de afiliado pública e estável; ler o painel exigiria a sessão do dono
 * em páginas internas. O painel do bot mostra só o link para o painel do ML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.js';
import { diaLocal, log } from '../util.js';
import { PASTA_ANALYTICS } from './dia.js';

export const PAINEL_ML = 'https://www.mercadolivre.com.br/afiliados';
export const arquivoAwin = (base = PASTA_ANALYTICS) => path.join(base, 'awin.json');
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
