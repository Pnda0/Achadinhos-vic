/**
 * Perfume feminino ou masculino, pelo nome do anúncio (o ML quase sempre escreve "Feminino"/"Masculino") e pelo
 * texto do post. 'f' | 'm' | null (unissex ou sem dizer). Usado no grupo Perfumes, cujo público principal são
 * meninas: no máximo 1 masculino a cada 3 posts (grupos.json, "preferirFeminino": true).
 */
import { normalizar } from './util.js';

const MASCULINO = /\b(masculino|masculina|masc|homme|homem|for men|for him|pour homme|men|man|uomo|hombre)\b/;
const FEMININO = /\b(feminino|feminina|fem|femme|woman|women|for her|pour femme|mulher|lady|girl)\b/;

export function generoDoPerfume(p) {
  const t = normalizar(`${p.nome || ''} ${p.textoPronto || ''}`);
  const m = MASCULINO.test(t);
  const f = FEMININO.test(t);
  return m && !f ? 'm' : f && !m ? 'f' : null;
}

/**
 * Regra do grupo: femininos e unissex na frente; masculino só se nenhum dos 2 últimos posts foi masculino.
 * Devolve as opções para Store.proximo().
 */
export function preferenciaFeminina(store, grupo) {
  const ultimos = store
    .list((p) => p.grupo === grupo && (p.status === 'ENVIADO' || p.status === 'INCERTO') && p.enviadoEm)
    .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)))
    .slice(0, 2);
  const masculinoRecente = ultimos.some((p) => generoDoPerfume(p) === 'm');
  return {
    aceitar: (p) => !masculinoRecente || generoDoPerfume(p) !== 'm',
    preferir: (p) => generoDoPerfume(p) !== 'm',
  };
}
