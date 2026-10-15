/**
 * Público principal: meninas (pedido do dono, 15/10/2026). Cada produto é classificado pelo nome do anúncio e pelo
 * texto do post: 'f' (feminino), 'm' (masculino) ou null (neutro: casa, eletrônicos, unissex...).
 * Na hora de postar (grupos.json, "preferirFeminino"): femininos primeiro, depois os neutros, e no máximo 1 masculino
 * a cada N posts (N = o número do campo; `true` = 3).
 */
import { normalizar } from './util.js';

// Palavras que dizem o gênero (o ML quase sempre escreve "Feminino"/"Masculino" no nome do anúncio).
// Perfumes masculinos famosos que o anúncio às vezes não chama de "masculino" (visto em 15/10/2026: Bad Boy, Le Beau...).
const MASCULINO =
  /\b(masculino|masculina|masc|homme|homem|homens|for men|for him|pour homme|men|man|uomo|hombre|cueca|cuecas|barba|barbear|barbeador|bad boy|le beau|le male|invictus|phantom|1 million|one million|sauvage|bleu de chanel|acqua di gio|eros|toy boy|wanted|aventus|boss bottled|club 6|malbec|quasar|kaiak|asad|hawas|fakhar black|ameeri|polo blue|polo red)\b/;
const FEMININO =
  /\b(feminino|feminina|fem|femme|woman|women|for her|pour femme|mulher|mulheres|lady|girl|menina|meninas|sutia|calcinha|calcinhas|lingerie|biquini|maio|vestido|saia|blusinha|cropped|legging|top fitness|batom|maquiagem|rimel|mascara de cilios|base liquida|esmalte|chapinha|prancha|babyliss|depilador|depiladora|absorvente|yara|olympea|la vie est belle|idole|miss dior|jadore|j adore|coco mademoiselle|alien|scandal|fame|la belle|bareeq al dhahab)\b/;

export function generoDoProduto(p) {
  const t = normalizar(`${p.nome || ''} ${p.textoPronto || ''}`);
  const m = MASCULINO.test(t);
  const f = FEMININO.test(t);
  return m && !f ? 'm' : f && !m ? 'f' : null;
}
export const generoDoPerfume = generoDoProduto;

/** Opções para Store.proximo(): femininos > neutros > masculinos, e masculino só se não saiu nenhum nos últimos N-1 posts. */
export function preferenciaFeminina(store, grupo, cadaN = 3) {
  const n = Number.isInteger(cadaN) && cadaN >= 2 ? cadaN : 3;
  const ultimos = store
    .list((p) => p.grupo === grupo && (p.status === 'ENVIADO' || p.status === 'INCERTO') && p.enviadoEm)
    .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)))
    .slice(0, n - 1);
  const masculinoRecente = ultimos.some((p) => generoDoProduto(p) === 'm');
  const nota = { f: 2, m: 0 };
  return {
    aceitar: (p) => !masculinoRecente || generoDoProduto(p) !== 'm',
    preferir: (p) => nota[generoDoProduto(p)] ?? 1,
  };
}
