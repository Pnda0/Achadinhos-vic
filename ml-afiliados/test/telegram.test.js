import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramSender, paraHTML } from '../src/telegram.js';
import { montarLegenda } from '../src/caption.js';

test('paraHTML: negrito e riscado do WhatsApp viram HTML do Telegram, sem quebrar links', () => {
  const p = { nome: 'Fone JBL <Tune> & Cia', precoAtual: 199.9, precoOriginal: 399.9, descontoPct: 50, linkAfiliado: 'https://meli.la/a_b*c' };
  const html = paraHTML(montarLegenda(p, { titulo: 'BUGOU O PREÇO' }));
  assert.match(html, /^💛 <b>MERCADO LIVRE<\/b>/);
  assert.match(html, /💰 de R\$ 399,90 por <b>R\$ 199,90<\/b>/);
  assert.match(html, /💸 Economia de R\$ 200 \(50% OFF\)/);
  assert.match(html, /<blockquote><i>Oferta válida por tempo limitado<\/i><\/blockquote>/);
  assert.match(html, /Fone JBL &lt;Tune&gt; &amp; Cia/);
  assert.match(html, /https:\/\/meli\.la\/a_b\*c/);
});

test('paraHTML: código do cupom vira <code> (um toque copia) e o preço com cupom fica em negrito', () => {
  const cupom = paraHTML(montarLegenda({ tipo: 'cupom', loja: 'awin', lojaNome: 'Granado', nome: '15% OFF', cupom: 'VIC15', linkAfiliado: 'https://tidd.ly/a' }));
  assert.match(cupom, /🎟️ Cupom: <code>VIC15<\/code> \(toque para copiar\)/);
  const ml = paraHTML(montarLegenda({ nome: 'Whey', precoAtual: 99.9, cupom: 'R$ 10 OFF com Cupom', linkAfiliado: 'https://meli.la/a' }, { titulo: 'x' }));
  assert.match(ml, /🎟️ <b>R\$ 89,90<\/b> com o cupom de R\$ 10/);
  assert.equal(paraHTML('Cupom: `A&B<10` ok'), 'Cupom: <code>A&amp;B&lt;10</code> ok');
  assert.equal(paraHTML('https://x.com/a`b`c'), 'https://x.com/a`b`c'); // crase no meio de link não vira <code>
});

function tgFalso(respostas) {
  const chamadas = [];
  const fetchImpl = async (url, opts) => {
    const metodo = url.split('/').pop();
    const body = JSON.parse(opts.body);
    chamadas.push({ metodo, body, url });
    const r = respostas(metodo, body, chamadas.length);
    return { status: r.status || 200, json: async () => r.body };
  };
  return { tg: new TelegramSender({ token: '123:ABC', fetchImpl }), chamadas };
}

test('TelegramSender: manda foto com legenda em HTML; se a foto falhar, manda o texto', async () => {
  const { tg, chamadas } = tgFalso((m) => (m === 'sendPhoto' ? { status: 400, body: { ok: false, description: 'wrong file' } } : { body: { ok: true, result: {} } }));
  const r = await tg.sendImage('-100123', 'https://img/x.jpg', '*OFERTA*\nhttps://meli.la/x');
  assert.deepEqual(r, { comImagem: false });
  assert.deepEqual(chamadas.map((c) => c.metodo), ['sendPhoto', 'sendMessage']);
  assert.equal(chamadas[0].body.caption, '<b>OFERTA</b>\nhttps://meli.la/x');
  assert.equal(chamadas[0].body.parse_mode, 'HTML');
  assert.equal(chamadas[1].body.chat_id, '-100123');
  assert.match(chamadas[0].url, /api\.telegram\.org\/bot123:ABC\/sendPhoto$/);
});

test('TelegramSender: se o Telegram não baixa a URL da foto, o bot baixa e envia o arquivo', async () => {
  const chamadas = [];
  const fetchImpl = async (url, opts) => {
    if (url === 'https://cdn1.telesco.pe/file/FOTO.jpg') return { ok: true, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 1, 2]).buffer };
    const arquivo = opts.body instanceof FormData;
    chamadas.push({ metodo: url.split('/').pop(), arquivo, body: opts.body });
    return arquivo ? { status: 200, json: async () => ({ ok: true, result: {} }) } : { status: 400, json: async () => ({ ok: false, description: 'Bad Request: failed to get HTTP URL content' }) };
  };
  const tg = new TelegramSender({ token: '123:ABC', fetchImpl });
  assert.deepEqual(await tg.sendImage('-100123', 'https://cdn1.telesco.pe/file/FOTO.jpg', '*OFERTA*'), { comImagem: true });
  assert.deepEqual(chamadas.map((c) => [c.metodo, c.arquivo]), [['sendPhoto', false], ['sendPhoto', true]]);
  const form = chamadas[1].body;
  assert.deepEqual([form.get('chat_id'), form.get('caption'), form.get('parse_mode'), form.get('photo').size], ['-100123', '<b>OFERTA</b>', 'HTML', 4]);
});

test('TelegramSender: lista os chats vistos e espera quando o Telegram pede (429)', async () => {
  let n = 0;
  const { tg } = tgFalso((m) => {
    if (m === 'getUpdates')
      return { body: { ok: true, result: [
        { channel_post: { chat: { id: -1001, title: 'Panda Ofertas (teste)', type: 'channel' } } },
        { message: { chat: { id: 555, first_name: 'Alan', type: 'private' } } },
        { channel_post: { chat: { id: -1001, title: 'Panda Ofertas (teste)', type: 'channel' } } },
      ] } };
    n++;
    return n === 1 ? { status: 429, body: { ok: false, parameters: { retry_after: 0 } } } : { body: { ok: true, result: {} } };
  });
  assert.deepEqual(await tg.listGroups(), [
    { nome: 'Panda Ofertas (teste)', jid: '-1001', tipo: 'channel' },
    { nome: 'Alan', jid: '555', tipo: 'private' },
  ]);
  await tg.sendText('-1001', 'oi');
  assert.equal(n, 2, 'tentou de novo depois do 429');
  await assert.rejects(new TelegramSender({ token: '' }).init(), /TELEGRAM_BOT_TOKEN/);
});

test('TelegramSender.lerMensagens: só o chat pedido, com link escondido e foto, e confirma o que já leu', async () => {
  const { tg, chamadas } = tgFalso((m, body) => ({ body: { ok: true, result: body.offset ? [] : [
    { update_id: 10, message: { message_id: 1, date: 1_800_000_000, chat: { id: 555, first_name: 'Alan', type: 'private' }, caption: 'Fone JBL por R$ 199', caption_entities: [{ type: 'bold' }, { type: 'text_link', url: 'https://amzn.to/3AbCdEf' }], photo: [{ file_id: 'pequena' }, { file_id: 'GRANDE' }] } },
    { update_id: 11, message: { message_id: 7, date: 1_800_000_001, chat: { id: 999, first_name: 'Estranho', type: 'private' }, text: 'https://amzn.to/golpe' } },
    { update_id: 12, channel_post: { message_id: 3, chat: { id: -1001, title: 'Canal', type: 'channel' }, text: 'x' } },
  ] } }));
  assert.deepEqual(await tg.lerMensagens(['555']), [
    { id: 'tg-555-1', jid: '555', t: 1_800_000_000, tipo: 'image', texto: 'Fone JBL por R$ 199\nhttps://amzn.to/3AbCdEf', foto: 'GRANDE' },
  ]);
  assert.deepEqual(await tg.lerMensagens(['555']), []);
  assert.equal(chamadas[1].body.offset, 13);
  assert.deepEqual((await tg.listGroups()).map((c) => c.jid), ['555', '999', '-1001']); // os chats lidos continuam na lista
});

test('arte do bot (assets/cupom.jpg): sobe o arquivo na 1ª vez e reaproveita o file_id depois', async () => {
  const pedidos = [];
  const fetchImpl = async (url, opts) => {
    const metodo = url.split('/').pop();
    pedidos.push([metodo, opts.body instanceof FormData ? 'arquivo' : JSON.parse(opts.body).photo]);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { photo: [{ file_id: 'pequeno' }, { file_id: 'ARTE123' }] } }) };
  };
  const t = new TelegramSender({ token: 'x', fetchImpl });
  assert.deepEqual(await t.sendImage('-1', 'assets/cupom.jpg', '*CUPOM C&A*'), { comImagem: true });
  assert.deepEqual(await t.sendImage('-2', 'assets/cupom.jpg', '*CUPOM RENNER*'), { comImagem: true });
  assert.deepEqual(pedidos, [['sendPhoto', 'arquivo'], ['sendPhoto', 'ARTE123']]);
});
