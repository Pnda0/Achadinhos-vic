import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos } from '../src/config.js';
import { motivoPeloNome, prioridadeDoGrupo } from '../src/pipeline.js';

// 04/11/2026, o dono: "tem coisa demais de yoga, tire por favor, priorize tênis e suplementos das marcas boas".
test('Fitness: yoga e pilates fora; tênis e suplementos de marca da lista passam na frente, sem marca não', () => {
  const fitness = loadGrupos().find((g) => g.nome === 'Fitness');
  for (const nome of ['Tapete de Yoga Antiderrapante 6mm', 'Bola de Pilates 65cm Live!', 'Legging Feminina Yoga Cintura Alta'])
    assert.equal(motivoPeloNome({ nome, semMarca: 'naoMasculino' }, fitness.filtros), 'palavra bloqueada', nome);
  const prio = prioridadeDoGrupo(fitness);
  assert.equal(prio({ nome: 'Tênis Nike Revolution 7 Feminino' }), 4, 'whey, creatina e tênis valem 4 desde 06/11/2026');
  assert.equal(prio({ nome: 'Creatina Monohidratada 250g Growth Supplements' }), 4, 'whey, creatina e tênis valem 4 desde 06/11/2026');
  assert.equal(prio({ nome: 'Whey Protein Concentrado Max Titanium 900g' }), 4, 'whey, creatina e tênis valem 4 desde 06/11/2026');
  assert.equal(prio({ nome: 'Tênis Feminino Caminhada Confortável' }), 0, 'sem marca da lista');
  assert.equal(prio({ nome: 'Creatina Pura 300g' }), 0, 'sem marca da lista');
  assert.equal(prio({ nome: 'Legging Lupo Cintura Alta' }), 0, 'marca boa, mas não é tênis nem suplemento');
  assert.equal(prio({ nome: 'Colágeno Verisol Vitafor 300g' }), 2, 'outros suplementos de marca: 2');
  assert.equal(prioridadeDoGrupo({ nome: 'Beleza' })({ nome: 'Tênis Nike' }), 0, 'grupo sem prioridade');
});
