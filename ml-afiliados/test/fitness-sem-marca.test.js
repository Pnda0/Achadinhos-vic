import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos } from '../src/config.js';
import { liberadoSemMarca } from '../src/genero.js';
import { motivoPeloNome } from '../src/pipeline.js';

// 04/11/2026, o dono (Fitness parado desde o meio-dia): "busque os fitness femininos... não pode ficar parado".
// À noite: "tire esses shorts, calça e legging sem marca do Mercado Livre, muito feio" — do ML, só com marca.
test('Fitness sem marca: só da Shopee e só feminino; do Mercado Livre nunca (nem o que já estava na fila)', () => {
  const f = loadGrupos().find((g) => g.nome === 'Fitness').filtros;
  const shp = (nome, semMarca) => ({ nome, loja: 'shopee', ...(semMarca && { semMarca }) });
  assert.equal(motivoPeloNome(shp('Calça Legging Feminina Cintura Alta Fitness'), f), 'sem marca da lista', 'sem a marcação: regra de marca de sempre');
  assert.equal(motivoPeloNome(shp('Calça Legging Feminina Cintura Alta Fitness', 'feminino'), f), null);
  assert.equal(motivoPeloNome(shp('Leggings Fitness Cintura Alta Sem Transparência', 'feminino'), f), null, 'leggings no plural é feminino');
  assert.equal(motivoPeloNome(shp('Conjunto Academia Masculino Dry Fit', 'feminino'), f), 'sem marca da lista');
  assert.equal(motivoPeloNome(shp('Tapete de Yoga Antiderrapante 6mm', 'naoMasculino'), f), 'palavra bloqueada', 'yoga saiu do Fitness');
  assert.equal(motivoPeloNome(shp('Legging Feminina Futebol Society', 'feminino'), f), 'palavra bloqueada', 'futebol continua fora');

  for (const loja of ['ml', undefined]) {
    const ml = { nome: 'Calça Legging Feminina Cintura Alta Fitness', semMarca: 'naoMasculino', ...(loja && { loja }) };
    assert.equal(liberadoSemMarca(ml), false, `ML (${loja})`);
    assert.equal(motivoPeloNome(ml, f), 'sem marca da lista');
  }
  assert.equal(motivoPeloNome({ nome: 'Legging Lupo Cintura Alta Fitness', loja: 'ml' }, f), null, 'do ML com marca da lista continua');
});
