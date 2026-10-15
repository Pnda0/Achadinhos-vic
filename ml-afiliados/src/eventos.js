/**
 * Histórico por produto em data/produtos.log (uma linha JSON por acontecimento), para saber o que houve
 * com cada oferta: recusada (e por quê), na fila, sem link, duplicada, publicada, falhou, sem confirmação...
 * Consulta: npm run historico -- MLB123456   (ou parte do nome).
 * Nunca grava cookies, tokens, links nem o texto da mensagem — só id, loja, origem, grupo, nome e o motivo.
 * EVENTOS_ARQUIVO no ambiente troca o arquivo (os testes usam isso para não sujar o histórico real).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, settings } from './config.js';

const PADRAO = path.join(DATA_DIR, 'produtos.log');
const MAX_BYTES = 5 * 1024 * 1024;
let escritos = 0;

export const arquivoEventos = () => process.env.EVENTOS_ARQUIVO || PADRAO;

/** De onde a oferta veio: busca no ML, Amazon, cupom da Awin, espelho (canais/grupos) ou caixa de entrada. */
export function origemDe(p) {
  if (p.origem === 'espelho') return String(p.categoria || '').includes('Caixa de entrada') ? 'caixa' : 'espelho';
  if (p.tipo === 'cupom') return 'awin-cupom';
  if (p.loja === 'amazon') return 'amazon';
  if (p.loja === 'shopee') return 'shopee';
  return 'coleta';
}

/**
 * A fonte específica da oferta, com nome legível (para o analytics): "Mercado Livre: Perfumes" (categoria da busca),
 * "@promobit" (canal do Telegram), "Caixa de entrada", "Awin: Dafiti", "Amazon: <busca>".
 * Sai do que o produto já guarda (categoria/origem), então vale também para o que já estava na fila.
 */
export function fonteDe(p) {
  const cat = String(p.categoria || '');
  if (p.origem === 'espelho') return cat.replace(/^Espelho:\s*/, '') || 'Espelho';
  if (/^(Awin|Amazon|Shopee):/.test(cat)) return cat;
  if (p.tipo === 'cupom' || p.loja === 'awin') return `Awin: ${p.lojaNome || 'loja parceira'}`;
  if (p.loja === 'amazon') return 'Amazon';
  return cat ? `Mercado Livre: ${cat}` : 'Mercado Livre';
}

/** Hora local (fuso do bot), "14:05". */
export const horaLocal = (d = new Date()) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: settings.tz });

export function evento(tipo, p = {}, detalhe = null, arquivo = arquivoEventos()) {
  // Teste sem arquivo próprio não grava no histórico real (o Node marca os processos de teste com NODE_TEST_CONTEXT).
  if (process.env.NODE_TEST_CONTEXT && !process.env.EVENTOS_ARQUIVO && arquivo === PADRAO) return;
  try {
    if (++escritos % 200 === 1 && fs.existsSync(arquivo) && fs.statSync(arquivo).size > MAX_BYTES) fs.renameSync(arquivo, arquivo + '.antigo');
    const agora = new Date();
    const linha = { t: agora.toISOString(), tipo, grupo: p.grupo || null, id: p.id || null, loja: p.loja || 'ml', origem: origemDe(p), fonte: fonteDe(p), nome: String(p.nome || '').slice(0, 80) };
    if (tipo === 'publicado') {
      // Para o analytics: como era a oferta que saiu (sem link: o link de afiliado não vai para os arquivos).
      Object.assign(linha, {
        hora: horaLocal(agora),
        preco: p.precoAtual ?? null,
        descontoPct: p.descontoPct ?? null,
        vendidos: p.vendidos || null,
        cupom: !!p.cupom,
        freteGratis: /gr[aá]tis/i.test(String(p.frete || '')),
        full: !!p.full,
      });
    }
    if (detalhe) linha.detalhe = String(detalhe).split('\n')[0].slice(0, 200);
    fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n');
  } catch {}
}

/** Linhas do histórico que citam o id ou o termo (mais antigas primeiro). Linha cortada (queda de energia) é pulada. */
export function buscarEventos(termo, arquivo = arquivoEventos()) {
  const alvo = String(termo || '').toLowerCase();
  const saida = [];
  for (const arq of [arquivo + '.antigo', arquivo]) {
    let texto = '';
    try {
      texto = fs.readFileSync(arq, 'utf8');
    } catch {
      continue;
    }
    for (const l of texto.split('\n')) {
      if (!l || !l.toLowerCase().includes(alvo)) continue;
      try {
        saida.push(JSON.parse(l));
      } catch {}
    }
  }
  return saida;
}
