/**
 * Histórico de preços próprio (16/10/2026, inspirado no Promobit, que compara cada oferta com um preço de referência
 * tirado das ofertas anteriores): toda busca anota o preço de cada produto que viu (data/precos.json).
 *  - "Já esteve bem mais barato" nos últimos 30 dias (mais de 10% abaixo do preço de agora): não é oferta de verdade,
 *    fica de fora — é o desconto falso do "de R$ 200 por R$ 150" que no mês passado custava R$ 120.
 *  - Preço de agora é o menor dos últimos 30 dias (e já foi visto mais caro): o post ganha "📉 Menor preço...".
 * Por produto guarda só o essencial: menor e maior preço da janela, o último, quando, e quantas vezes foi visto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const DIA = 86_400_000;
export const JANELA_DIAS = 30;
const TOLERANCIA = 0.1; // até 10% acima do menor recente ainda passa (preço oscila um pouco)

export class HistoricoDePrecos {
  constructor({ arquivo = path.join(DATA_DIR, 'precos.json'), agora = () => Date.now() } = {}) {
    this.arquivo = arquivo;
    this.agora = agora;
    try {
      this.dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
    } catch {
      this.dados = {};
    }
  }

  /** O que o histórico diz do preço de agora (antes de anotá-lo): { caro, menorEm30Dias, menor }. */
  avaliar(p) {
    const preco = Number(p.precoAtual);
    const e = this.dados[p.id];
    if (!e || !(preco > 0) || this.agora() - e.mt > JANELA_DIAS * DIA) return { caro: false, menorEm30Dias: false, menor: null };
    return {
      caro: e.n >= 1 && preco > e.m * (1 + TOLERANCIA),
      menorEm30Dias: e.n >= 2 && preco <= e.m && e.x > preco * 1.03,
      menor: e.m,
    };
  }

  /** Anota o preço visto agora. */
  anotar(p) {
    const preco = Number(p.precoAtual);
    if (!p.id || !(preco > 0)) return;
    const t = this.agora();
    const e = this.dados[p.id];
    if (!e || t - e.mt > JANELA_DIAS * DIA) {
      // primeira vez, ou o menor preço guardado saiu da janela: recomeça daqui
      this.dados[p.id] = { m: preco, mt: t, x: Math.max(preco, e?.u || 0), u: preco, ut: t, n: (e?.n || 0) + 1 };
      return;
    }
    if (preco <= e.m) Object.assign(e, { m: preco, mt: t });
    Object.assign(e, { x: Math.max(e.x, preco), u: preco, ut: t, n: e.n + 1 });
  }

  /** Grava, esquecendo o que não é visto há mais de 2 janelas. */
  salvar() {
    const limite = this.agora() - 2 * JANELA_DIAS * DIA;
    for (const [id, e] of Object.entries(this.dados)) if (e.ut < limite) delete this.dados[id];
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    fs.writeFileSync(this.arquivo, JSON.stringify(this.dados));
  }
}
