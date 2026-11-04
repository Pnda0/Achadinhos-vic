import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVENTOS_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-')), 'produtos.log');
process.env.SIMULAR_DIGITANDO = 'false';
const { loadGrupos, loadShopee } = await import('../src/config.js');
const { motivoPeloNome, enviarProximo } = await import('../src/pipeline.js');
const { valeNoGrupo } = await import('../src/whatsapp-espelho.js');
const { Store } = await import('../src/store.js');

// 04/11/2026, à tarde o Fitness passou a aceitar feminino sem marca (Shopee e ML) para não ficar parado. À noite, o dono:
// "remove esses itens sem marca da shopee ou de qualquer outra loja, do grupo fitness por favor. são itens horríveis".
const fitness = loadGrupos().find((g) => g.nome === 'Fitness');

test('Fitness sem marca: de loja nenhuma, nem marcado como "semMarca"; com marca da lista continua', () => {
  const f = fitness.filtros;
  for (const loja of ['shopee', 'ml', 'amazon', 'awin', undefined]) {
    for (const semMarca of [undefined, 'feminino', 'naoMasculino']) {
      const p = { nome: 'Calça Legging Feminina Cintura Alta Fitness', ...(loja && { loja }), ...(semMarca && { semMarca }) };
      assert.equal(motivoPeloNome(p, f), 'sem marca da lista', `${loja} ${semMarca}`);
      assert.equal(valeNoGrupo(p, fitness), false, `WhatsApp: ${loja} ${semMarca}`);
    }
  }
  assert.equal(motivoPeloNome({ nome: 'Top Fitness Feminino Lupo Top Power', loja: 'shopee' }, f), null, 'Lupo da Shopee continua');
  assert.equal(motivoPeloNome({ nome: 'Legging Lupo Cintura Alta Fitness', loja: 'ml' }, f), null, 'Lupo do ML continua');
  assert.equal(loadShopee().grupos.Fitness.semMarca, undefined, 'a busca da Shopee não marca mais nada como sem marca');
});

test('Fitness sem marca: o que já estava na fila marcado como sem marca não sai', async () => {
  const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-fit-')), 'db.json'));
  s.upsert({ id: 'SHP-1', grupo: 'Fitness', nome: 'Short Fitness Feminino Cintura Alta Sem Transparência', loja: 'shopee', semMarca: 'feminino', url: 'https://shopee.com.br/x', imagem: 'i', precoAtual: 30, precoOriginal: 60, descontoPct: 50, linkAfiliado: 'https://s.shopee.com.br/abc' });
  const sender = { sendImage: async () => ({ comImagem: true }), sendText: async () => {} };
  assert.equal(await enviarProximo(sender, { ...fitness, jid: '-1' }, s), null);
  const p = s.list((x) => x.id === 'SHP-1')[0];
  assert.equal(p.status, 'REJEITADO');
  assert.equal(p.erro, 'sem marca da lista');
});
