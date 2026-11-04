import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos } from '../src/config.js';
import { liberadoSemMarca } from '../src/genero.js';
import { motivoPeloNome } from '../src/pipeline.js';

// 04/11/2026, o dono (Fitness parado desde o meio-dia): "busque os fitness femininos no Mercado Livre... não pode ficar parado".
test('Fitness: feminino sem marca passa só vindo das categorias/buscas com "semMarca"; masculino e o resto continuam de fora', () => {
  const f = loadGrupos().find((g) => g.nome === 'Fitness').filtros;
  const p = (nome, semMarca) => ({ nome, ...(semMarca && { semMarca }) });
  assert.equal(motivoPeloNome(p('Calça Legging Feminina Cintura Alta Fitness'), f), 'sem marca da lista', 'sem a marcação: regra de marca de sempre');
  assert.equal(motivoPeloNome(p('Calça Legging Feminina Cintura Alta Fitness', 'feminino'), f), null);
  assert.equal(motivoPeloNome(p('Leggings Fitness Cintura Alta Sem Transparência', 'feminino'), f), null, 'leggings no plural é feminino');
  assert.equal(motivoPeloNome(p('Top Academia Alça Fina Com Bojo', 'naoMasculino'), f), null);
  assert.equal(motivoPeloNome(p('Tapete de Yoga Antiderrapante 6mm', 'naoMasculino'), f), null);
  assert.equal(motivoPeloNome(p('Conjunto Academia Masculino Dry Fit', 'feminino'), f), 'sem marca da lista');
  assert.equal(motivoPeloNome(p('Short Fitness Masculino Treino', 'naoMasculino'), f), 'sem marca da lista');
  assert.equal(motivoPeloNome(p('Legging Feminina Futebol Society', 'feminino'), f), 'palavra bloqueada', 'futebol continua fora');
  assert.equal(liberadoSemMarca({ nome: 'Legging Feminina' }), false);
});
