import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sem "digitando..." nos testes (só atrasaria) — antes de carregar a configuração.
process.env.SIMULAR_DIGITANDO = 'false';
const { Store } = await import('../src/store.js');
const { enviarProximo, enviarParaTodos, motivoRecusa, motivoLinkInvalido } = await import('../src/pipeline.js');
const { TelegramSender } = await import('../src/telegram.js');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mla-'));
const novoStore = () => new Store(path.join(pasta(), 'db.json'));
const GRUPO = { nome: 'Geral', jid: '-1001', mensagemAdicional: '', filtros: { diasSemRepetir: 5 } };
const oferta = (id, extra = {}) => ({
  id, grupo: 'Geral', nome: `Fone Bluetooth Modelo ${id}`, url: `https://produto.mercadolivre.com.br/${id}`,
  imagem: 'https://img/x.jpg', precoAtual: 99, precoOriginal: 199, descontoPct: 50, nota: 4.7, vendidos: '+1000 vendidos',
  linkAfiliado: `https://meli.la/${id}`, ...extra,
});
/** Destino falso: registra o que foi postado; `falha` decide o que acontece em cada envio. */
const destino = (falha = () => null) => {
  const postados = [];
  return {
    postados,
    typing: async () => {},
    sendText: async (jid, texto) => {
      const e = falha(texto);
      if (e) throw e;
      postados.push(texto);
    },
    sendImage: async (jid, img, texto) => {
      const e = falha(texto);
      if (e) throw e;
      postados.push(texto);
      return { comImagem: true };
    },
  };
};
const semResposta = () => Object.assign(new Error('Telegram sendPhoto: sem resposta (tempo esgotado)'), { incerto: true });

// ---------------------------------------------------------------------------- banco (db.json)

test('db.json: sem arquivo começa vazio; estragado carrega o backup; os dois estragados começam vazios guardando o arquivo', () => {
  const dir = pasta();
  const file = path.join(dir, 'db.json');
  const a = new Store(file);
  assert.equal(a.recuperacao, null);
  a.upsert(oferta('MLB1'));
  a.save();
  a.setStatus(a.list()[0], 'ENVIADO');
  a.save(); // agora o .bak tem a versão anterior (PRONTO) e o db.json a nova (ENVIADO)
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).produtos['Geral:MLB1'].status, 'PRONTO');

  fs.writeFileSync(file, '{"produtos": {"Geral:MLB1": {"sta'); // queda de energia no meio da gravação
  const b = new Store(file);
  assert.equal(b.recuperacao.de, 'backup');
  assert.equal(b.list().length, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('db.json.corrompido-')), 'o arquivo estragado fica guardado');

  fs.writeFileSync(file, 'lixo');
  fs.writeFileSync(file + '.bak', '');
  const c = new Store(file);
  assert.equal(c.recuperacao.de, 'vazio');
  assert.equal(c.list().length, 0);
});

test('db.json antigo (sem os campos novos) carrega e funciona', () => {
  const file = path.join(pasta(), 'db.json');
  fs.writeFileSync(file, JSON.stringify({
    produtos: { 'Geral:MLB9': { ...oferta('MLB9'), status: 'ERRO', erro: 'x' } },
    historico: { 'Geral:MLB8': new Date().toISOString() }, vistos: {}, stats: {},
  }));
  const s = new Store(file);
  assert.equal(s.recuperacao, null);
  assert.equal(s.enviadoRecentemente('MLB8', 'Geral', 5), true);
  assert.equal(s.nomeRecente(oferta('MLB7'), 5), false);
  assert.equal(s.reabrirErros(), 1); // ERRO antigo, sem contador de tentativas
  s.save();
});

test('db.json antigo (sem `nomes`): o nome do que já saiu hoje passa a bloquear outro anúncio igual', () => {
  const file = path.join(pasta(), 'db.json');
  const saiu = new Date(Date.now() - 3_600_000).toISOString();
  fs.writeFileSync(file, JSON.stringify({
    produtos: {
      'Geral:MLB1': { ...oferta('MLB1'), status: 'ENVIADO', enviadoEm: saiu },
      'Geral:MLB2': { ...oferta('MLB2'), status: 'INCERTO' },
      'Geral:MLB3': { ...oferta('MLB3'), status: 'PRONTO' },
    },
    historico: { 'Geral:MLB1': saiu, 'Geral:MLB2': saiu }, vistos: {}, stats: {},
  }));
  const s = new Store(file);
  assert.equal(s.data.nomes[`Geral:${'fone bluetooth modelo mlb1'}`], saiu);
  assert.equal(s.jaPublicado(oferta('MLB99', { nome: 'Fone Bluetooth Modelo MLB1' }), 5), 'mesmo produto já publicado (outro anúncio)');
  assert.ok(s.jaPublicado(oferta('MLB98', { nome: 'Fone Bluetooth Modelo MLB2' }), 5), 'INCERTO também conta');
  assert.equal(s.jaPublicado(oferta('MLB97', { nome: 'Fone Bluetooth Modelo MLB3' }), 5), null, 'PRONTO não conta');
});

test('fila antiga: oferta do ML sem mais de 50 vendas é barrada na hora de postar; caixa de entrada e outras lojas passam', async () => {
  const s = novoStore();
  s.upsert(oferta('MLB1', { vendidos: undefined, descontoPct: 90 })); // de antes da regra: sem rótulo
  s.upsert(oferta('MLB2', { vendidos: '50 vendidos', descontoPct: 80 })); // exatamente 50: fora ("+50" = mais de 50 passaria)
  const d = destino();
  assert.equal(await enviarProximo(d, GRUPO, s), null);
  assert.equal(d.postados.length, 0);
  assert.equal(s.list().find((p) => p.id === 'MLB1').status, 'REJEITADO');
  assert.equal(s.list().find((p) => p.id === 'MLB1').erro, 'sem dado de vendas');
  assert.equal(s.list().find((p) => p.id === 'MLB2').erro, 'até 50 vendas');

  const c = novoStore();
  c.upsert(oferta('MLB3', { vendidos: undefined, origem: 'espelho', categoria: 'Espelho: Caixa de entrada' })); // fila antiga, sem `manual`
  c.upsert(oferta('MLB4', { vendidos: undefined, origem: 'espelho', manual: true }));
  c.upsert(oferta('AMZ-1', { vendidos: undefined, loja: 'amazon', linkAfiliado: 'https://www.amazon.com.br/dp/B0X?tag=vic-20' }));
  const d2 = destino();
  for (let i = 0; i < 3; i++) assert.ok(await enviarProximo(d2, GRUPO, c));
  assert.equal(d2.postados.length, 3);
  assert.deepEqual(c.list().map((p) => p.status), ['ENVIADO', 'ENVIADO', 'ENVIADO']);
});

// ---------------------------------------------------------------------------- deduplicação

test('deduplicação: produto novo passa; o mesmo id ou o mesmo produto com outro id não sai de novo, nem depois de religar', async () => {
  const file = path.join(pasta(), 'db.json');
  const s = new Store(file);
  const f = { diasSemRepetir: 5 };
  assert.equal(motivoRecusa(oferta('MLB1'), f, s), null);
  s.upsert(oferta('MLB1'));
  // outro anúncio, mesmo produto, texto com acento/maiúscula diferentes: vira duplicado na fila
  assert.equal(motivoRecusa(oferta('MLB2', { nome: 'FONE bluetooth modelo mlb1' }), f, s), 'duplicado na fila');
  const d = destino();
  await enviarProximo(d, GRUPO, s);
  assert.equal(d.postados.length, 1);

  const depois = new Store(file); // bot religado: o histórico continua lá
  assert.equal(motivoRecusa(oferta('MLB1'), f, depois), 'enviado recentemente');
  assert.equal(motivoRecusa(oferta('MLB3', { nome: 'Fone  Bluetooth — Modelo MLB1' }), f, depois), 'enviado recentemente');
  // números e unidades contam: outro tamanho é outro produto
  assert.equal(motivoRecusa(oferta('MLB4', { nome: 'Fone Bluetooth Modelo MLB2' }), f, depois), null);
});

test('deduplicação na hora de postar: dois anúncios do mesmo produto na fila → só um sai, o outro fica DUPLICADO', async () => {
  const s = novoStore();
  s.upsert(oferta('MLB1', { nome: 'Creatina 300g Pura', descontoPct: 60 }));
  s.upsert(oferta('MLB2', { nome: 'Creatina 300g Pura', descontoPct: 59 })); // entrou sem passar pelo filtro
  const d = destino();
  await enviarProximo(d, GRUPO, s);
  await enviarProximo(d, GRUPO, s);
  assert.equal(d.postados.length, 1);
  assert.deepEqual(s.list().map((p) => p.status).sort(), ['DUPLICADO', 'ENVIADO']);
});

test('duas execuções ao mesmo tempo tentando publicar o mesmo produto: só uma publica', async () => {
  const s = novoStore();
  s.upsert(oferta('MLB1'));
  const lento = destino();
  const enviar = lento.sendImage;
  lento.sendImage = async (...a) => (await new Promise((r) => setTimeout(r, 50)), enviar(...a));
  const [r1, r2] = await Promise.all([enviarProximo(lento, GRUPO, s), enviarProximo(lento, GRUPO, s)]);
  assert.equal(lento.postados.length, 1);
  assert.equal([r1, r2].filter(Boolean).length, 1); // a outra encontrou a fila vazia (o item já estava ENVIANDO)
});

// ---------------------------------------------------------------------------- publicação e falhas

test('publicação: sucesso, falha clara (tenta de novo até 3 vezes) e link inválido (não publica)', async () => {
  const s = novoStore();
  s.upsert(oferta('MLB1'));
  let recusar = true;
  const d = destino(() => (recusar ? new Error('Telegram sendPhoto: Bad Request: chat not found') : null));
  for (let i = 1; i <= 3; i++) {
    const p = await enviarProximo(d, GRUPO, s);
    assert.equal(p.status, 'ERRO');
    assert.equal(p.tentativas, i);
    assert.equal(s.reabrirErros(), i < 3 ? 1 : 0); // na 3ª falha, não volta mais
  }
  s.list()[0].tentativas = 1;
  s.reabrirErros();
  recusar = false;
  assert.equal((await enviarProximo(d, GRUPO, s)).status, 'ENVIADO');
  assert.equal(d.postados.length, 1);

  s.upsert(oferta('MLB5', { nome: 'Outro produto', linkAfiliado: 'https://www.mercadolivre.com.br/p/MLB5' })); // sem afiliado
  assert.equal(await enviarProximo(d, GRUPO, s), null);
  assert.equal(s.list((p) => p.id === 'MLB5')[0].status, 'REJEITADO');
  assert.equal(d.postados.length, 1);
});

test('timeout com resultado desconhecido: vira INCERTO, avisa o dono e NUNCA é repetido', async () => {
  const file = path.join(pasta(), 'db.json');
  const s = new Store(file);
  s.upsert(oferta('MLB1'));
  const d = destino(semResposta);
  const avisos = [];
  const fakeAvisos = { filaVazia: async () => {}, falhaEnvio: async () => {}, envioIncerto: async (g, p) => avisos.push(`${g}:${p.id}`) };
  await enviarParaTodos(d, s, fakeAvisos, [GRUPO]);
  assert.equal(s.list()[0].status, 'INCERTO');
  assert.deepEqual(avisos, ['Geral:MLB1']);
  assert.equal(s.reabrirErros(), 0); // retentativa automática não pega INCERTO
  assert.equal(await enviarProximo(destino(), GRUPO, s), null);
  // na limpeza da meia-noite ele some da fila, mas o histórico segura: não volta na próxima busca
  s.limparDia();
  assert.equal(motivoRecusa(oferta('MLB1'), GRUPO.filtros, s), 'enviado recentemente');
});

test('bot caiu no meio do envio (ENVIANDO gravado): ao religar vira INCERTO e não é reenviado', async () => {
  const file = path.join(pasta(), 'db.json');
  const s = new Store(file);
  s.upsert(oferta('MLB1'));
  s.setStatus(s.list()[0], 'ENVIANDO');
  s.save();
  const religado = new Store(file);
  assert.deepEqual(religado.recuperarEnvios().map((p) => p.id), ['MLB1']);
  assert.equal(religado.list()[0].status, 'INCERTO');
  assert.equal(await enviarProximo(destino(), GRUPO, religado), null);
  // e se a meia-noite chegar com algo em ENVIANDO, o histórico também guarda
  const outro = novoStore();
  outro.upsert(oferta('MLB2'));
  outro.setStatus(outro.list()[0], 'ENVIANDO');
  outro.limparDia();
  assert.equal(outro.enviadoRecentemente('MLB2', 'Geral', 5), true);
});

test('links: só sai link de afiliado bem formado de cada programa', () => {
  const ok = (linkAfiliado, loja) => motivoLinkInvalido({ linkAfiliado, loja });
  assert.equal(ok('https://meli.la/1d7rcvB'), null);
  assert.equal(ok('https://www.mercadolivre.com.br/social/pndaaaa?matt_word=pndaaaa&matt_tool=1'), null);
  assert.equal(ok('https://www.mercadolivre.com.br/p/MLB1'), 'link do ML sem afiliado');
  assert.equal(ok('https://meli.la/'), 'link do ML sem afiliado');
  assert.equal(ok('meli.la/abc'), 'link inválido');
  assert.equal(ok(undefined), 'link inválido');
  assert.equal(ok('https://www.amazon.com.br/dp/B0X?tag=vic-20', 'amazon'), null);
  assert.equal(ok('https://www.amazon.com.br/dp/B0X', 'amazon'), 'link da Amazon sem etiqueta');
  assert.equal(ok('https://tidd.ly/4ey6DWi', 'awin'), null);
  assert.equal(ok('https://www.awin1.com/cread.php?awinmid=17697&awinaffid=1694399&ued=x', 'awin'), null);
  assert.equal(ok('https://www.awin1.com/cread.php?awinmid=17697', 'awin'), 'link da Awin sem id de afiliado');
  assert.equal(ok('http://meli.la/abc'), 'link inválido');
});

// ---------------------------------------------------------------------------- Telegram

const respostaTelegram = (status, corpo) => ({ status, json: async () => corpo });

test('Telegram: sem resposta ou erro 5xx = incerto, sem 2ª tentativa; foto recusada (400) cai no envio do arquivo; 429 espera e repete', async () => {
  const chamadas = [];
  const comFetch = (fn) => new TelegramSender({ token: 't', fetchImpl: async (url, o) => (chamadas.push(url.split('/').pop()), fn(url, o)) });

  // tempo esgotado no sendPhoto: não manda texto nem baixa a foto
  chamadas.length = 0;
  await assert.rejects(comFetch(() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }).sendImage('-1', 'https://img/x.jpg', 'oi'), (e) => e.incerto === true);
  assert.deepEqual(chamadas, ['sendPhoto']);

  chamadas.length = 0;
  await assert.rejects(comFetch(() => respostaTelegram(502, {})).sendImage('-1', 'https://img/x.jpg', 'oi'), (e) => e.incerto === true);
  assert.deepEqual(chamadas, ['sendPhoto']);

  // 400 de foto: o Telegram respondeu "não foi" → baixa a foto e envia o arquivo
  chamadas.length = 0;
  const r = await comFetch((url) =>
    url.endsWith('sendPhoto') && chamadas.filter((c) => c === 'sendPhoto').length === 1
      ? respostaTelegram(400, { ok: false, description: 'Bad Request: failed to get HTTP URL content' })
      : url.startsWith('https://img')
        ? { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }
        : respostaTelegram(200, { ok: true, result: {} })
  ).sendImage('-1', 'https://img/x.jpg', 'oi');
  assert.deepEqual(r, { comImagem: true });
  assert.deepEqual(chamadas, ['sendPhoto', 'x.jpg', 'sendPhoto']);

  // 429: espera o que o Telegram mandou e tenta de novo (não posta duas vezes: a 1ª não entrou)
  chamadas.length = 0;
  let vez = 0;
  await comFetch(() => (vez++ === 0 ? respostaTelegram(429, { ok: false, parameters: { retry_after: 0 } }) : respostaTelegram(200, { ok: true, result: {} }))).sendText('-1', 'oi');
  assert.deepEqual(chamadas, ['sendMessage', 'sendMessage']);
});
