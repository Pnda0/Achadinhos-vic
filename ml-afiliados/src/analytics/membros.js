/**
 * Analytics — quantos membros tem cada canal (ao ligar, 12h30 e 21h50; fica a última leitura do dia), em
 * data/analytics/membros.json:
 *   { "2026-10-14": { "Fitness": 120, "Beleza": 85, ... }, ... }
 * Usa a Bot API (getChatMemberCount): o bot é administrador dos canais. Canal que falhar fica null naquele dia.
 * O número INCLUI o bot e os administradores (o dono): o painel diz isso ao lado do número.
 * Visualizações por post não entram: os canais são privados e o Telegram só mostra isso em canal público.
 */
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.js';
import { diaLocal, log } from '../util.js';
import { PASTA_ANALYTICS } from './dia.js';

const MANTER_DIAS = 400;
export const arquivoMembros = (base = PASTA_ANALYTICS) => path.join(base, 'membros.json');

export function lerMembros(base = PASTA_ANALYTICS) {
  try {
    const d = JSON.parse(fs.readFileSync(arquivoMembros(base), 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

export const membrosDoDia = (dia, base = PASTA_ANALYTICS) => lerMembros(base)[dia] || null;

/** Conta os membros de cada grupo ativo com canal no Telegram e grava no dia de hoje. Nunca lança erro. */
export async function registrarMembros({ sender, grupos, base = PASTA_ANALYTICS, agora = new Date() }) {
  if (sender?.tipo !== 'telegram' || typeof sender.call !== 'function') return null;
  const contagem = {};
  for (const g of grupos.filter((x) => x.ativo !== false && x.jid)) {
    try {
      const n = await sender.call('getChatMemberCount', { chat_id: g.jid });
      contagem[g.nome] = Number.isInteger(n) ? n : null;
    } catch (e) {
      contagem[g.nome] = null;
      log(`  📊 membros de ${g.nome}: não consegui contar (${String(e.message).split('\n')[0]})`);
    }
  }
  try {
    const todos = lerMembros(base);
    // Regrava o dia (fica a última leitura), sem apagar o canal que falhou agora mas tinha sido contado mais cedo.
    const dia = diaLocal(agora, settings.tz);
    const antes = todos[dia] || {};
    todos[dia] = Object.fromEntries(Object.entries(contagem).map(([g, n]) => [g, n ?? antes[g] ?? null]));
    for (const k of Object.keys(todos).sort().slice(0, -MANTER_DIAS)) delete todos[k];
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(arquivoMembros(base) + '.tmp', JSON.stringify(todos, null, 1));
    fs.renameSync(arquivoMembros(base) + '.tmp', arquivoMembros(base));
  } catch (e) {
    log(`  📊 não consegui gravar os membros (${String(e.message).split('\n')[0]})`);
  }
  return contagem;
}

/**
 * Variação de membros de um grupo: no dia, em 7 dias e desde o primeiro registro.
 * Compara com o registro mais recente ATÉ a data de referência (o PC pode ter ficado desligado num dia).
 */
export function variacaoMembros(todos, grupo, dia) {
  const dias = Object.keys(todos).filter((d) => d <= dia && Number.isInteger(todos[d]?.[grupo])).sort();
  if (!dias.length) return null;
  const hoje = todos[dias.at(-1)][grupo];
  const antes = (limite) => {
    const d = dias.filter((x) => x <= limite).at(-1);
    return d ? todos[d][grupo] : null;
  };
  const menos = (n) => new Date(new Date(`${dia}T12:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const delta = (ref) => (ref == null ? null : hoje - ref);
  return { atual: hoje, dia: delta(antes(menos(1))), semana: delta(antes(menos(7))), inicio: hoje - todos[dias[0]][grupo], desde: dias[0] };
}
