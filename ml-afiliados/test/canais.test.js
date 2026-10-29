import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCanal, jidDoCanal, LeitorDeCanais, fontesDosCanais } from '../src/telegram-canais.js';
import { resolverLinkAmazon } from '../src/amazon-espelho.js';
import { Espelho } from '../src/espelho.js';
import { montarLegenda } from '../src/caption.js';
import { Store } from '../src/store.js';

const tmpStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));

const PAGINA = `<section>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="urubupromo/901">
<a class="tgme_widget_message_photo_wrap 1 2" href="https://t.me/urubupromo/901" style="width:800px;background-image:url('https://cdn1.telesco.pe/file/FOTO.jpg')"></a>
<div class="tgme_widget_message_text js-message_text" dir="auto"><b>URUBU NA COZINHA</b><br/><br/>Processador de Alimentos Philco 420W<br/><br/>De R$ 199 por R$ 123,25 &amp; frete gr&#225;tis<br/><a href="https://link.amazon/B04nIB5MB" target="_blank">https://link.amazon/B04nIB5MB</a></div>
<div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/urubupromo/901"><time datetime="2027-01-15T08:00:00+00:00" class="time">08:00</time></a></div></div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="urubupromo/902">
<div class="tgme_widget_message_text js-message_text" dir="auto">Tênis <a href="https://meli.la/abc">aqui</a></div>
<a class="tgme_widget_message_date" href="x"><time datetime="2027-01-15T08:01:00+00:00" class="time">08:01</time></a></div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="urubupromo/903">só um vídeo, sem texto</div></div>
</section>`;

test('Canal público do Telegram: lê texto, links, foto e hora da página t.me/s', () => {
  const msgs = parseCanal(PAGINA, 'urubupromo');
  assert.deepEqual(msgs.map((m) => m.id), ['tgc-urubupromo/901', 'tgc-urubupromo/902']);
  assert.deepEqual(msgs[0], {
    id: 'tgc-urubupromo/901',
    jid: 'canal:urubupromo',
    t: Date.UTC(2027, 0, 15, 8) / 1000,
    tipo: 'image',
    texto: 'URUBU NA COZINHA\n\nProcessador de Alimentos Philco 420W\n\nDe R$ 199 por R$ 123,25 & frete grátis\nhttps://link.amazon/B04nIB5MB\nhttps://link.amazon/B04nIB5MB',
    textoVisivel: 'URUBU NA COZINHA\n\nProcessador de Alimentos Philco 420W\n\nDe R$ 199 por R$ 123,25 & frete grátis\nhttps://link.amazon/B04nIB5MB',
    links: ['https://link.amazon/B04nIB5MB'],
    foto: 'https://cdn1.telesco.pe/file/FOTO.jpg',
  });
  assert.match(msgs[1].texto, /https:\/\/meli\.la\/abc/); // link escondido atrás de uma palavra
  assert.equal(jidDoCanal('https://t.me/s/urubupromo'), 'canal:urubupromo');
  assert.equal(jidDoCanal('@urubupromo'), 'canal:urubupromo');
});

test('Canal público do Telegram: oferta da Amazon entra sozinha com a MINHA etiqueta; ML do canal é ignorado', async () => {
  const agora = { t: Date.UTC(2027, 0, 15, 8, 5) };
  const store = tmpStore();
  const pedidos = [];
  const leitor = new LeitorDeCanais({ fetchImpl: async (u) => (u.includes('fora') ? { ok: false, status: 404 } : { ok: true, text: async () => PAGINA }) });
  const fetchImpl = async (u, o) => {
    pedidos.push(`${o.method} ${u}`);
    let destino = 'https://www.amazon.com.br/Processador/dp/B0F3ZMZ45P?tag=urutelegram-20';
    if (u.includes('link.amazon')) destino = o.method === 'HEAD' ? null : 'https://amzlinks.in/B04nIB5MB';
    return { headers: { get: () => destino } };
  };
  const espelho = new Espelho({
    sender: leitor,
    store,
    affiliate: { refresh: async () => {}, createLinks: async () => new Map() },
    fontes: [
      { nome: '@urubupromo', jid: 'canal:urubupromo', destino: 'Geral', soAmazon: true },
      { nome: '@fora', jid: 'canal:fora', destino: 'Geral', soAmazon: true },
    ],
    grupos: [{ nome: 'Geral', jid: '-1001', filtros: { descontoMinimo: 20, diasSemRepetir: 5 } }],
    cfg: { pausaEntreConsultasSeg: 0 },
    agora: () => agora.t,
    esperar: async () => {},
    amazonTag: 'extra0306-20',
    resolverAmazon: (link) => resolverLinkAmazon(link, { fetchImpl }),
  });
  const r = await espelho.tick();
  assert.deepEqual({ enfileiradas: r.enfileiradas, ignoradas: r.ignoradas }, { enfileiradas: 1, ignoradas: { 'sem link do ML/Amazon': 1 } });
  // só redirecionamentos, nunca a página do produto
  assert.deepEqual(pedidos, ['HEAD https://link.amazon/B04nIB5MB', 'GET https://link.amazon/B04nIB5MB', 'HEAD https://amzlinks.in/B04nIB5MB']);
  const p = store.proximo('Geral');
  assert.equal(p.linkAfiliado, 'https://www.amazon.com.br/dp/B0F3ZMZ45P?tag=extra0306-20');
  assert.equal(p.nome, 'Processador de Alimentos Philco 420W');
  assert.equal(p.precoAtual, 123.25);
  assert.equal(p.imagem, 'https://cdn1.telesco.pe/file/FOTO.jpg');
  assert.doesNotMatch(montarLegenda(p, { titulo: 'x' }), /urutelegram|link\.amazon|URUBU/);
});

test('Canal público do Telegram: a oferta vai para cada grupo ligado cujo nicho casa, com limite por grupo', async () => {
  const agora = { t: Date.UTC(2027, 0, 15, 8, 5) };
  const store = tmpStore();
  const t = Math.floor(agora.t / 1000) - 60;
  const msgs = [
    { id: 'c1', jid: 'canal:x', t, texto: 'Creatina Monohidratada Dark Lab 1kg\nDe R$ 120 por R$ 60\nhttps://www.amazon.com.br/dp/B0CREATINA' },
    { id: 'c2', jid: 'canal:x', t, texto: 'Perfume Importado Intense 105ml\nDe R$ 400 por R$ 200\nhttps://www.amazon.com.br/dp/B0PERFUME1' },
    { id: 'c3', jid: 'canal:x', t, texto: 'Whey Protein Concentrado 900g\nDe R$ 200 por R$ 100\nhttps://www.amazon.com.br/dp/B0WHEY0001' },
  ];
  const espelho = new Espelho({
    sender: { lerMensagens: async () => msgs },
    store,
    affiliate: {},
    fontes: [{
      nome: '@x', jid: 'canal:x', destino: 'Geral', soAmazon: true,
      destinos: [{ grupo: 'Geral', palavras: null }, { grupo: 'Fitness', palavras: ['creatina', 'whey'] }, { grupo: 'Beleza', palavras: ['perfume'] }, { grupo: 'Casa', palavras: null }],
    }],
    grupos: [
      { nome: 'Geral', ativo: true, filtros: {} },
      { nome: 'Fitness', ativo: true, filtros: {} },
      { nome: 'Beleza', ativo: true, filtros: {} },
      { nome: 'Casa', ativo: false, filtros: {} }, // desligado: nunca recebe
    ],
    cfg: { maxPorHora: 1 },
    agora: () => agora.t,
    esperar: async () => {},
    amazonTag: 'extra0306-20',
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 2); // a creatina e o perfume; o whey bate no limite de Geral e de Fitness
  assert.deepEqual(r.ignoradas, { 'limite por hora': 1 });
  const fila = store.list((p) => p.status === 'PRONTO').map((p) => `${p.grupo}:${p.asin}`).sort();
  assert.deepEqual(fila, ['Beleza:B0PERFUME1', 'Fitness:B0CREATINA', 'Geral:B0CREATINA']); // o perfume não entrou no Geral (limite), mas entrou em Beleza
});

test('canal "apenasAmazon": só as ofertas da Amazon (ML/Awin ficam de fora), no formato do bot, só com etiqueta', async () => {
  const c = { canais: [{ canal: 'urubupromo', apenasAmazon: true, copiarTexto: false }], copiarTexto: true, fotoDoCanal: true };
  const [f] = fontesDosCanais(c, { lojasParceiras: true, amazonTag: 'achadin09027e-20' });
  assert.equal(f.apenasAmazon, true);
  assert.equal(f.soAmazon, true);
  assert.equal(f.lojasParceiras, false);
  assert.equal(f.copiarTexto, false);
  assert.deepEqual(fontesDosCanais(c, { lojasParceiras: true, amazonTag: '' }), [], 'sem etiqueta não liga');

  const agora = { t: Date.UTC(2027, 0, 15, 8, 5) };
  const t = Math.floor(agora.t / 1000) - 60;
  const store = tmpStore();
  const espelho = new Espelho({
    sender: { lerMensagens: async () => [
      { id: 'a1', jid: f.jid, t, texto: 'Fone Bluetooth JBL Tune\nDe R$ 300 por R$ 150\nhttps://www.amazon.com.br/dp/B0FONE0001' },
      { id: 'a2', jid: f.jid, t, texto: 'Tênis Feminino\nPor R$ 99\nhttps://meli.la/abc' },
    ] },
    store, affiliate: {}, fontes: [f], grupos: [{ nome: 'Geral', ativo: true, filtros: {} }],
    agora: () => agora.t, esperar: async () => {}, amazonTag: 'achadin09027e-20',
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  assert.deepEqual(r.ignoradas, { 'sem link da Amazon': 1 });
  const [p] = store.list();
  assert.equal(p.linkAfiliado, 'https://www.amazon.com.br/dp/B0FONE0001?tag=achadin09027e-20');
  assert.equal(p.textoPronto, undefined, 'formato do bot, não cópia');
});

test('canal com "mlPeloNome" (29/10/2026): a oferta do ML é achada pela API oficial com o nome e o preço do post, sem abrir o meli.la', async () => {
  const c = { canais: ['promobigodeperfumes'], apenasAmazon: true, mlPeloNome: true, exigirVendas: false, destinos: [{ grupo: 'Perfumes' }] };
  const [f] = fontesDosCanais(c, { amazonTag: 'achadin09027e-20' });
  assert.equal(f.mlPeloNome, true);
  // Respostas reais da API (29/10/2026), resumidas: a busca devolve o refil antes do frasco.
  const caminhos = [];
  const mlApi = {
    configurada: true,
    get: async (c) => {
      caminhos.push(c.split('?')[0]);
      if (c.startsWith('/products/search') && /Oud/.test(decodeURIComponent(c))) return { results: [{ id: 'MLB111', name: 'Refil Deo Parfum Natura Essencial Oud Masculino 100ml' }, { id: 'MLB222', name: 'Deo Parfum Natura Essencial Oud 100ml' }] };
      if (c.startsWith('/products/search')) return { results: [{ id: 'MLB333', name: 'Perfume Natura Kaiak Pulso Masculino 100ml' }] };
      if (c.startsWith('/products/MLB222/items')) return { results: [
        { item_id: 'MLB5001', price: 189.9, condition: 'new' },
        { item_id: 'MLB5002', price: 169.98, original_price: 249.9, official_store_id: 1, condition: 'new', shipping: { free_shipping: true } },
      ] };
      throw new Error(`não esperado: ${c}`);
    },
    produto: async (id) => ({ nome: 'Deo Parfum Natura Essencial Oud 100ml', imagem: `https://http2.mlstatic.com/${id}.jpg` }),
    salvarCache() {},
  };
  const links = [];
  const affiliate = { refresh: async () => {}, createLinks: async (urls) => (links.push(...urls), new Map(urls.map((u) => [u, 'https://meli.la/MEU1']))) };
  const agora = { t: Date.UTC(2027, 0, 15, 11, 5) };
  const t = Math.floor(agora.t / 1000) - 60;
  const store = tmpStore();
  const espelho = new Espelho({
    sender: { lerMensagens: async () => [
      { id: 'b1', jid: f.jid, t, texto: 'Natura Essencial Oud 100ml\n💸 Por R$ 169\n🛒 https://meli.la/2xYz' },
      { id: 'b2', jid: f.jid, t, texto: 'Perfume Natura K Max 100ml\nR$ 153\nhttps://meli.la/3abc' }, // a busca só acha outro perfume
      { id: 'b3', jid: f.jid, t, texto: 'Natura Essencial Oud 100ml\n💸 Por R$ 169\n🛒 https://meli.la/9qwe' }, // o mesmo, em outro post
    ] },
    store, affiliate, fontes: [f], grupos: [{ nome: 'Geral', ativo: false, filtros: {} }, { nome: 'Perfumes', ativo: true, filtros: { diasSemRepetir: 5 } }], // o Geral (pausado) é o destino padrão
    agora: () => agora.t, esperar: async () => {}, amazonTag: 'achadin09027e-20', mlApi,
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  assert.deepEqual(r.ignoradas, { 'ML: produto do post não achado': 1, 'já está na fila': 1 });
  const [p] = store.list();
  assert.equal(p.id, 'MLB5002', 'o anúncio com o preço do post, não o mais caro nem o refil');
  assert.equal(p.nome, 'Deo Parfum Natura Essencial Oud 100ml');
  assert.equal(p.url, 'https://produto.mercadolivre.com.br/MLB-5002-deo-parfum-natura-essencial-oud-100ml-_JM');
  assert.deepEqual([p.precoAtual, p.precoOriginal, p.descontoPct], [169.98, 249.9, 32]);
  assert.equal(p.linkAfiliado, 'https://meli.la/MEU1');
  assert.equal(p.semRegraVendas, true);
  assert.equal(p.status, 'PRONTO');
  assert.deepEqual(links, [p.url], 'um link só: o meli.la do outro canal nunca é aberto');
  assert.equal(caminhos.filter((c) => c === '/products/search').length, 2, 'o post repetido não busca de novo');

  // API recusando (ex.: HTTP 429): pausa o ML dos canais por 15 min em vez de insistir; a Amazon segue.
  const store2 = tmpStore();
  const e2 = new Espelho({
    sender: { lerMensagens: async () => [
      { id: 'c1', jid: f.jid, t, texto: 'Lattafa Asad 100ml\nR$ 213\nhttps://meli.la/1' },
      { id: 'c2', jid: f.jid, t, texto: 'Lattafa Yara 100ml\nR$ 180\nhttps://meli.la/2' },
      { id: 'c3', jid: f.jid, t, texto: 'Perfume Lattafa Yara 100ml\nDe R$ 300 por R$ 199\nhttps://www.amazon.com.br/dp/B0YARA0001' },
    ] },
    store: store2, affiliate, fontes: [f], grupos: [{ nome: 'Geral', ativo: false, filtros: {} }, { nome: 'Perfumes', ativo: true, filtros: {} }],
    agora: () => agora.t, esperar: async () => {}, amazonTag: 'achadin09027e-20',
    mlApi: { ...mlApi, get: async () => { throw new Error('HTTP 429 em /products/search'); } },
  });
  const r2 = await e2.tick();
  assert.deepEqual(r2.ignoradas, { 'API do ML indisponível': 1, 'ML pausado': 1 });
  assert.equal(r2.enfileiradas, 1, 'a Amazon do mesmo canal entra');

  // No máximo 20 buscas novas por hora na API (é a mesma que traz os mais vendidos nas coletas).
  const e3 = new Espelho({
    sender: { lerMensagens: async () => [{ id: 'd1', jid: f.jid, t, texto: 'Lattafa Khamrah 100ml\nR$ 199\nhttps://meli.la/4' }] },
    store: tmpStore(), affiliate, fontes: [f], grupos: [{ nome: 'Geral', ativo: false, filtros: {} }, { nome: 'Perfumes', ativo: true, filtros: {} }],
    agora: () => agora.t, esperar: async () => {}, amazonTag: 'achadin09027e-20', mlApi,
  });
  e3.buscasML = Array(20).fill(agora.t - 10 * 60_000);
  assert.deepEqual((await e3.tick()).ignoradas, { 'ML: limite de buscas por hora': 1 });
});

test('grupo do Telegram para copiar ("A Promo da Luh", 27/10/2026): casa pelo título, sem ML, só o que passa nas regras de cada grupo', async () => {
  const { fonteDoGrupoTelegram } = await import('../src/telegram-canais.js');
  const { loadNichos } = await import('../src/config.js');
  const c = { grupos: [{ titulo: 'Promo da Luh' }], destinos: [{ grupo: 'Fitness', nicho: 'fitness' }, { grupo: 'Beleza', nicho: 'beleza' }], semML: true, copiarTexto: false, fotoDoCanal: false, maxPorHora: 4 };
  const opcoes = { nichos: loadNichos(), lojasParceiras: false };
  assert.equal(fonteDoGrupoTelegram(c, { jid: '-100', titulo: 'Outro Grupo de Promo' }, opcoes), null);
  assert.equal(fonteDoGrupoTelegram({ ...c, ativo: false }, { jid: '-100', titulo: 'A Promo da Luh 🛍🌸' }, opcoes), null);
  const f = fonteDoGrupoTelegram(c, { jid: '-100', titulo: 'A Promo da Luh 🛍🌸' }, opcoes);
  assert.equal(f.jid, '-100');
  assert.equal(f.semML, true);
  assert.equal(f.maxPorHora, 4);
  assert.deepEqual(f.destinos.map((d) => d.grupo), ['Fitness', 'Beleza']);

  const agora = { t: Date.UTC(2027, 0, 15, 8, 5) };
  const t = Math.floor(agora.t / 1000) - 60;
  const store = tmpStore();
  const espelho = new Espelho({
    sender: { lerMensagens: async () => [
      { id: 'l1', jid: '-100', t, foto: 'FOTO_COM_LOGO', texto: 'Creatina Growth 250g\nDe R$ 120 por R$ 69\nhttps://www.amazon.com.br/dp/B0CREAT001' },
      { id: 'l2', jid: '-100', t, texto: 'Creatina Max Titanium\nPor R$ 59\nhttps://meli.la/abc' },
      { id: 'l3', jid: '-100', t, texto: 'Air Fryer Mondial 4L\nDe R$ 400 por R$ 199\nhttps://www.amazon.com.br/dp/B0AIRF0001' },
    ] },
    store, affiliate: {}, fontes: [f], grupos: [{ nome: 'Fitness', ativo: true, filtros: {} }, { nome: 'Beleza', ativo: true, filtros: {} }],
    agora: () => agora.t, esperar: async () => {}, amazonTag: 'achadin09027e-20',
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  assert.deepEqual(r.ignoradas, { 'sem link do ML/Amazon': 1, 'fora do nicho': 1 }, 'ML ignorado sem abrir a página; air fryer fora do nicho');
  const [p] = store.list();
  assert.equal(p.grupo, 'Fitness');
  assert.equal(p.linkAfiliado, 'https://www.amazon.com.br/dp/B0CREAT001?tag=achadin09027e-20');
  assert.equal(p.imagem, null, 'a foto do outro grupo (pode ter a logo dele) não vai');
  assert.equal(p.textoPronto, undefined, 'formato do bot');
});

test('Telegram: o bot entrar/sair de um grupo avisa quem escuta (liga/desliga o grupo como fonte)', async () => {
  const { TelegramSender } = await import('../src/telegram.js');
  const mudanca = (id, de, para) => ({ update_id: id, my_chat_member: { chat: { id: -100, type: 'supergroup', title: 'A Promo da Luh' }, from: { id: 1 }, old_chat_member: { status: de }, new_chat_member: { status: para } } });
  const updates = [mudanca(1, 'left', 'member'), mudanca(2, 'member', 'member'), mudanca(3, 'member', 'kicked'), { update_id: 4, message: { message_id: 9, chat: { id: -100, type: 'supergroup' }, date: 1, text: 'oferta' } }];
  const tg = new TelegramSender({ token: 't', fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, result: updates }) }) });
  const vistos = [];
  tg.aoMudarNoGrupo = async (x) => vistos.push(x);
  const msgs = await tg.lerMensagens(['-100']);
  assert.deepEqual(vistos, [{ chatId: '-100', titulo: 'A Promo da Luh', dentro: true }, { chatId: '-100', titulo: 'A Promo da Luh', dentro: false }]);
  assert.deepEqual(msgs.map((m) => m.texto), ['oferta']);
});
