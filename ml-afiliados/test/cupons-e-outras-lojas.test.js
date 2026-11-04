import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Espelho, cuponsDoTexto, lojaSemPrograma } from '../src/espelho.js';
import { fontesDosCanais } from '../src/telegram-canais.js';
import { acharPeloNome } from '../src/ml/api.js';
import { montarLegenda, tituloCupom } from '../src/caption.js';
import { Store } from '../src/store.js';

const POST_UM = `Cupom Mercado Livre #anúncio

15% OFF, acima de R$89, Limite de R$20 OFF: SITE031115
✅ Ative aqui para ajudar o grupo:
https://mercadolivre.com.br/sec/31qRqvp OU https://mercadolivre.com.br/sec/2iaPXU7

👇Canal só com cupom Mercado Livre: whatsapp.com/channel/0029VaETR3b5fM5cloqnZl1p`;

const POST_FULL = `USE AGORA! Cupom Mercado Livre ENTREGAS FULL #anúncio

20% OFF em R$119 Limitado a R$40 - FULLRESGATE0311
🚨Só pra quem resgatou no app ontem
-Aperte em AVISE-ME nos próximos

1. Entre no APP👉 https://mercadolivre.com.br/sec/2iaPXU7`;

const POST_SEM_CODIGO = `Resgate 20% Cupom Mercado Livre ENTREGAS FULL #anúncio
1. Entre no app 👉 https://mercadolivre.com.br/sec/2iaPXU7
2. Clique em "Mais" no rodapé do app`;

test('cupons do @cupombr: só "condição: CÓDIGO"; tutorial, AVISE-ME e links ficam de fora', () => {
  assert.deepEqual(cuponsDoTexto(POST_UM), [{ condicao: '15% OFF, acima de R$89, Limite de R$20 OFF', codigo: 'SITE031115' }]);
  assert.deepEqual(cuponsDoTexto(POST_FULL), [{ condicao: '20% OFF em R$119 Limitado a R$40', codigo: 'FULLRESGATE0311' }]);
  assert.deepEqual(cuponsDoTexto(POST_SEM_CODIGO), []);
  assert.deepEqual(cuponsDoTexto('R$299 em R$1.000 com cartão Mercado Pago: MP0310\nCasa e construção 15% OFF: CASA0311').map((c) => c.codigo), ['MP0310', 'CASA0311']);
});

test('loja sem programa: pelo endereço ou pelo nome no texto; ML/Amazon/sem link não contam', () => {
  assert.equal(lojaSemPrograma({ texto: 'Sérum Dior por R$ 399\nhttps://www.sephora.com.br/p/serum' }), 'Sephora');
  assert.equal(lojaSemPrograma({ texto: 'Na SEPHORA! Batom por R$ 99\nhttps://bit.ly/abc' }), 'Sephora');
  assert.equal(lojaSemPrograma({ texto: 'Batom por R$ 99\nhttps://bit.ly/abc' }), null);
  assert.equal(lojaSemPrograma({ texto: 'Sephora sem link nenhum' }), null);
});

test('cupons do ML: post do bot com os códigos e o link do dono, em cada grupo; sem repetir e no máximo N por dia', async () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-cup-')), 'db.json'));
  const [fonte] = fontesDosCanais({ apenasAmazon: true, canais: [{ canal: 'cupombr', cuponsML: true, apenasAmazon: false, cuponsPorDia: 1, destinos: [{ grupo: 'Beleza' }, { grupo: 'Fitness' }] }] }, { amazonTag: '' });
  assert.equal(fonte.cuponsML, true, 'canal de cupons fica mesmo sem etiqueta da Amazon');
  const pedidos = [];
  const e = new Espelho({
    sender: null, store, fontes: [fonte], grupos: [{ nome: 'Beleza' }, { nome: 'Fitness' }, { nome: 'Perfumes', ativo: false }],
    affiliate: { tag: 'pndaaaa', refresh: async () => {}, createLinks: async (urls) => (pedidos.push(...urls), new Map([[urls[0], 'https://meli.la/CUPONS1']])) },
  });
  assert.equal(await e.processar({ id: 'x1', jid: fonte.jid, texto: POST_UM, textoVisivel: POST_UM }), 'ok');
  assert.deepEqual(pedidos, ['https://www.mercadolivre.com.br/cupons']);
  const fila = store.list();
  assert.deepEqual(fila.map((p) => p.grupo).sort(), ['Beleza', 'Fitness']);
  const p = fila[0];
  assert.equal(tituloCupom(p), 'CUPOM MERCADO LIVRE 🎟️');
  const legenda = montarLegenda(p, { titulo: tituloCupom(p) });
  assert.match(legenda, /15% OFF, acima de R\$89, Limite de R\$20 OFF: `SITE031115`/);
  assert.match(legenda, /Usar o cupom no Mercado Livre:\nhttps:\/\/meli\.la\/CUPONS1/);
  assert.doesNotMatch(legenda, /anúncio|whatsapp|sec\//);

  assert.equal(await e.processar({ id: 'x2', jid: fonte.jid, texto: POST_UM }), 'cupom repetido');
  assert.equal(await e.processar({ id: 'x3', jid: fonte.jid, texto: POST_FULL }), 'limite de cupons do ML no dia');
  assert.equal(await e.processar({ id: 'x4', jid: fonte.jid, texto: POST_SEM_CODIGO }), 'sem código de cupom');

  // Sem o Link Builder: o link da página de cupons com a etiqueta.
  const e2 = new Espelho({ sender: null, store, fontes: [fonte], grupos: [], affiliate: { tag: 'pndaaaa', refresh: async () => {}, createLinks: async () => { throw new Error('sessão'); } } });
  assert.equal(await e2.linkCuponsML(), 'https://www.mercadolivre.com.br/cupons?matt_word=pndaaaa');
});

test('outra loja no ML: anúncio até 10% acima do preço de lá (ou mais barato); acima disso, não', async () => {
  const api = (preco) => ({
    get: async (url) => (url.startsWith('/products/search') ? { results: [{ id: 'MLB1', name: 'Sérum Facial Vitamina C Principia 30ml' }] } : { results: [{ id: 'A', price: preco, condition: 'new', item_id: 'MLB9', seller_id: 1, shipping: {} }] }),
    produto: async () => ({ nome: 'Sérum Facial Vitamina C Principia 30ml', imagem: 'https://x/y.jpg' }),
    salvarCache() {},
  });
  assert.ok(await acharPeloNome(api(105), 'Sérum Facial Vitamina C Principia 30ml', 100, { outraLoja: true }));
  assert.ok(await acharPeloNome(api(70), 'Sérum Facial Vitamina C Principia 30ml', 100, { outraLoja: true }));
  assert.equal(await acharPeloNome(api(115), 'Sérum Facial Vitamina C Principia 30ml', 100, { outraLoja: true }), null);
  assert.equal(await acharPeloNome(api(70), 'Sérum Facial Vitamina C Principia 30ml', 100), null, 'post do ML: o preço tem de bater');
});
