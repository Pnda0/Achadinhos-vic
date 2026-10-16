import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extrairLinksML, tipoLink, parseSocialPage, parseProductPage, resolverOferta, ErroVerificacao } from '../src/ml/resolver.js';
import { Espelho, resolverFontes, textoCopiado } from '../src/espelho.js';
import { montarLegenda } from '../src/caption.js';
import { Store } from '../src/store.js';
import { enviarProximo } from '../src/pipeline.js';
import { fontesDosCanais } from '../src/telegram-canais.js';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const tmpStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
const SOCIAL = 'https://www.mercadolivre.com.br/social/outroafiliado?matt_word=outroafiliado&matt_tool=111&forceInApp=true&ref=ABC%2Fdef';

test('extrairLinksML: pega só links do Mercado Livre e limpa pontuação', () => {
  const texto = '*OFERTA* 🔥\nTênis por R$ 69\n🛒 https://meli.la/1JC7ZMh.\nGrupo: https://chat.whatsapp.com/XYZ e https://amzn.to/abc\n(https://produto.mercadolivre.com.br/MLB-123456-x-_JM?a=1)';
  assert.deepEqual(extrairLinksML(texto), ['https://meli.la/1JC7ZMh', 'https://produto.mercadolivre.com.br/MLB-123456-x-_JM?a=1']);
  assert.deepEqual(extrairLinksML('sem link nenhum'), []);
});

test('tipoLink', () => {
  assert.equal(tipoLink('https://meli.la/1JC7ZMh'), 'curto');
  assert.equal(tipoLink('https://mercadolivre.com/sec/2abCdEf'), 'curto');
  assert.equal(tipoLink(SOCIAL), 'social');
  assert.equal(tipoLink('https://www.mercadolivre.com.br/social/fulano/lists/abc'), 'outro');
  assert.equal(tipoLink('https://produto.mercadolivre.com.br/MLB-4049279695-tnis-_JM'), 'produto');
  assert.equal(tipoLink('https://www.mercadolivre.com.br/controle-ps4/p/MLB15085750'), 'produto');
  assert.equal(tipoLink('https://www.mercadolivre.com.br/tenis-x/up/MLBU3998598891'), 'produto');
  assert.equal(tipoLink('https://www.mercadolivre.com.br/ofertas?x=1'), 'outro');
});

test('parseSocialPage: pega o produto em destaque (não as recomendações) com todos os dados', () => {
  const p = parseSocialPage(fx('social-meli-la.html'));
  assert.deepEqual(
    { id: p.id, url: p.url, nome: p.nome, precoAtual: p.precoAtual, precoOriginal: p.precoOriginal, descontoPct: p.descontoPct, precoObs: p.precoObs, cupom: p.cupom, frete: p.frete, full: p.full, vendedor: p.vendedor, lojaOficial: p.lojaOficial },
    {
      id: 'MLB4049279695',
      url: 'https://produto.mercadolivre.com.br/MLB-4049279695-tnis-masculino-feminino-kappa-park-20-original-_JM',
      nome: 'Tênis Masculino Feminino Kappa Park 2.0 Original',
      precoAtual: 69.73, precoOriginal: 169.99, descontoPct: 58, precoObs: 'no Pix',
      cupom: 'R$ 15 OFF com Cupom', frete: 'Frete grátis', full: true, vendedor: 'Kappa', lojaOficial: true,
    }
  );
  assert.equal(p.imagem, 'https://http2.mlstatic.com/D_NQ_NP_2X_636204-MLB92283366432_092025-F.jpg');
  assert.equal(parseSocialPage('<html>nada</html>'), null);
});

test('parseProductPage: lê o JSON-LD e escolhe a variante da URL', () => {
  const p = parseProductPage(fx('pdp-jsonld.html'), 'https://www.mercadolivre.com.br/controle-playstation-dualshock-4-berry-blue-ps4/p/MLB15085750?x=1#y');
  assert.equal(p.id, 'MLB15085750');
  assert.equal(p.nome, 'Controle Playstation Dualshock 4 Berry Blue - Ps4');
  assert.equal(p.precoAtual, 114.89);
  assert.equal(p.nota, 4.8);
  assert.equal(p.descontoPct, null);
  assert.equal(parseProductPage('<html></html>', 'https://x/p/MLB1'), null);
});

test('resolverOferta: meli.la -> página social -> produto; captcha vira ErroVerificacao', async () => {
  const pedidos = [];
  const http = async (u) => { pedidos.push(u); return { status: 200, url: SOCIAL, html: fx('social-meli-la.html') }; };
  const p = await resolverOferta('https://meli.la/1JC7ZMh', { http });
  assert.equal(p.id, 'MLB4049279695');
  assert.deepEqual(pedidos, ['https://meli.la/1JC7ZMh']);
  await assert.rejects(
    resolverOferta('https://meli.la/x', { http: async () => ({ status: 200, url: 'https://www.mercadolivre.com.br/captcha/wall/logged?go_url=x', html: 'Por segurança, complete esta etapa' }) }),
    ErroVerificacao
  );
  await assert.rejects(resolverOferta('https://www.mercadolivre.com.br/ofertas', { http }), /não é de um produto/);
  await assert.rejects(resolverOferta('https://meli.la/x', { http: async () => ({ status: 404, url: 'https://meli.la/x', html: '' }) }), /HTTP 404/);
});

test('resolverFontes: liga a fonte ao grupo pelo nome (ou avisa)', () => {
  const whats = [{ nome: 'Promoções do Zé 🔥', jid: '1@g.us' }, { nome: 'Achadinhos #12', jid: '2@g.us' }, { nome: 'Achadinhos #13', jid: '3@g.us' }];
  const r = resolverFontes([{ nome: 'promocoes do ze' }, { nome: 'Achadinhos' }, { nome: 'Sumiu' }, { nome: 'Achadinhos #13', ativo: false }, { jid: '2@g.us', nome: 'x' }], whats);
  assert.deepEqual(r.ok.map((f) => f.jid), ['1@g.us', '2@g.us']);
  assert.equal(r.problemas.length, 2);
  assert.match(r.problemas[0], /2 grupos/);
  assert.match(r.problemas[1], /não achei/);
});

// A página social do fixture não traz o rótulo de vendas; nos testes que não são da regra de vendas, ele é acrescentado.
const comVendas = (p) => ({ ...p, vendidos: '+500 vendidos' });

function montar({ msgs, resolver, createLinks, cfg = {}, agora = { t: 1_800_000_000_000 }, manual = false }) {
  const store = tmpStore();
  const sender = { lerMensagens: async () => msgs() };
  const affiliate = { refreshes: 0, refresh: async function () { this.refreshes++; }, createLinks: createLinks || (async (urls) => new Map(urls.map((u) => [u, 'https://meli.la/MEU1']))) };
  const espelho = new Espelho({
    sender, store, affiliate,
    fontes: [{ nome: 'Fonte A', nomeWhats: 'Fonte A', jid: 'A@g.us', destino: 'Geral', manual }],
    grupos: [{ nome: 'Geral', jid: 'MEU@g.us', filtros: { descontoMinimo: 20, precoMinimo: 15, precoMaximo: 5000, diasSemRepetir: 5, palavrasBloqueadas: ['usado'] } }],
    cfg: { pausaEntreConsultasSeg: 0, ...cfg },
    resolver: resolver || (async () => comVendas(parseSocialPage(fx('social-meli-la.html')))),
    agora: () => agora.t, esperar: async () => {},
  });
  return { store, espelho, affiliate, agora };
}
const seg = (agora, minAtras = 0) => Math.floor(agora.t / 1000) - minAtras * 60;

test('Espelho: mensagem nova com link vira oferta PRONTA com o MEU link e fura a fila', async () => {
  const agora = { t: 1_800_000_000_000 };
  const lista = [
    { id: 'm-antiga', jid: 'A@g.us', t: seg(agora, 300), tipo: 'image', texto: 'velha https://meli.la/velha' },
    { id: 'm-semlink', jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'bom dia grupo' },
    { id: 'm-nova', jid: 'A@g.us', t: seg(agora, 2), tipo: 'image', texto: '🔥 TÊNIS KAPPA\nhttps://meli.la/1JC7ZMh\nEntre no grupo https://chat.whatsapp.com/ABC' },
  ];
  const { store, espelho, affiliate } = montar({ msgs: () => lista, agora });
  store.upsert({ id: 'MLB9', grupo: 'Geral', nome: 'Da busca própria', url: 'https://p/9', imagem: 'i', precoAtual: 10, descontoPct: 90 });
  store.setLink('https://p/9', 'https://meli.la/proprio');

  const r = await espelho.tick();
  assert.deepEqual({ novas: r.novas, enfileiradas: r.enfileiradas, ignoradas: r.ignoradas }, { novas: 2, enfileiradas: 1, ignoradas: { 'sem link do ML/Amazon': 1 } });
  const p = store.proximo('Geral');
  assert.equal(p.id, 'MLB4049279695'); // a do espelho vem antes da de 90% da busca própria
  assert.equal(p.origem, 'espelho');
  assert.equal(p.linkAfiliado, 'https://meli.la/MEU1');
  assert.equal(p.status, 'PRONTO');
  assert.equal(affiliate.refreshes, 1);

  // a mensagem montada é nossa: nada do texto, do link ou do convite do outro grupo
  const legenda = montarLegenda(p, { titulo: 'x' });
  assert.match(legenda, /https:\/\/meli\.la\/MEU1/);
  assert.doesNotMatch(legenda, /1JC7ZMh|chat\.whatsapp\.com|TÊNIS KAPPA/);

  // segunda rodada com as mesmas mensagens: nada novo
  const r2 = await espelho.tick();
  assert.equal(r2.novas, 0);
});

test('Espelho: oferta do ML sem rótulo de vendas não entra (automático); na caixa de entrada do dono, entra', async () => {
  const agora = { t: 1_800_000_000_000 };
  const msg = [{ id: 'v1', jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'oferta https://meli.la/1JC7ZMh' }];
  const semRotulo = async () => parseSocialPage(fx('social-meli-la.html')); // a página social real não mostra vendas
  const auto = montar({ msgs: () => msg, agora, resolver: semRotulo });
  const r = await auto.espelho.tick();
  assert.deepEqual({ enfileiradas: r.enfileiradas, ignoradas: r.ignoradas }, { enfileiradas: 0, ignoradas: { 'ML sem dado de vendas (o espelho não lê as vendas)': 1 } });
  const dono = montar({ msgs: () => msg, agora, resolver: semRotulo, manual: true });
  dono.espelho.responder = async () => {};
  assert.equal((await dono.espelho.tick()).enfileiradas, 1);
});

test('Canal liberado pelo dono ("exigirVendas": false): ML sem rótulo entra e passa na conferência antes de postar; os outros filtros continuam', async () => {
  const agora = { t: 1_800_000_000_000 };
  const msg = [{ id: 'l1', jid: 'A@g.us', t: seg(agora, 1), tipo: 'image', texto: '💰 De R$ 1.079 por R$ 697\nhttps://meli.la/1JC7ZMh', foto: 'https://cdn.telesco.pe/file/ambiente.jpg' }];
  const semRotulo = async () => ({ ...parseSocialPage(fx('social-meli-la.html')), precoAtual: 696.9 });
  const liberado = montar({ msgs: () => msg, agora, resolver: semRotulo });
  Object.assign(liberado.espelho.fontes.get('A@g.us'), { exigirVendas: false, fotoDoCanal: true });
  assert.equal((await liberado.espelho.tick()).enfileiradas, 1);
  const p = liberado.store.proximo('Geral');
  assert.equal(p.semRegraVendas, true);
  assert.equal(p.imagem, 'https://cdn.telesco.pe/file/ambiente.jpg'); // preço bate (697 ≈ 696,90): a foto do canal

  // preço da mensagem diferente do anúncio (a arte pode ter o preço velho escrito): fica a foto do ML
  const outroPreco = montar({ msgs: () => msg, agora, resolver: async () => ({ ...(await semRotulo()), precoAtual: 749 }) });
  Object.assign(outroPreco.espelho.fontes.get('A@g.us'), { exigirVendas: false, fotoDoCanal: true });
  await outroPreco.espelho.tick();
  assert.equal(outroPreco.store.proximo('Geral').imagem, parseSocialPage(fx('social-meli-la.html')).imagem);
  const postados = [];
  const destino = { sendImage: async (jid, img, texto) => (postados.push(texto), { comImagem: true }), sendText: async (jid, t) => postados.push(t) };
  assert.ok(await enviarProximo(destino, { nome: 'Geral', jid: 'MEU@g.us', filtros: { diasSemRepetir: 5 } }, liberado.store));
  assert.equal(postados.length, 1);

  // o nicho do grupo continua valendo: loadGrupos põe as palavras do nicho em filtros.palavrasObrigatorias
  const nicho = montar({ msgs: () => msg, agora, resolver: async () => ({ ...(await semRotulo()), nome: 'Fone Bluetooth Sem Fio' }) });
  nicho.espelho.fontes.get('A@g.us').exigirVendas = false;
  nicho.espelho.grupos.get('Geral').filtros.palavrasObrigatorias = ['perfume', 'body splash'];
  assert.deepEqual((await nicho.espelho.tick()).ignoradas, { 'fora do nicho': 1 });

  // continua barrando o resto (aqui: palavra bloqueada)
  const bloqueado = montar({ msgs: () => msg, agora, resolver: async () => ({ ...(await semRotulo()), nome: 'Perfume usado 100ml' }) });
  bloqueado.espelho.fontes.get('A@g.us').exigirVendas = false;
  assert.deepEqual((await bloqueado.espelho.tick()).ignoradas, { 'palavra bloqueada': 1 });
});

test('fontesDosCanais: canal com opções próprias (destino, ML, sem regra de vendas); os outros seguem o bloco', () => {
  const nichos = { perfumes: { obrigatorias: ['perfume'] } };
  const c = { soAmazon: true, destinos: [{ grupo: 'Geral' }, { grupo: 'Perfumes', nicho: 'perfumes' }], canais: ['urubupromo', { canal: '@promobigodeperfumes', destino: 'Perfumes', soAmazon: false, exigirVendas: false }] };
  const [a, b] = fontesDosCanais(c, { nichos, lojasParceiras: true });
  assert.deepEqual([a.nome, a.soAmazon, a.exigirVendas, a.destinos.map((d) => d.grupo)], ['@urubupromo', true, true, ['Geral', 'Perfumes']]);
  assert.deepEqual([b.nome, b.jid, b.destino, b.soAmazon, b.exigirVendas, b.destinos.map((d) => d.grupo)], ['@promobigodeperfumes', 'canal:promobigodeperfumes', 'Perfumes', false, false, ['Perfumes']]);
  // sem etiqueta da Amazon e sem Awin, o canal "só Amazon" não aproveita nada e sai; o de ML fica
  assert.deepEqual(fontesDosCanais(c, { nichos }).map((f) => f.nome), ['@promobigodeperfumes']);
});

test('Espelho: respeita filtros, repetidos e limite por hora', async () => {
  const agora = { t: 1_800_000_000_000 };
  let n = 0;
  // nome diferente para cada id: produtos com o MESMO nome contam como o mesmo produto (duplicado na fila)
  const produto = (extra) => ({ ...comVendas(parseSocialPage(fx('social-meli-la.html'))), nome: `Produto ${extra.id}`, ...extra });
  const fila = [];
  const { store, espelho } = montar({
    msgs: () => fila, agora, cfg: { maxPorHora: 2 },
    resolver: async (link) => {
      n++;
      if (link.includes('barato')) return produto({ id: 'MLB-B', url: 'https://p/b', descontoPct: 5 });
      if (link.includes('usado')) return produto({ id: 'MLB-U', url: 'https://p/u', nome: 'Celular USADO' });
      if (link.includes('semdesc')) return produto({ id: 'MLB-S', url: 'https://p/s', descontoPct: null, precoOriginal: null });
      return produto({ id: 'MLB-' + link.slice(-1), url: 'https://p/' + link.slice(-1) });
    },
  });
  const nova = (id, link) => fila.push({ id, jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'x ' + link });
  nova('1', 'https://meli.la/barato'); nova('2', 'https://meli.la/usado'); nova('3', 'https://meli.la/semdesc'); nova('4', 'https://meli.la/ok1'); nova('5', 'https://meli.la/ok2');
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 2); // semdesc (desconto desconhecido passa) + ok1; ok2 bate no limite por hora
  assert.deepEqual(r.ignoradas, { 'desconto baixo': 1, 'palavra bloqueada': 1, 'limite por hora': 1 });
  assert.equal(store.list((p) => p.status === 'PRONTO').length, 2);

  // mesmo produto vindo de outra mensagem depois: não duplica
  agora.t += 61 * 60_000;
  fila.length = 0;
  fila.push({ id: '6', jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'de novo https://meli.la/ok1' });
  const r2 = await espelho.tick();
  assert.deepEqual(r2.ignoradas, { 'já está na fila': 1 });
});

test('Espelho: captcha do ML pausa o espelho em vez de insistir', async () => {
  const agora = { t: 1_800_000_000_000 };
  let consultas = 0;
  const fila = [1, 2, 3].map((i) => ({ id: 'c' + i, jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'https://meli.la/c' + i }));
  const { espelho } = montar({ msgs: () => fila, agora, resolver: async () => { consultas++; throw new ErroVerificacao('captcha'); } });
  const r = await espelho.tick();
  assert.equal(consultas, 1); // parou na primeira
  assert.deepEqual(r.ignoradas, { 'ML bloqueou': 1 });
  fila.push({ id: 'c9', jid: 'A@g.us', t: seg(agora, 0), tipo: 'chat', texto: 'https://meli.la/c9' });
  await espelho.tick();
  assert.equal(consultas, 1); // ainda pausado
  agora.t += 61 * 60_000;
  fila.push({ id: 'c10', jid: 'A@g.us', t: seg(agora, 0), tipo: 'chat', texto: 'https://meli.la/c10' });
  await espelho.tick();
  assert.equal(consultas, 2); // voltou depois da pausa
});

// ---------------------------------------------------------------- Amazon
import { asinDeUrl, dadosDoTexto, extrairLinksAmazon, linkAfiliadoAmazon, resolverLinkAmazon } from '../src/amazon-espelho.js';

test('Amazon: acha links, tira o ASIN e monta o link com a MINHA etiqueta', async () => {
  const txt = 'Olha https://amzn.to/3AbCdEf e https://www.amazon.com.br/Fritadeira-Air-Fryer/dp/B0CXYZ1234/ref=sr_1_3?tag=outro-20&keywords=x).';
  assert.deepEqual(extrairLinksAmazon(txt), ['https://amzn.to/3AbCdEf', 'https://www.amazon.com.br/Fritadeira-Air-Fryer/dp/B0CXYZ1234/ref=sr_1_3?tag=outro-20&keywords=x']);
  assert.equal(asinDeUrl('https://www.amazon.com.br/Fritadeira-Air-Fryer/dp/B0CXYZ1234/ref=sr_1_3?tag=outro-20'), 'B0CXYZ1234');
  assert.equal(asinDeUrl('https://www.amazon.com.br/gp/product/b0cxyz1234?psc=1'), 'B0CXYZ1234');
  assert.equal(asinDeUrl('https://www.amazon.com.br/s?k=fone'), null);
  assert.equal(linkAfiliadoAmazon('B0CXYZ1234', 'extra0306-20'), 'https://www.amazon.com.br/dp/B0CXYZ1234?tag=extra0306-20');
  const pedidos = [];
  const fetchImpl = async (u, o) => {
    pedidos.push([u, o.method, o.redirect]);
    return { headers: { get: () => 'https://www.amazon.com.br/dp/B0CXYZ1234?tag=outro-20&linkCode=sl1' } };
  };
  assert.equal(await resolverLinkAmazon('https://amzn.to/3AbCdEf', { fetchImpl }), 'B0CXYZ1234');
  assert.deepEqual(pedidos, [['https://amzn.to/3AbCdEf', 'HEAD', 'manual']]); // só o redirecionamento, sem abrir a página do produto
});

test('Amazon: lê nome, preços, desconto e cupom do texto da mensagem', () => {
  const d = dadosDoTexto(
    '🔥 *BAIXOU DEMAIS* 🔥\n\nFritadeira Air Fryer Mondial 4L Preta\n\n~De R$ 499,90~\n✅ Por R$ 299,90 à vista\n🎟️ Use o cupom: *AMZ10*\n\n🛒 https://amzn.to/3AbCdEf\n\nEntre no grupo: https://chat.whatsapp.com/XYZ'
  );
  assert.deepEqual(d, { nome: 'Fritadeira Air Fryer Mondial 4L Preta', precoAtual: 299.9, precoOriginal: 499.9, descontoPct: 40, cupom: 'AMZ10', precoObs: null });
  const d3 = dadosDoTexto('🥈 SEU BUMBUM MERECE\n\nPersonal Papel Higiênico Vip Folha Tripla Com 12 Rolos De 20M\n\n💡 selecione "Programe e Poupe"\npor 15,10 à vista\nhttps://link.amazon/x');
  assert.deepEqual([d3.nome, d3.precoAtual, d3.precoObs], ['Personal Papel Higiênico Vip Folha Tripla Com 12 Rolos De 20M', 15.1, 'no Programe e Poupe']);
  assert.equal(dadosDoTexto('Kit com 8 Potes Herméticos Electrolux\nDe R$ 89 por R$ 51 no Pix').precoObs, 'no Pix');
  const d2 = dadosDoTexto('Echo Dot 5ª geração Smart Speaker\nde R$ 449 por R$ 284 (37% OFF)\nhttps://amzn.to/x');
  assert.equal(d2.precoAtual, 284);
  assert.equal(d2.precoOriginal, 449);
  assert.equal(d2.descontoPct, 37);
  assert.equal(dadosDoTexto('https://amzn.to/x').nome, null);
});

test('Espelho: link da Amazon vira oferta PRONTA com a MINHA etiqueta, sem abrir a Amazon', async () => {
  const agora = { t: 1_800_000_000_000 };
  const store = tmpStore();
  let resolvidos = 0;
  const espelho = new Espelho({
    sender: { lerMensagens: async () => [
      { id: 'a1', jid: 'A@g.us', t: seg(agora, 1), tipo: 'image', texto: 'CORRE!!\nFone Bluetooth JBL Tune 520BT Preto\n~R$ 399,90~\nPor R$ 199,90\nhttps://amzn.to/3AbCdEf' },
      { id: 'a2', jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'Mouse gamer https://www.amazon.com.br/dp/B0MOUSE001?tag=outro-20 de R$ 100 por R$ 95' },
    ] },
    store,
    affiliate: { refresh: async () => {}, createLinks: async () => new Map() },
    fontes: [{ nome: 'Fonte A', nomeWhats: 'Fonte A', jid: 'A@g.us', destino: 'Geral' }],
    grupos: [{ nome: 'Geral', jid: 'MEU@g.us', filtros: { descontoMinimo: 20, precoMinimo: 15, precoMaximo: 5000, diasSemRepetir: 5 } }],
    cfg: { pausaEntreConsultasSeg: 0 },
    agora: () => agora.t, esperar: async () => {},
    amazonTag: 'extra0306-20',
    resolverAmazon: async () => { resolvidos++; return 'B0FONE0001'; },
  });
  const r = await espelho.tick();
  assert.deepEqual(r.ignoradas, { 'desconto baixo': 1 }); // o mouse tem só 5%
  assert.equal(r.enfileiradas, 1);
  assert.equal(resolvidos, 1);
  const p = store.proximo('Geral');
  assert.equal(p.id, 'AMZ-B0FONE0001');
  assert.equal(p.status, 'PRONTO');
  assert.equal(p.linkAfiliado, 'https://www.amazon.com.br/dp/B0FONE0001?tag=extra0306-20');
  assert.equal(p.nome, 'Fone Bluetooth JBL Tune 520BT Preto');
  assert.equal(p.descontoPct, 50);
  const legenda = montarLegenda(p, { titulo: 'x' });
  assert.match(legenda, /🛒 Ver oferta na Amazon:\nhttps:\/\/www\.amazon\.com\.br\/dp\/B0FONE0001\?tag=extra0306-20/);
  assert.match(legenda, /⏱️ Preço da Amazon às/);
  assert.doesNotMatch(legenda, /amzn\.to|outro-20|CORRE/);

  // sem etiqueta configurada, o espelho não posta Amazon
  const store2 = tmpStore();
  const e2 = new Espelho({ ...espelho, sender: { lerMensagens: async () => [{ id: 'b1', jid: 'A@g.us', t: seg(agora, 1), texto: 'x https://amzn.to/1' }] }, store: store2, affiliate: {}, fontes: [{ nome: 'Fonte A', jid: 'A@g.us', destino: 'Geral' }], grupos: [{ nome: 'Geral', jid: 'MEU@g.us', filtros: {} }], agora: () => agora.t, esperar: async () => {}, amazonTag: '' });
  assert.deepEqual((await e2.tick()).ignoradas, { 'Amazon sem etiqueta (AMAZON_PARTNER_TAG)': 1 });
});

test('legenda sem preço (Amazon sem preço na mensagem) não mostra "null"', () => {
  const txt = montarLegenda({ loja: 'amazon', nome: 'Kindle 11ª geração', precoAtual: null, linkAfiliado: 'https://www.amazon.com.br/dp/B0X?tag=t-20' }, { titulo: 'x' });
  assert.match(txt, /Confira o preço no link/);
  assert.doesNotMatch(txt, /null|undefined|⏱️/);
});

test('Caixa de entrada: oferta mandada pelo dono entra mesmo com desconto baixo, leva a foto e ele recebe a resposta', async () => {
  const agora = { t: 1_800_000_000_000 };
  const store = tmpStore();
  const respostas = [];
  const espelho = new Espelho({
    sender: {
      lerMensagens: async () => [
        { id: 'tg-555-1', jid: '555', t: seg(agora, 1), texto: 'Mouse gamer Logitech G203\nde R$ 100 por R$ 95\nhttps://www.amazon.com.br/dp/B0MOUSE001?tag=outro-20', foto: 'FILE123' },
        { id: 'tg-555-2', jid: '555', t: seg(agora, 1), texto: '/start', foto: null },
        { id: 'tg-555-3', jid: '555', t: seg(agora, 0), texto: 'de novo https://www.amazon.com.br/dp/B0MOUSE001', foto: null },
      ],
      sendText: async (jid, texto) => respostas.push([jid, texto]),
    },
    store,
    affiliate: { refresh: async () => {}, createLinks: async () => new Map() },
    fontes: [{ nome: 'Caixa de entrada', jid: '555', destino: 'Geral', manual: true }],
    grupos: [{ nome: 'Geral', jid: '-1001', filtros: { descontoMinimo: 20, precoMinimo: 150, diasSemRepetir: 5 } }],
    cfg: { pausaEntreConsultasSeg: 0 },
    agora: () => agora.t, esperar: async () => {},
    amazonTag: 'extra0306-20',
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  const p = store.proximo('Geral');
  assert.equal(p.linkAfiliado, 'https://www.amazon.com.br/dp/B0MOUSE001?tag=extra0306-20');
  assert.equal(p.imagem, 'FILE123');
  assert.equal(respostas.length, 3);
  assert.ok(respostas.every(([jid]) => jid === '555'));
  assert.match(respostas[0][1], /✅ Entrou na fila: Mouse gamer Logitech G203\nhttps:\/\/www\.amazon\.com\.br\/dp\/B0MOUSE001\?tag=extra0306-20/);
  assert.match(respostas[1][1], /Me mande/);
  assert.match(respostas[2][1], /Não entrou na fila: já está na fila/);
});

test('limite por hora próprio do canal ("maxPorHora" no canal) troca o do bloco', async () => {
  const agora = { t: 1_800_000_000_000 };
  const msgs = [1, 2, 3, 4].map((i) => ({ id: `h${i}`, jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: `oferta https://meli.la/X${i}` }));
  let n = 0;
  const resolver = async () => {
    n++;
    return { ...comVendas(parseSocialPage(fx('social-meli-la.html'))), id: `MLB9000${n}`, nome: `Perfume Diferente ${n}`, url: `https://p/${n}` };
  };
  const m = montar({ msgs: () => msgs, agora, resolver, cfg: { maxPorHora: 1 } });
  m.espelho.fontes.get('A@g.us').maxPorHora = 3;
  const r = await m.espelho.tick();
  assert.deepEqual({ enfileiradas: r.enfileiradas, ignoradas: r.ignoradas }, { enfileiradas: 3, ignoradas: { 'limite por hora': 1 } });
  const sem = montar({ msgs: () => msgs, agora, resolver, cfg: { maxPorHora: 1 } });
  assert.equal((await sem.espelho.tick()).enfileiradas, 1, 'sem o do canal, vale o do bloco');
});

test('fontesDosCanais: maxPorHora do canal só quando informado', () => {
  const [a, b] = fontesDosCanais({ canais: ['x', { canal: 'y', soAmazon: false, maxPorHora: 12 }] }, { lojasParceiras: true });
  assert.equal(a.maxPorHora, undefined);
  assert.equal(b.maxPorHora, 12);
});

test('texto copiado: troca só os links da oferta, tira convite/@ do outro canal e links de outras lojas', () => {
  const m = {
    textoVisivel: [
      '🔥 Whey Protein Max Titanium 900g',
      '',
      '💰 De R$ 199 por R$ 129',
      '🎟️ Cupom: VOLTA10',
      '👉 https://meli.la/AbC123',
      '🛍️ Na Shopee: https://s.shopee.com.br/xyz',
      'Entre no nosso grupo: https://t.me/+convite',
      'Via @urubupromo',
      '#TopFitAchados #Anúncio',
    ].join('\n'),
    links: ['https://meli.la/AbC123', 'https://meli.la/Escondido9'],
  };
  const trocas = { 'https://meli.la/AbC123': 'https://meli.la/MEU1', 'https://meli.la/Escondido9': 'https://meli.la/MEU2' };
  const t = textoCopiado(m, (u) => trocas[u] || null);
  assert.equal(t, '🔥 Whey Protein Max Titanium 900g\n\n💰 De R$ 199 por R$ 129\n🎟️ Cupom: VOLTA10\n👉 https://meli.la/MEU1\n🛒 https://meli.la/MEU2');
  assert.doesNotMatch(t, /shopee|t\.me|@urubupromo|AbC123/);
  // nada para trocar: não copia
  assert.equal(textoCopiado({ textoVisivel: 'Só Shopee https://s.shopee.com.br/x' }, () => null), null);
});

test('canal com "copiarTexto": post do ML sai IGUAL ao do canal (foto dele, links do dono) e vai para o grupo do nicho', async () => {
  const agora = { t: 1_800_000_000_000 };
  const texto = '🔥 Perfume Lattafa Asad 100ml\n💰 De R$ 399 por R$ 199\n👉 https://meli.la/1JC7ZMh\nVia @outrocanal';
  const msg = [{ id: 'c1', jid: 'A@g.us', t: seg(agora, 1), tipo: 'image', texto, textoVisivel: texto, links: ['https://meli.la/1JC7ZMh'], foto: 'https://cdn.telesco.pe/file/arte.jpg' }];
  const resolver = async () => ({ ...parseSocialPage(fx('social-meli-la.html')), nome: 'Perfume Lattafa Asad Eau de Parfum 100ml', descontoPct: 5 }); // sem vendas e desconto baixo: passa assim mesmo
  const m = montar({ msgs: () => msg, agora, resolver });
  m.espelho.grupos.set('Perfumes', { nome: 'Perfumes', jid: 'PERF@g.us', filtros: { palavrasObrigatorias: ['perfume'], descontoMinimo: 20, diasSemRepetir: 5 } });
  m.espelho.grupos.set('Fitness', { nome: 'Fitness', jid: 'FIT@g.us', filtros: { palavrasObrigatorias: ['whey'], diasSemRepetir: 5 } });
  Object.assign(m.espelho.fontes.get('A@g.us'), {
    copiarTexto: true,
    exigirVendas: false,
    destinos: [{ grupo: 'Geral', palavras: null }, { grupo: 'Perfumes', palavras: ['perfume'] }, { grupo: 'Fitness', palavras: ['whey'] }],
  });
  const r = await m.espelho.tick();
  assert.equal(r.enfileiradas, 1);
  const naFila = m.store.list();
  assert.deepEqual(naFila.map((p) => p.grupo).sort(), ['Geral', 'Perfumes']);
  const p = naFila.find((x) => x.grupo === 'Perfumes');
  assert.equal(p.imagem, 'https://cdn.telesco.pe/file/arte.jpg');
  assert.equal(p.textoPronto, '🔥 Perfume Lattafa Asad 100ml\n💰 De R$ 399 por R$ 199\n👉 https://meli.la/MEU1');
  assert.equal(montarLegenda(p, { titulo: 'IGNORADO', mensagemAdicional: '' }), p.textoPronto);
  const postados = [];
  const destino = { sendImage: async (jid, img, t) => (postados.push([img, t]), { comImagem: true }), sendText: async () => {} };
  await enviarProximo(destino, { nome: 'Perfumes', jid: 'PERF@g.us', filtros: { diasSemRepetir: 5 } }, m.store);
  assert.deepEqual(postados, [['https://cdn.telesco.pe/file/arte.jpg', p.textoPronto]]);
});

test('canal com "fotoDoCanal": false (foto com a marca do canal): o post copiado sai com a foto do anúncio', async () => {
  const agora = { t: 1_800_000_000_000 };
  const texto = '🔥 Perfume Lattafa Asad 100ml\n💰 Por R$ 199\n👉 https://meli.la/1JC7ZMh';
  const msg = [{ id: 'c9', jid: 'A@g.us', t: seg(agora, 1), tipo: 'image', texto, textoVisivel: texto, links: ['https://meli.la/1JC7ZMh'], foto: 'https://cdn.telesco.pe/file/com-selo-do-canal.jpg' }];
  const resolver = async () => ({ ...parseSocialPage(fx('social-meli-la.html')), nome: 'Perfume Lattafa Asad 100ml', imagem: 'https://http2.mlstatic.com/foto-do-anuncio.jpg' });
  const m = montar({ msgs: () => msg, agora, resolver });
  Object.assign(m.espelho.fontes.get('A@g.us'), { copiarTexto: true, exigirVendas: false, fotoDoCanal: false, destinos: [{ grupo: 'Geral', palavras: null }] });
  assert.equal((await m.espelho.tick()).enfileiradas, 1);
  assert.equal(m.store.list()[0].imagem, 'https://http2.mlstatic.com/foto-do-anuncio.jpg');
});

test('caixa de entrada com o grupo padrão pausado: a oferta vai para o grupo cujo nicho casa com o produto', async () => {
  const agora = { t: 1_800_000_000_000 };
  const msg = (id) => [{ id, jid: 'A@g.us', t: seg(agora, 1), tipo: 'chat', texto: 'olha https://meli.la/1JC7ZMh' }];
  const comNome = (nome) => async () => ({ ...comVendas(parseSocialPage(fx('social-meli-la.html'))), nome });
  const preparar = (id, nome) => {
    const m = montar({ msgs: () => msg(id), agora, resolver: comNome(nome), manual: true });
    m.espelho.grupos.get('Geral').ativo = false;
    m.espelho.grupos.set('Fitness', { nome: 'Fitness', ativo: true, filtros: {} });
    m.espelho.grupos.set('Perfumes', { nome: 'Perfumes', ativo: true, filtros: {} });
    m.espelho.fontes.get('A@g.us').destinos = [{ grupo: 'Fitness', palavras: ['whey'] }, { grupo: 'Perfumes', palavras: ['perfume'] }];
    m.espelho.responder = async () => {};
    return m;
  };
  const a = preparar('cx1', 'Perfume Lattafa Yara 100ml');
  assert.equal((await a.espelho.tick()).enfileiradas, 1);
  assert.equal(a.store.list()[0].grupo, 'Perfumes');
  const b = preparar('cx2', 'Air Fryer Mondial 4L');
  assert.deepEqual((await b.espelho.tick()).ignoradas, { 'fora do nicho dos grupos': 1 });
});
