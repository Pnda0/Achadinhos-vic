import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codigoDoConvite, ligarGruposWhatsApp } from '../src/grupos-whatsapp.js';
import { Espelho } from '../src/espelho.js';
import { Store } from '../src/store.js';
import { loadNichos } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gw-'));

test('código do convite do WhatsApp', () => {
  assert.equal(codigoDoConvite('https://chat.whatsapp.com/ESjEPXL0XmPIt3085EaK3Y'), 'ESjEPXL0XmPIt3085EaK3Y');
  assert.equal(codigoDoConvite('https://chat.whatsapp.com/invite/ABC123?mode=r'), 'ABC123');
  assert.equal(codigoDoConvite(''), '');
});

test('grupo do WhatsApp para copiar (Apromo da Luh, 29/10/2026): o chip entra uma vez pelo convite e só a Amazon/ML entram', async () => {
  const dir = tmp();
  const arquivo = path.join(dir, 'whatsapp-fontes.json');
  const c = {
    grupos: [{ titulo: 'Apromo da Luh', convite: 'https://chat.whatsapp.com/ESjEPXL0XmPIt3085EaK3Y' }],
    destinos: [{ grupo: 'Fitness', nicho: 'fitness' }, { grupo: 'Beleza', nicho: 'beleza' }, { grupo: 'Perfumes', nicho: 'perfumes' }],
    apenasAmazon: true, mlPeloNome: true, exigirVendas: false, copiarTexto: false, fotoDoCanal: false, maxPorHora: 3,
  };
  const entradas = [];
  const avisos = [];
  let grupos = [{ jid: '111@g.us', nome: 'Achadinhos Vic - Beleza' }];
  const whats = {
    listGroups: async () => grupos,
    entrarNoGrupo: async (codigo) => (entradas.push(codigo), '999@g.us'),
  };
  const opcoes = { nichos: loadNichos(), lojasParceiras: true, arquivo, avisar: async (t) => avisos.push(t) };
  const [f] = await ligarGruposWhatsApp(whats, c, opcoes);
  assert.deepEqual(entradas, ['ESjEPXL0XmPIt3085EaK3Y']);
  assert.equal(avisos.length, 1);
  assert.equal(f.jid, '999@g.us');
  assert.deepEqual([f.apenasAmazon, f.soAmazon, f.mlPeloNome, f.lojasParceiras, f.exigirVendas, f.copiarTexto], [true, true, true, false, false, false]);
  assert.deepEqual(f.destinos.map((d) => d.grupo), ['Fitness', 'Beleza', 'Perfumes']);

  // Ligando de novo, já dentro do grupo (com o nome real dele): não pede para entrar outra vez.
  grupos = [...grupos, { jid: '999@g.us', nome: '38 - Apromo da Luh 👠💄' }];
  const [f2] = await ligarGruposWhatsApp(whats, c, opcoes);
  assert.equal(entradas.length, 1);
  assert.equal(f2.nome, '38 - Apromo da Luh 👠💄');

  // Convite recusado (ex.: grupo com aprovação do admin): avisa o dono e segue sem o grupo.
  const recusa = { listGroups: async () => [], entrarNoGrupo: async () => { throw new Error('not-authorized'); } };
  assert.deepEqual(await ligarGruposWhatsApp(recusa, c, { ...opcoes, arquivo: path.join(dir, 'outro.json') }), []);
  assert.match(avisos.at(-1), /Não consegui entrar.*not-authorized/);

  // As mensagens do grupo passam pelo espelho: Amazon de beleza entra, Shopee e Sephora ficam de fora.
  const agora = Date.UTC(2027, 0, 15, 12, 0);
  const t = Math.floor(agora / 1000) - 60;
  const store = new Store(path.join(dir, 'db.json'));
  const espelho = new Espelho({
    sender: { lerMensagens: async () => [
      { id: 'w1', jid: f2.jid, t, texto: 'Batom Líquido Maybelline Superstay Matte Ink\nDe R$ 69 por R$ 39\nhttps://www.amazon.com.br/dp/B0BATOM001' },
      { id: 'w2', jid: f2.jid, t, texto: 'Batom Ruby Rose\nR$ 9\nhttps://s.shopee.com.br/abc' },
      { id: 'w3', jid: f2.jid, t, texto: 'Base Fenty Beauty 50% OFF\nhttps://www.sephora.com.br/base-fenty' },
    ] },
    store, affiliate: {}, fontes: [f2],
    grupos: [{ nome: 'Geral', ativo: false, filtros: {} }, { nome: 'Fitness', ativo: true, filtros: {} }, { nome: 'Beleza', ativo: true, filtros: {} }, { nome: 'Perfumes', ativo: true, filtros: {} }],
    cfg: { maxPorHora: 3 }, agora: () => agora, esperar: async () => {}, amazonTag: 'achadin09027e-20',
  });
  const r = await espelho.tick();
  assert.equal(r.enfileiradas, 1);
  assert.deepEqual(r.ignoradas, { 'sem link da Amazon': 2 });
  const fila = store.list();
  assert.deepEqual(fila.map((p) => p.grupo), ['Beleza']);
  assert.equal(fila[0].linkAfiliado, 'https://www.amazon.com.br/dp/B0BATOM001?tag=achadin09027e-20');
  fs.rmSync(dir, { recursive: true, force: true });
});
