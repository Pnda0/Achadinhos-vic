import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowserPath } from '../src/browser.js';
import { updateEnvText, withGrupoJid, jidConfigurado, encontrarGrupo } from '../src/configfile.js';
import { extractTags, sessaoValida, emTelaDeLogin, cookiesToString } from '../src/ml/login.js';
import { obterProdutos } from '../src/ml/scraper.js';
import { gerarLinks } from '../src/pipeline.js';
import { Store } from '../src/store.js';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const tmpStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'db.json'));
const produto = { id: 'MLB1', grupo: 'Geral', nome: 'X', url: 'https://p/1', imagem: 'i', precoAtual: 10, descontoPct: 50 };

test('findBrowserPath: CHROME_PATH tem prioridade; no Windows acha Chrome antes do Edge', () => {
  const env = { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\L' };
  const edge = 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(findBrowserPath(env, (p) => p === edge), edge);
  assert.equal(findBrowserPath(env, (p) => p === edge || p === chrome), chrome);
  assert.equal(findBrowserPath({ ...env, CHROME_PATH: 'D:\\x.exe' }, () => true), 'D:\\x.exe');
  assert.equal(findBrowserPath(env, () => false), null);
});

test('updateEnvText troca valor existente, preserva CRLF e acrescenta chave nova', () => {
  assert.equal(updateEnvText('A=1\r\nSENDER=console\r\nB=2\r\n', 'SENDER', 'wwebjs'), 'A=1\r\nSENDER=wwebjs\r\nB=2\r\n');
  assert.equal(updateEnvText('A=1\n', 'ML_AFFILIATE_TAG', 'pnda$1'), 'A=1\nML_AFFILIATE_TAG=pnda$1\n');
  assert.equal(updateEnvText('ML_AFFILIATE_TAG=\n', 'ML_AFFILIATE_TAG', 'x'), 'ML_AFFILIATE_TAG=x\n');
});

test('withGrupoJid grava o JID e ativa o grupo', () => {
  const cfg = { filtrosPadrao: {}, grupos: [{ nome: 'Geral', jid: 'COLE_AQUI_O_JID@g.us', ativo: false }] };
  const r = withGrupoJid(cfg, 'Geral', '123@g.us');
  assert.deepEqual(r.grupos[0], { nome: 'Geral', jid: '123@g.us', ativo: true });
  assert.equal(jidConfigurado(cfg.grupos[0]), false);
  assert.equal(jidConfigurado(r.grupos[0]), true);
});

test('login: detecta sessão válida, etiquetas e telas de login', () => {
  const logado = '<meta name="csrf-token" content="AGrBxUXB-l4v5Ys8ZdH123"><script>{"tags":[{"tag":"pndaaaa","in_use":true},{"tag":"outra"}]}</script>';
  assert.deepEqual(extractTags(logado), ['pndaaaa', 'outra']);
  assert.equal(sessaoValida(logado, []), true);
  assert.equal(sessaoValida('<meta name="csrf-token" content="AGrBxUXB-l4v5Ys8ZdH123">', []), false); // página 401 sem conta
  assert.equal(sessaoValida('<meta name="csrf-token" content="AGrBxUXB-l4v5Ys8ZdH123">', [{ name: 'ssid', value: 'x' }]), true);
  assert.equal(sessaoValida('', [{ name: 'ssid', value: 'x' }]), false);
  assert.equal(emTelaDeLogin('https://www.mercadolivre.com/jms/mlb/lgz/login?go=x'), true);
  assert.equal(emTelaDeLogin('https://www.mercadolivre.com.br/'), false);
  assert.equal(emTelaDeLogin('https://accounts.google.com/o/oauth2/v2/auth?x=1'), true); // outro site: não interferir
  assert.equal(emTelaDeLogin('about:blank'), true);
  assert.equal(cookiesToString([{ name: 'a', value: '1' }, { name: 'b', value: '2' }]), 'a=1; b=2');
});

test('obterProdutos: usa o navegador quando o HTTP falha ou vem sem produtos', async () => {
  const navegador = { html: async () => fx('ofertas-json.html') };
  const a = await obterProdutos('u', { http: async () => { throw new Error('HTTP 403'); }, navegador, temNavegador: true });
  assert.equal(a.produtos.length, 2);
  assert.match(a.fonte, /navegador/);
  const b = await obterProdutos('u', { http: async () => '<html>captcha</html>', navegador, temNavegador: true });
  assert.equal(b.produtos.length, 2);
  const c = await obterProdutos('u', { http: async () => fx('ofertas-json.html'), navegador: { html: async () => assert.fail('não devia abrir') }, temNavegador: true });
  assert.equal(c.fonte, 'json');
  await assert.rejects(obterProdutos('u', { http: async () => { throw new Error('HTTP 403'); }, navegador, temNavegador: false }), /403/);
});

test('gerarLinks: cai para o navegador quando o HTTP dá 403 e marca PRONTO', async () => {
  const store = tmpStore();
  store.upsert(produto);
  let fechou = false;
  const affiliate = { tag: 't', refresh: async () => {}, createLinks: async () => { throw new Error('createLink HTTP 403'); } };
  const navegador = { createLinks: async (urls, tag) => new Map(urls.map((u) => [u, `https://meli.la/${tag}`])), close: async () => { fechou = true; } };
  assert.equal(await gerarLinks(store, affiliate, { navegador, temNavegador: true }), 1);
  assert.equal(store.proximo('Geral').linkAfiliado, 'https://meli.la/t');
  assert.equal(fechou, true);
});

test('gerarLinks: sem navegador disponível, o erro do HTTP aparece', async () => {
  const store = tmpStore();
  store.upsert(produto);
  const affiliate = { tag: 't', refresh: async () => { throw new Error('Sessão expirada'); }, createLinks: async () => new Map() };
  await assert.rejects(gerarLinks(store, affiliate, { navegador: { close: async () => {} }, temNavegador: false }), /Sessão expirada/);
  await assert.rejects(gerarLinks(store, { tag: '' }, { navegador: { close: async () => {} }, temNavegador: false }), /ML_AFFILIATE_TAG/);
});

test('loginML: espera o login, volta ao Link Builder e salva os cookies', async () => {
  const { loginML } = await import('../src/ml/login.js');
  const LB = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
  const logadoHtml = '<meta name="csrf-token" content="AGrBxUXB-l4v5Ys8ZdH123"><script>{"tags":[{"tag":"pndaaaa"}]}</script>';
  let logado = false, url = 'about:blank', voltas = 0, fechado = false;
  const visitas = [];
  const page = {
    url: () => url,
    goto: async (u) => { visitas.push(u); url = u.includes('lgz/login') ? u : logado ? LB : u; },
    content: async () => (logado && url === LB ? logadoHtml : '<meta name="csrf-token" content="AGrBxUXB-l4v5Ys8ZdH123">Unauthorized'),
    cookies: async () => (logado ? [{ name: 'ssid', value: 's1' }, { name: '_csrf', value: 'c' }] : [{ name: '_csrf', value: 'c' }]),
  };
  const browser = { connected: true, pages: async () => [page], close: async () => { fechado = true; } };
  // Depois de 3 "esperas" o usuário termina o login e o ML manda para a home.
  const esperar = async () => { if (++voltas === 3) { logado = true; url = 'https://www.mercadolivre.com.br/'; } };
  const cookieFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'cookies.txt');
  const r = await loginML({ abrir: async () => browser, esperar, cookieFile });
  assert.deepEqual(r.tags, ['pndaaaa']);
  assert.equal(fs.readFileSync(cookieFile, 'utf8').trim(), 'ssid=s1; _csrf=c');
  assert.match(visitas[1], /lgz\/login/); // sem sessão -> foi para a tela de login
  assert.equal(visitas.at(-1), LB); // depois do login voltou sozinho ao Link Builder
  assert.equal(fechado, true);
});

test('loginML: janela fechada antes do login vira erro claro', async () => {
  const { loginML } = await import('../src/ml/login.js');
  const page = { url: () => 'x://login', goto: async () => {}, content: async () => '', cookies: async () => [] };
  const browser = { connected: false, pages: async () => [page], close: async () => {} };
  await assert.rejects(loginML({ abrir: async () => browser, esperar: async () => {} }), /janela foi fechada/);
});

test('loadCookies: aceita cookies.txt.txt e limpa prefixo/linhas coladas do F12', async () => {
  const { loadCookies, normalizeCookieText } = await import('../src/ml/affiliate.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mla-'));
  const base = path.join(dir, 'cookies.txt');
  fs.writeFileSync(base + '.txt', '\uFEFFcookie: a=1; ssid=xyz\r\n\r\n');
  assert.equal(loadCookies([base, base + '.txt']), 'a=1; ssid=xyz');
  fs.writeFileSync(base, 'b=2; ssid=novo\n');
  assert.equal(loadCookies([base, base + '.txt']), 'b=2; ssid=novo');
  assert.equal(normalizeCookieText('"a=1; b=2"'), 'a=1; b=2');
});

test('loadCookies: ML_COOKIES novo (trocado no painel da nuvem) passa na frente do cookies.txt vencido', async () => {
  const { loadCookies } = await import('../src/ml/affiliate.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mla-'));
  const base = path.join(dir, 'cookies.txt');
  const arqs = [base, base + '.txt'];
  // 1º boot na nuvem: sem arquivo, vale o ML_COOKIES (e ele fica gravado)
  assert.equal(loadCookies(arqs, 'ssid=env1'), 'ssid=env1');
  // o bot renova os cookies no arquivo; o mesmo ML_COOKIES não desfaz a renovação
  fs.writeFileSync(base, 'ssid=renovado\n');
  assert.equal(loadCookies(arqs, 'ssid=env1'), 'ssid=renovado');
  // sessão venceu e o dono colou cookies novos em ML_COOKIES: agora eles valem
  assert.equal(loadCookies(arqs, 'cookie: ssid=env2'), 'ssid=env2');
  assert.equal(fs.readFileSync(base, 'utf8').trim(), 'ssid=env2');
  assert.equal(loadCookies(arqs, ''), 'ssid=env2');
});

test('loadCookies: no PC, o cookies.txt do login-ml não é trocado por um ML_COOKIES antigo do .env', async () => {
  const { loadCookies } = await import('../src/ml/affiliate.js');
  const base = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'cookies.txt');
  fs.writeFileSync(base, 'ssid=login\n');
  assert.equal(loadCookies([base, base + '.txt'], 'ssid=antigo'), 'ssid=login');
  assert.equal(loadCookies([base, base + '.txt'], 'ssid=antigo'), 'ssid=login');
});

test('encontrarGrupo: por número, por nome sem acento/maiúscula, e ambíguo', () => {
  const lista = [{ nome: 'Família', jid: '1@g.us' }, { nome: 'Ofertas', jid: '2@g.us' }, { nome: 'Ofertas Fitness 💪', jid: '3@g.us' }];
  assert.equal(encontrarGrupo(lista, '2').grupo.jid, '2@g.us');
  assert.equal(encontrarGrupo(lista, 'ofertas').grupo.jid, '2@g.us'); // nome exato ganha do parcial
  assert.equal(encontrarGrupo(lista, 'familia').grupo.jid, '1@g.us');
  assert.equal(encontrarGrupo(lista, 'fitness').grupo.jid, '3@g.us');
  assert.equal(encontrarGrupo(lista, 'ofert').varios.length, 2);
  assert.deepEqual(encontrarGrupo(lista, '9'), {});
  assert.deepEqual(encontrarGrupo(lista, 'xyz'), {});
  assert.deepEqual(encontrarGrupo(lista, ''), {});
});

test('WhatsApp: detecta o formato real da imagem e reconhece erro de upload', async () => {
  const { detectarImagem, erroDeUpload } = await import('../src/senders.js');
  assert.equal(detectarImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).mimetype, 'image/jpeg');
  assert.equal(detectarImagem(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])).mimetype, 'image/webp');
  assert.equal(detectarImagem(Buffer.from('\x89PNG\r\n\x1a\n....', 'latin1')).mimetype, 'image/png');
  assert.equal(detectarImagem(Buffer.from('<html>bloqueado</html>')), null);
  assert.equal(erroDeUpload(new Error('upload failed: media entry was not created')), true);
  assert.equal(erroDeUpload(new Error('Evaluation failed: chat not found')), false);
});

test('WhatsApp: imagem falha no upload -> tenta de novo -> cai para texto com o link', async () => {
  const { createSender } = await import('../src/senders.js');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  try {
    const novo = (falhas) => {
      const s = createSender('wwebjs');
      const enviados = [];
      s.MessageMedia = class { constructor(mimetype, data, filename) { Object.assign(this, { mimetype, data, filename }); } };
      s.client = {
        sendMessage: async (jid, conteudo, opts) => {
          if (typeof conteudo !== 'string' && falhas-- > 0) throw new Error('upload failed: media entry was not created');
          enviados.push({ jid, conteudo, opts });
        },
      };
      return { s, enviados };
    };
    // 1 falha e depois sobe: vai com imagem
    let { s, enviados } = novo(1);
    assert.deepEqual(await s.sendImage('1@g.us', 'https://img/x.jpg', 'legenda', { esperas: [0, 0, 0] }), { comImagem: true });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].conteudo.mimetype, 'image/jpeg');
    assert.equal(enviados[0].conteudo.filename, 'oferta.jpg');
    assert.deepEqual(enviados[0].opts, { caption: 'legenda', sendSeen: false });
    // falha sempre: manda só o texto
    ({ s, enviados } = novo(99));
    assert.deepEqual(await s.sendImage('1@g.us', 'https://img/x.jpg', 'legenda', { esperas: [0, 0, 0] }), { comImagem: false });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].conteudo, 'legenda');
    // erro que não é de upload (ex.: bug do id) -> sem esperar, manda o texto
    ({ s, enviados } = novo(0));
    let chamadas = 0;
    s.client.sendMessage = async (jid, conteudo) => {
      chamadas++;
      if (typeof conteudo !== 'string') throw new Error("Data passed to getter must include an id property (it's how we memoize) but got undefined");
      enviados.push(conteudo);
    };
    assert.deepEqual(await s.sendImage('1@g.us', 'https://img/x.jpg', 'legenda', { esperas: [0, 0, 0] }), { comImagem: false });
    assert.equal(chamadas, 2); // 1 tentativa com imagem + 1 só texto
    // se nem o texto vai, o erro aparece
    s.client.sendMessage = async () => { throw new Error('chat not found'); };
    await assert.rejects(s.sendImage('1@g.us', 'https://img/x.jpg', 'l', { esperas: [0, 0, 0] }), /chat not found/);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('o texto de exemplo do convite (SEU_CONVITE) nunca chega ao grupo', async () => {
  const { loadGrupos } = await import('../src/config.js');
  for (const g of loadGrupos()) assert.doesNotMatch(g.mensagemAdicional, /SEU_CONVITE/);
  assert.equal(/SEU_CONVITE/.test('🔗 Convide: https://chat.whatsapp.com/SEU_CONVITE'), true);
});

test('patch do whatsapp-web.js: apaga message.__x_id logo depois de montar a mensagem', async () => {
  const { corrigirFonte } = await import('../src/patch-wwebjs.js');
  const fonte = [
    '        const message = {',
    '            ...options,',
    '            ...mediaOptions,',
    '            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),',
    '            ...extraOptions,',
    '        };',
    '',
    '        if (botOptions) {',
  ].join('\n');
  const r = corrigirFonte(fonte);
  assert.equal(r.estado, 'aplicado');
  const linhas = r.fonte.split('\n');
  assert.equal(linhas[5], '        };');
  assert.match(linhas[7], /^\s+delete message\.__x_id;$/);
  assert.equal(corrigirFonte(r.fonte).estado, 'ja-corrigido');
  assert.equal(corrigirFonte('nada a ver').estado, 'nao-encontrado');
});

test('patch do whatsapp-web.js está aplicado no pacote instalado e o arquivo continua válido', async () => {
  const { garantirPatchWwebjs, localizarUtils } = await import('../src/patch-wwebjs.js');
  assert.match(garantirPatchWwebjs(), /aplicado|ja-corrigido/);
  const { createRequire } = await import('node:module');
  const { LoadUtils } = createRequire(import.meta.url)(localizarUtils());
  assert.match(LoadUtils.toString(), /delete message\.__x_id/);
});
