import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verificarTrava, publicarPainel, mascarar, lerEstado, urlPublicada, urlDePrevia, URL_PAINEL } from '../src/analytics/publicar.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-pb-'));
const ENV = { CLOUDFLARE_API_TOKEN: 'tokenSecreto123456', CLOUDFLARE_ACCOUNT_ID: 'conta1' };
const resposta = (status, location) => async (url, opts) => {
  assert.equal(opts.redirect, 'manual');
  assert.ok(!opts.headers?.cookie, 'sem cookie');
  return { status, headers: { get: (h) => (h === 'location' ? location : null) } };
};
const executor = () => {
  const chamadas = [];
  const fn = async (args, { env }) => {
    chamadas.push(args);
    assert.equal(env.CLOUDFLARE_API_TOKEN, ENV.CLOUDFLARE_API_TOKEN);
    return { ok: true, saida: 'ok' };
  };
  return { fn, chamadas };
};
const avisosFalsos = () => {
  const msgs = [];
  return { msgs, avisar: async (tipo, texto) => msgs.push(texto) };
};

test('trava: Access (redireciona para *.cloudflareaccess.com) = protegido; 404 = inexistente; 200 = aberto; outro = erro', async () => {
  assert.deepEqual(await verificarTrava({ fetchImpl: resposta(302, 'https://vic.cloudflareaccess.com/cdn-cgi/access/login/x') }), { trava: 'protegido' });
  assert.deepEqual(await verificarTrava({ fetchImpl: resposta(404) }), { trava: 'inexistente' });
  assert.deepEqual(await verificarTrava({ fetchImpl: resposta(200) }), { trava: 'aberto' });
  assert.equal((await verificarTrava({ fetchImpl: resposta(302, 'https://golpe.example.com/cloudflareaccess.com') })).trava, 'erro');
  assert.equal((await verificarTrava({ fetchImpl: async () => { throw new Error('fetch failed'); } })).trava, 'erro');
  // projeto do Pages que ainda não existe: o nome nem resolve no DNS
  const semDns = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  assert.deepEqual(await verificarTrava({ fetchImpl: semDns }), { trava: 'inexistente' });
  assert.equal((await verificarTrava({ url: 'https://outro.example.com', fetchImpl: semDns })).trava, 'erro');
});

test('protegido: publica os dados (e pula quando nada mudou); só então o resumo ganha o link', async () => {
  const base = pasta();
  const ex = executor();
  assert.equal(urlPublicada(base), null);
  const r = await publicarPainel({ hash: 'h1', base, env: ENV, fetchImpl: resposta(302, 'https://vic.cloudflareaccess.com/x'), executar: ex.fn });
  assert.deepEqual(r, { publicado: true, motivo: 'ok' });
  assert.deepEqual(ex.chamadas[0].slice(0, 2), ['pages', 'deploy']);
  assert.ok(ex.chamadas[0][2].endsWith(path.join('analytics', 'site')) || ex.chamadas[0][2].endsWith('site'));
  assert.deepEqual(ex.chamadas[0].slice(3, 7), ['--project-name', 'achadinhos-vic-painel', '--branch', 'main']);
  assert.equal(urlPublicada(base), URL_PAINEL);
  const r2 = await publicarPainel({ hash: 'h1', base, env: ENV, fetchImpl: resposta(302, 'https://vic.cloudflareaccess.com/x'), executar: ex.fn });
  assert.equal(r2.publicado, false);
  assert.equal(ex.chamadas.length, 1, 'mesmo conteúdo: não publica de novo');
});

test('projeto inexistente: cria e publica só a página "configurando…", sem dados', async () => {
  const base = pasta();
  fs.mkdirSync(path.join(base, 'site'), { recursive: true });
  fs.writeFileSync(path.join(base, 'site', 'dados.json'), '{"segredo":1}');
  const ex = executor();
  const r = await publicarPainel({ hash: 'h1', base, env: ENV, fetchImpl: resposta(404), executar: ex.fn });
  assert.equal(r.publicado, false);
  assert.deepEqual(ex.chamadas.map((c) => c.slice(0, 2).join(' ')), ['pages project', 'pages deploy']);
  const pastaPublicada = ex.chamadas[1][2];
  assert.ok(pastaPublicada.endsWith('site-configurando'));
  assert.deepEqual(fs.readdirSync(pastaPublicada).sort(), ['_headers', 'index.html', 'robots.txt']);
  assert.doesNotMatch(fs.readFileSync(path.join(pastaPublicada, 'index.html'), 'utf8'), /publicadas|R\$|segredo/);
  assert.equal(urlPublicada(base), null);
});

test('painel aberto ou trava com erro: NÃO publica e avisa o dono 1x por dia', async () => {
  const base = pasta();
  const ex = executor();
  const av = avisosFalsos();
  const dia1 = new Date('2026-10-14T12:30:00-03:00');
  for (let i = 0; i < 3; i++) await publicarPainel({ hash: `h${i}`, base, env: ENV, fetchImpl: resposta(200), executar: ex.fn, avisos: av, agora: dia1 });
  assert.equal(ex.chamadas.length, 0);
  assert.equal(av.msgs.length, 1);
  assert.match(av.msgs[0], /sem proteção.*README/s);
  await publicarPainel({ hash: 'h9', base, env: ENV, fetchImpl: async () => { throw new Error('fetch failed'); }, executar: ex.fn, avisos: av, agora: new Date('2026-10-15T08:05:00-03:00') });
  assert.equal(ex.chamadas.length, 0);
  assert.equal(av.msgs.length, 2);
  assert.equal(lerEstado(base).trava, 'erro');
});

test('sem token: só local; nunca o site público; o token não aparece na saída', async () => {
  const ex = executor();
  const r = await publicarPainel({ hash: 'h', base: pasta(), env: {}, fetchImpl: resposta(302, 'https://x.cloudflareaccess.com'), executar: ex.fn });
  assert.match(r.motivo, /só no PC/);
  const r2 = await publicarPainel({ hash: 'h', base: pasta(), env: ENV, projeto: 'achadinhos-vic', fetchImpl: resposta(302, 'https://x.cloudflareaccess.com'), executar: ex.fn });
  assert.match(r2.motivo, /proibido/);
  assert.equal(ex.chamadas.length, 0);
  assert.equal(mascarar('erro: token tokenSecreto123456 inválido', [ENV.CLOUDFLARE_API_TOKEN]), 'erro: token *** inválido');
});

test('G1: projeto já criado + falha de DNS (internet do PC) = erro: nunca recria nem publica "configurando…" por cima', async () => {
  const base = pasta();
  const ex = executor();
  const semDns = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await publicarPainel({ hash: 'h1', base, env: ENV, fetchImpl: semDns, executar: ex.fn }); // 1ª vez: cria
  assert.equal(lerEstado(base).criado, true);
  assert.equal(ex.chamadas.length, 2);
  const r = await publicarPainel({ hash: 'h2', base, env: ENV, fetchImpl: semDns, executar: ex.fn });
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /internet ou DNS/);
  assert.equal(ex.chamadas.length, 2, '0 deploys depois de criado');
  // projeto que já existia (criado à mão): só anota, sem publicar nada
  const base2 = pasta();
  const ex2 = { chamadas: [], fn: async (args) => (ex2.chamadas.push(args), args[1] === 'project' ? { ok: false, saida: 'A project with this name already exists [code: 8000002]' } : { ok: true, saida: '' }) };
  await publicarPainel({ hash: 'h', base: base2, env: ENV, fetchImpl: semDns, executar: ex2.fn });
  assert.deepEqual(ex2.chamadas.map((c) => c[1]), ['project']);
  assert.equal(lerEstado(base2).criado, true);
});

test('G2: prévia da publicação aberta (Access só no domínio principal) → avisa na hora e para de publicar até protegerem', async () => {
  const base = pasta();
  const av = avisosFalsos();
  const PREVIA = 'https://a1b2c3d4.achadinhos-vic-painel.pages.dev';
  const saidaWrangler = `✨ Success! Uploaded 4 files\n🌎 Deploying...\n✨ Deployment complete! Take a peek over at ${PREVIA}`;
  const deploys = [];
  const executar = async (args) => (deploys.push(args), { ok: true, saida: saidaWrangler });
  let previaProtegida = false;
  const fetchImpl = async (url) => {
    const protegido = { status: 302, headers: { get: () => 'https://vic.cloudflareaccess.com/login' } };
    if (url.startsWith(PREVIA)) return previaProtegida ? protegido : { status: 200, headers: { get: () => null } };
    return protegido;
  };
  const r = await publicarPainel({ hash: 'h1', base, env: ENV, fetchImpl, executar, avisos: av });
  assert.deepEqual(r, { publicado: true, motivo: 'prévia aberta' });
  assert.equal(av.msgs.length, 1);
  assert.match(av.msgs[0], /prévia do painel está aberta[\s\S]*\*\.achadinhos-vic-painel\.pages\.dev/);
  // dados novos, prévia ainda aberta: não publica
  const r2 = await publicarPainel({ hash: 'h2', base, env: ENV, fetchImpl, executar, avisos: av });
  assert.equal(r2.publicado, false);
  assert.equal(deploys.length, 1);
  // o dono protegeu o *.dominio: volta a publicar
  previaProtegida = true;
  const r3 = await publicarPainel({ hash: 'h2', base, env: ENV, fetchImpl, executar, avisos: av });
  assert.deepEqual(r3, { publicado: true, motivo: 'ok' });
  assert.equal(deploys.length, 2);
  assert.equal(lerEstado(base).previaAberta, undefined);
});

test('URL de prévia: pega a do wrangler e ignora a de produção', () => {
  assert.equal(urlDePrevia('Take a peek over at https://9f8e7d.achadinhos-vic-painel.pages.dev'), 'https://9f8e7d.achadinhos-vic-painel.pages.dev');
  assert.equal(urlDePrevia('https://achadinhos-vic-painel.pages.dev'), null);
  assert.equal(urlDePrevia(''), null);
});
