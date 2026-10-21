import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Antes de carregar a configuração: estes testes valem para o bot no Telegram (grupo sem canal = em espera).
process.env.SENDER = 'telegram';
process.env.SIMULAR_DIGITANDO = 'false'; // sem "digitando..." (só atrasaria os testes)
const { Awin, buscarCuponsAwin, extrairLinksLoja, lerLinkAwin, limparUrlLoja, linkAwin, lojaDaUrl, nomeDaLoja, ofertaDeCupom, resolverLinkLoja } = await import('../src/awin.js');
const { montarLegenda, tituloCupom } = await import('../src/caption.js');
const { Espelho } = await import('../src/espelho.js');
const { coletar } = await import('../src/pipeline.js');
const { Store } = await import('../src/store.js');
const { grupoDoTitulo } = await import('../src/telegram.js');
const { loadGrupos } = await import('../src/config.js');

const tmp = (nome) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), nome);
const tmpStore = () => new Store(tmp('db.json'));
const LOJAS = [
  { id: 79926, nome: 'adidas', dominios: ['adidas.com.br'], grupos: ['Fitness'] },
  { id: 76326, nome: 'Granado', dominios: ['granado.com.br'], grupos: ['Beleza', 'Perfumes'] },
];
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status });

test('Awin: monta o link de afiliado e lê o link de outro afiliado', () => {
  assert.equal(linkAwin(79926, 123456, 'https://www.adidas.com.br/tenis-x?cor=preto'), 'https://www.awin1.com/cread.php?awinmid=79926&awinaffid=123456&ued=https%3A%2F%2Fwww.adidas.com.br%2Ftenis-x%3Fcor%3Dpreto');
  assert.deepEqual(lerLinkAwin('https://www.awin1.com/cread.php?awinmid=79926&awinaffid=999&ued=https%3A%2F%2Fwww.adidas.com.br%2Ftenis-x'), { id: 79926, destino: 'https://www.adidas.com.br/tenis-x' });
  assert.equal(lerLinkAwin('https://www.adidas.com.br/x'), null);
  assert.equal(limparUrlLoja('https://www.adidas.com.br/tenis-x?cor=preto&utm_source=outro&awc=1_2_3&gclid=z#topo'), 'https://www.adidas.com.br/tenis-x?cor=preto');
  assert.equal(lojaDaUrl('https://www.granado.com.br/perfume', LOJAS).nome, 'Granado');
  assert.equal(lojaDaUrl('https://adidas.com.br.golpe.com/x', LOJAS), null); // domínio parecido não vale
  assert.equal(nomeDaLoja('Centauro BR'), 'Centauro');
  assert.deepEqual(extrairLinksLoja('Tênis https://tidd.ly/abc. e https://meli.la/x https://amzn.to/y https://t.me/canal (https://www.adidas.com.br/z)'), ['https://tidd.ly/abc', 'https://www.adidas.com.br/z']);
});

test('Awin: do link da mensagem até a loja — direto, link da Awin, encurtador; site desconhecido não é aberto', async () => {
  const pedidos = [];
  const fetchImpl = async (u, o) => {
    pedidos.push(`${o.method} ${u}`);
    return { headers: { get: () => (u.includes('tidd.ly') ? 'https://www.awin1.com/cread.php?awinmid=76326&awinaffid=1&ued=https%3A%2F%2Fwww.granado.com.br%2Fsabonete%3Futm_source%3Dx' : null) } };
  };
  assert.deepEqual(await resolverLinkLoja('https://www.adidas.com.br/tenis?fbclid=1', LOJAS, { fetchImpl }), { anunciante: LOJAS[0], url: 'https://www.adidas.com.br/tenis' });
  assert.equal((await resolverLinkLoja('https://tidd.ly/3abc', LOJAS, { fetchImpl })).url, 'https://www.granado.com.br/sabonete');
  assert.equal(await resolverLinkLoja('https://www.awin1.com/cread.php?awinmid=555&awinaffid=1&ued=https%3A%2F%2Floja-nao-aprovada.com%2Fx', LOJAS, { fetchImpl }), null);
  assert.equal(await resolverLinkLoja('https://site-qualquer.com/redir?id=1', LOJAS, { fetchImpl }), null);
  assert.equal(await resolverLinkLoja('https://tidd.ly/3abc', LOJAS, { fetchImpl, maxSaltos: 0 }), null); // sem seguir nada
  assert.deepEqual(pedidos, ['HEAD https://tidd.ly/3abc']);
});

function apiFalsa(extra = {}) {
  const chamadas = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    if (u.hostname === 'tidd.ly') {
      // conferência do link curto: só o 1º redirecionamento, sem token
      chamadas.push(`${opts.method} tidd.ly${u.pathname}`);
      assert.equal(opts.headers, undefined);
      if (extra.curtoSemResposta) throw new Error('rede');
      return { headers: { get: () => extra.destinoCurto ?? 'https://www.awin1.com/cread.php?awinmid=79926&awinaffid=123456&ued=x' } };
    }
    chamadas.push(`${opts.method} ${u.pathname}${u.search}`);
    assert.equal(opts.headers.authorization, 'Bearer tok');
    if (u.pathname === '/accounts') return json({ userId: 1, accounts: [{ accountId: 123456, accountName: 'Vic', accountType: 'publisher' }] });
    if (u.pathname === '/publishers/123456/programmes') {
      return json([
        { id: 79926, name: 'adidas BR', displayUrl: 'https://www.adidas.com.br', validDomains: [{ domain: 'adidas.com.br' }], primaryRegion: { countryCode: 'BR' } },
        { id: 55555, name: 'Loja Nova BR', displayUrl: 'www.lojanova.com.br', validDomains: [] },
      ]);
    }
    if (u.pathname.endsWith('/linkbuilder/generate')) return extra.semLinkCurto ? json({ description: 'Unknown error! Please try again later!' }, extra.status403 ? 403 : 400) : json({ url: 'https://www.awin1.com/cread.php?longo', shortUrl: 'https://tidd.ly/MEU' });
    if (u.pathname === '/publisher/123456/promotions') return json({ data: extra.promos || [] });
    return json({ error: 'nao sei' }, 404);
  };
  const config = { ativo: true, grupoGeral: 'Geral', linkCurto: true, cupons: { ativo: true, maxPorColeta: 2, diasSemRepetir: 7 }, anunciantes: [{ id: 79926, nome: 'adidas', dominios: [], grupos: ['Fitness'] }] };
  return { chamadas, api: new Awin({ token: 'tok', publisherId: '', apiUrl: 'https://api.awin.com' }, { fetchImpl, pausaMs: 0, arquivoCache: tmp('awin.json'), arquivoLinks: tmp('links.json'), config }) };
}

test('Awin API: descobre o id de afiliado, lista as lojas aprovadas (com cache) e gera link curto', async () => {
  const { api, chamadas } = apiFalsa();
  const lojas = await api.anunciantes();
  assert.deepEqual(lojas, [
    { id: 79926, nome: 'adidas', dominios: ['adidas.com.br'], grupos: ['Fitness'] },
    { id: 55555, nome: 'Loja Nova', dominios: ['lojanova.com.br'], grupos: [] }, // aprovada mas fora do arquivo: só vai ao grupo geral
  ]);
  await api.anunciantes(); // segunda vez: memória, sem nova chamada
  assert.deepEqual(chamadas, ['GET /accounts?type=publisher', 'GET /publishers/123456/programmes?relationship=joined']);
  assert.equal(await api.gerarLink(lojas[0], 'https://www.adidas.com.br/tenis'), 'https://tidd.ly/MEU');
  assert.equal(JSON.parse(fs.readFileSync(api.arquivoCache, 'utf8')).publisherId, '123456');
  // o link curto fica guardado: a mesma página não pede de novo à API nem confere de novo
  const antes = chamadas.length;
  assert.equal(await api.gerarLink(lojas[0], 'https://www.adidas.com.br/tenis'), 'https://tidd.ly/MEU');
  assert.equal(chamadas.length, antes);
  // link que já é curto (ou de afiliado) não é encurtado nem embrulhado de novo
  await assert.rejects(api.gerarLink(lojas[0], 'https://tidd.ly/OUTRO'), /já encurtado/);
  await assert.rejects(api.gerarLink(lojas[0], 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=999'), /já encurtado/);
  assert.equal(chamadas.length, antes);

  // o link curto leva para OUTRO id de afiliado, ou a conferência não responde: fica o link longo (sempre nosso)
  const LONGO = 'https://www.awin1.com/cread.php?awinmid=79926&awinaffid=123456&ued=https%3A%2F%2Fwww.adidas.com.br%2Ft';
  for (const extra of [{ destinoCurto: 'https://www.awin1.com/cread.php?awinmid=79926&awinaffid=999&ued=x' }, { curtoSemResposta: true }, { destinoCurto: '' }]) {
    const c = apiFalsa(extra);
    assert.equal(await c.api.gerarLink({ id: 79926 }, 'https://www.adidas.com.br/t'), LONGO, JSON.stringify(extra));
    // a falha fica guardada por 24h: a próxima coleta não chama a API de novo para a mesma página
    const n = c.chamadas.length;
    assert.equal(await c.api.gerarLink({ id: 79926 }, 'https://www.adidas.com.br/t'), LONGO);
    assert.equal(c.chamadas.length, n);
  }
  // conta sem o gerador (403): para de tentar até religar, para qualquer página
  const semGerador = apiFalsa({ semLinkCurto: true, status403: true });
  assert.equal(await semGerador.api.gerarLink({ id: 79926 }, 'https://www.adidas.com.br/t'), LONGO);
  const n403 = semGerador.chamadas.length;
  assert.match(await semGerador.api.gerarLink({ id: 79926 }, 'https://www.adidas.com.br/outra'), /awinaffid=123456/);
  assert.equal(semGerador.chamadas.length, n403);

  // a loja não deixa usar o gerador: cai no link longo, que funciona do mesmo jeito
  const b = apiFalsa({ semLinkCurto: true });
  assert.equal(await b.api.gerarLink({ id: 79926 }, 'https://www.adidas.com.br/t'), 'https://www.awin1.com/cread.php?awinmid=79926&awinaffid=123456&ued=https%3A%2F%2Fwww.adidas.com.br%2Ft');
});

const PROMOS = [
  { promotionId: 1, type: 'voucher', advertiser: { id: 79926, name: 'adidas BR', joined: true }, title: '15% OFF em tênis de corrida', description: 'Válido para a linha Adizero.', startDate: '2026-01-01T00:00:00.000', endDate: '2099-12-31T00:00:00.000', urlTracking: 'https://www.awin1.com/cread.php?awinmid=79926&awinaffid=123456&p=x', url: 'https://www.adidas.com.br/corrida', dateAdded: '2026-10-10T00:00:00.000', voucher: { code: 'CORRE15', exclusive: false } },
  { promotionId: 2, type: 'promotion', advertiser: { id: 79926, name: 'adidas BR' }, title: 'Outlet com até 50% de desconto', description: '', endDate: '2099-12-31T00:00:00.000', urlTracking: 'https://www.awin1.com/cread.php?o=2', dateAdded: '2026-10-11T00:00:00.000' },
  { promotionId: 3, type: 'voucher', advertiser: { id: 79926 }, title: 'Cupom vencido', endDate: '2020-01-01T00:00:00.000', urlTracking: 'https://www.awin1.com/cread.php?o=3', voucher: { code: 'VELHO' } },
  { promotionId: 4, type: 'voucher', advertiser: { id: 55555 }, title: 'Frete grátis na Loja Nova', endDate: '2099-12-31T00:00:00.000', urlTracking: 'https://www.awin1.com/cread.php?o=4', voucher: { code: 'FRETE' } },
  { promotionId: 5, type: 'voucher', advertiser: { id: 99999 }, title: 'Loja em que não fui aprovado', urlTracking: 'https://www.awin1.com/cread.php?o=5', voucher: { code: 'X' } },
];

test('Awin cupons: cada loja manda para os grupos dela e para o Geral, com limite por busca e sem vencidos', async () => {
  const { api } = apiFalsa({ promos: PROMOS });
  const grupos = [{ nome: 'Geral', ativo: true }, { nome: 'Fitness', ativo: true }, { nome: 'Beleza', ativo: false }];
  const r = await buscarCuponsAwin({ api, grupos });
  assert.deepEqual(r.produtos.map((p) => `${p.grupo}:${p.id}`).sort(), ['Fitness:AWP-1', 'Fitness:AWP-2', 'Geral:AWP-1', 'Geral:AWP-4']); // código primeiro; 2 por grupo
  const cupom = r.produtos.find((p) => p.id === 'AWP-1' && p.grupo === 'Fitness');
  // cupom com página da loja: sai com o link curto oficial (conferido); sem página, com o link de rastreio da API
  assert.deepEqual({ loja: cupom.loja, lojaNome: cupom.lojaNome, tipo: cupom.tipo, cupom: cupom.cupom, descontoPct: cupom.descontoPct, linkAfiliado: cupom.linkAfiliado }, { loja: 'awin', lojaNome: 'adidas', tipo: 'cupom', cupom: 'CORRE15', descontoPct: 15, linkAfiliado: 'https://tidd.ly/MEU' });
  assert.equal(r.produtos.find((p) => p.id === 'AWP-4').linkAfiliado, PROMOS[3].urlTracking);
  const legenda = montarLegenda(cupom, { titulo: tituloCupom(cupom) });
  assert.match(legenda, /^\*CUPOM ADIDAS 🎟️\*\n\n15% OFF em tênis de corrida\n\nVálido para a linha Adizero\.\n\n🎟️ Cupom: `CORRE15` \(toque para copiar\)\n⏳ Vale até 3[01]\/12\n\n🛒 Usar o cupom na loja adidas:\nhttps:\/\/tidd\.ly\/MEU/);
  assert.equal(tituloCupom(r.produtos.find((p) => p.id === 'AWP-2')), 'PROMO ADIDAS 🔥');
  assert.equal(ofertaDeCupom({ promotionId: 9, title: 'Sem link' }, LOJAS[0], 'Geral'), null);

  // cupom de loja de moda cujo texto é do tema vai também ao grupo do nicho
  const moda = apiFalsa({ promos: [{ promotionId: 7, advertiser: { id: 55555 }, title: 'Perfumes importados com 20% OFF', endDate: '2099-12-31T00:00:00.000', urlTracking: 'https://www.awin1.com/cread.php?o=7', voucher: { code: 'CHEIRO20' } }] });
  const nicho = [{ nome: 'Geral', ativo: true, filtros: {} }, { nome: 'Perfumes', ativo: true, filtros: { palavrasObrigatorias: ['perfume'], palavrasBloqueadas: ['automotivo'] } }, { nome: 'Fitness', ativo: true, filtros: { palavrasObrigatorias: ['whey'] } }];
  assert.deepEqual((await buscarCuponsAwin({ api: moda.api, grupos: nicho })).produtos.map((p) => p.grupo).sort(), ['Geral', 'Perfumes']);
  // ressalva não conta como tema (cupom real da Riachuelo, out/2026)
  const ressalva = apiFalsa({ promos: [{ promotionId: 8, advertiser: { id: 55555 }, title: '10% DE DESCONTO (NÃO APLICA EM DEMARCADOS) - não aplicado em perfumes, marketplace', endDate: '2099-12-31T00:00:00.000', urlTracking: 'https://www.awin1.com/cread.php?o=8', voucher: { code: 'GANHE10' } }] });
  assert.deepEqual((await buscarCuponsAwin({ api: ressalva.api, grupos: nicho })).produtos.map((p) => p.grupo), ['Geral']);

  // o que já está na fila ou saiu há pouco não volta
  const deNovo = await buscarCuponsAwin({ api, grupos, jaTem: (p) => p.id === 'AWP-1' });
  assert.ok(!deNovo.produtos.some((p) => p.id === 'AWP-1'));
  assert.equal((await buscarCuponsAwin({ api: new Awin({ token: '', publisherId: '' }, { config: api.config }), grupos })).motivo, 'falta AWIN_API_TOKEN no .env');
});

test('Awin de ponta a ponta: cupom → link curto conferido → fila → publicado (não é barrado como link inválido)', async () => {
  const { enviarProximo } = await import('../src/pipeline.js');
  const { api } = apiFalsa({ promos: [PROMOS[0]] });
  const r = await buscarCuponsAwin({ api, grupos: [{ nome: 'Fitness', ativo: true }] });
  const s = tmpStore();
  for (const p of r.produtos) s.upsert(p);
  const postados = [];
  const sender = { typing: async () => {}, sendText: async (j, t) => postados.push(t), sendImage: async (j, i, t) => (postados.push(t), { comImagem: true }) };
  const p = await enviarProximo(sender, { nome: 'Fitness', jid: '-100', mensagemAdicional: '', filtros: { diasSemRepetir: 7 } }, s);
  assert.equal(p.status, 'ENVIADO');
  assert.match(postados[0], /\nhttps:\/\/tidd\.ly\/MEU/);
});

test('Fila: cupom passa na frente, mas nunca dois seguidos', () => {
  const s = tmpStore();
  const base = { grupo: 'Geral', url: 'u', linkAfiliado: 'l', precoAtual: 10 };
  s.upsert({ ...base, id: 'P1', nome: 'Produto', descontoPct: 60 });
  s.upsert({ ...base, id: 'C1', nome: 'Cupom 1', tipo: 'cupom', prioridade: true });
  s.upsert({ ...base, id: 'C2', nome: 'Cupom 2', tipo: 'cupom', prioridade: true });
  const primeiro = s.proximo('Geral');
  assert.equal(primeiro.id, 'C1');
  s.setStatus(primeiro, 'ENVIADO', { enviadoEm: new Date().toISOString() });
  const segundo = s.proximo('Geral'); // depois de um cupom, a vez é de um produto
  assert.equal(segundo.id, 'P1');
  s.setStatus(segundo, 'ENVIADO', { enviadoEm: new Date(Date.now() + 1000).toISOString() });
  assert.equal(s.proximo('Geral').id, 'C2');
});

test('Espelho: link de loja parceira num canal entra com o MEU link da Awin e o nome da loja', async () => {
  const agora = { t: Date.UTC(2027, 0, 15, 8, 5) };
  const store = tmpStore();
  const t = Math.floor(agora.t / 1000) - 60;
  const msgs = [
    { id: 'a1', jid: 'canal:x', t, texto: 'Tênis Adidas Duramo SL Masculino\nDe R$ 399 por R$ 199\nCupom: CORRE15\nhttps://www.adidas.com.br/tenis-duramo?utm_source=outro' },
    { id: 'a2', jid: 'canal:x', t, texto: 'Geladeira Brastemp Frost Free\nPor R$ 2.999\nhttps://www.magazineluiza.com.br/geladeira' },
    { id: 'a3', jid: 'canal:x', t, texto: 'https://www.adidas.com.br/so-o-link' },
  ];
  const links = [];
  const awin = { ligada: () => true, anunciantes: async () => LOJAS, gerarLink: async (a, url) => (links.push(url), `https://tidd.ly/${a.id}`) };
  const espelho = new Espelho({
    sender: { lerMensagens: async () => msgs },
    store,
    affiliate: {},
    fontes: [{ nome: '@x', jid: 'canal:x', destino: 'Geral', soAmazon: true, destinos: [{ grupo: 'Geral', palavras: null }, { grupo: 'Fitness', palavras: ['tenis'] }, { grupo: 'Perfumes', palavras: ['perfume'] }] }],
    grupos: [],
    carregarGrupos: () => [{ nome: 'Geral', ativo: true, filtros: {} }, { nome: 'Fitness', ativo: true, filtros: {} }, { nome: 'Perfumes', ativo: true, filtros: {} }],
    cfg: { maxPorHora: 5 },
    agora: () => agora.t,
    esperar: async () => {},
    awin,
    resolverLoja: (l, lojas, o) => resolverLinkLoja(l, lojas, { ...o, fetchImpl: async () => assert.fail('não era para abrir nada') }),
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  assert.deepEqual(r.ignoradas, { 'sem link do ML/Amazon': 1, 'sem nome do produto': 1 });
  assert.deepEqual(links, ['https://www.adidas.com.br/tenis-duramo']); // um link só, sem o rastreio do outro afiliado
  const fila = store.list((p) => p.status === 'PRONTO');
  assert.deepEqual(fila.map((p) => p.grupo).sort(), ['Fitness', 'Geral']);
  const p = fila[0];
  assert.deepEqual({ loja: p.loja, lojaNome: p.lojaNome, linkAfiliado: p.linkAfiliado, precoAtual: p.precoAtual, precoOriginal: p.precoOriginal, cupom: p.cupom }, { loja: 'awin', lojaNome: 'adidas', linkAfiliado: 'https://tidd.ly/79926', precoAtual: 199, precoOriginal: 399, cupom: 'CORRE15' });
  const legenda = montarLegenda(p, { titulo: 'x' });
  assert.match(legenda, /^💜 \*ADIDAS\*/);
  assert.match(legenda, /🔗 use o link:\nhttps:\/\/tidd\.ly\/79926/);
  assert.match(legenda, /🎟️ Cupom: `CORRE15` \(toque para copiar\)/);
  assert.doesNotMatch(legenda, /utm_source|Preço da Amazon/);
});

test('Telegram: o canal se liga ao grupo em espera cujo nome está no título', () => {
  const grupos = [{ nome: 'Geral', emEspera: false }, { nome: 'Fitness', emEspera: true }, { nome: 'Beleza', emEspera: true }, { nome: 'Perfumes', emEspera: true }];
  assert.equal(grupoDoTitulo('Achadinhos da Vic · Perfumes 🌸', grupos).nome, 'Perfumes');
  assert.equal(grupoDoTitulo('Achadinhos da Vic | perfume', grupos).nome, 'Perfumes');
  assert.equal(grupoDoTitulo('ACHADINHOS FITNESS', grupos).nome, 'Fitness');
  assert.equal(grupoDoTitulo('Achadinhos da Vic', grupos), null);
  assert.equal(grupoDoTitulo('Beleza e Perfumes', grupos), null); // dois grupos: não adivinha
  assert.equal(grupoDoTitulo('Geral', grupos), null); // já tem canal
});

test('Coleta: grupo em espera não é buscado e a mesma página de ofertas é baixada uma vez só', async () => {
  const grupos = loadGrupos().map((g) => (g.nome === 'Geral' ? { ...g, ativo: true, emEspera: false } : g)); // o Geral pode estar pausado no arquivo
  const geral = grupos.find((g) => g.nome === 'Geral');
  const espera = grupos.find((g) => g.emEspera);
  assert.equal(geral.ativo, true);
  if (!espera) return; // neste computador todos os grupos já têm canal
  const baixadas = [];
  const raspar = async (cat) => (baixadas.push(cat.url), [{ id: 'MLB1', nome: 'Fone Bluetooth', url: 'https://p/1', precoAtual: 99, descontoPct: 40, nota: 4.8, grupo: cat.grupo, categoria: cat.nome }]);
  const r = await coletar(tmpStore(), {
    shopee: async () => ({ produtos: [], categorias: {}, motivo: "desligada (teste)" }),
    grupos,
    categoriasML: [
      { grupo: 'Geral', nome: 'A', url: 'https://ml/ofertas', paginas: 1, ativo: true },
      { grupo: 'Geral', nome: 'B', url: 'https://ml/ofertas', paginas: 1, ativo: true },
      { grupo: espera.nome, nome: 'C', url: 'https://ml/outra', paginas: 1, ativo: true },
    ],
    raspar,
    esperar: async () => {},
    amazon: async () => ({ produtos: [], categorias: {}, motivo: 'desligada' }),
    awin: async () => ({ produtos: [], categorias: {}, motivo: 'desligada em config/awin.json' }),
  });
  assert.deepEqual(baixadas, ['https://ml/ofertas']);
  assert.equal(r.encontrados, 2);
  assert.equal(r.novos, 1);
  assert.deepEqual(Object.keys(r.categorias).sort(), ['A', 'B']); // a ordem das categorias é sorteada
});

test('arte do cupom: a da loja quando existe (logo em destaque), senão a genérica da Vic', async () => {
  const { arteDoCupom } = await import('../src/awin.js');
  assert.equal(arteDoCupom(17648, 'cupom'), 'assets/cupom-17648.jpg');
  assert.equal(arteDoCupom(17648, 'promo'), 'assets/promo-17648.jpg');
  assert.equal(arteDoCupom(99999, 'cupom'), 'assets/cupom.jpg');
  assert.equal(arteDoCupom(99999, 'promo'), 'assets/promo.jpg');
});
