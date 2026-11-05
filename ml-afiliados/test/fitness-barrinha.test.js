import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGrupos } from '../src/config.js';
import { motivoPeloNome } from '../src/pipeline.js';

// 05/11/2026, o dono: "precisamos incluir barrinha e yopro no fitness, teve muita promoção boa (Amazon com cupom)".
const f = loadGrupos().find((g) => g.nome === 'Fitness').filtros;

test('Fitness: barrinhas de proteína e YoPRO das marcas entram; o resto continua de fora', () => {
  for (const nome of ['YoPRO Bebida Láctea UHT Chocolate 15g de Proteínas 250ml - 6 unidades', 'Iogurte YoPRO Morango 160g', 'Barra de Proteína Bold Bar Cookies 60g caixa com 12', 'Whey Bar Probiótica Chocolate 24 unidades', 'Barra Proteica Nutrata Nuts 12x', 'Barrinha Dr. Peanut Bar Brigadeiro 45g', 'Kit 12 Barrinhas +Mu Proteína', 'Bebida Proteica Growth Chocolate 250ml', 'Top Whey Drink Max Titanium 250ml 12 un', 'Barra de Proteína Integralmedica Protein Crisp Bar']) {
    assert.equal(motivoPeloNome({ nome }, f), null, nome);
  }
  assert.ok(motivoPeloNome({ nome: 'Camiseta Bold Masculina Estampa' }, f), 'Bold sem ser barrinha não é a marca');
  assert.ok(motivoPeloNome({ nome: 'Barra de Cereal Nutry Morango 24 un' }, f), 'sem marca da lista continua fora');
});

test('grupo de WhatsApp Sentinela Promo é fonte', () => {
  assert.ok(JSON.parse(fs.readFileSync(new URL('../config/fontes.json', import.meta.url), 'utf8')).gruposWhatsApp.grupos.some((g) => g.titulo === 'Sentinela'));
});

// 05/11/2026, o dono: "barrinha black skull não coloque mais".
test('Fitness: barrinha da Black Skull fica de fora; o resto da Black Skull continua', () => {
  for (const nome of ['Barra de Proteína Black Skull Bone Crusher Chocolate 60g 12 un', 'Barrinha Proteica Black Skull Cookies', 'Protein Bar Black Skull Caveira Preta 12x60g', 'Wafer Proteico Black Skull 12 unidades']) {
    assert.equal(motivoPeloNome({ nome }, f), 'palavra bloqueada', nome);
  }
  assert.equal(motivoPeloNome({ nome: 'Creatina Monohidratada Black Skull 300g' }, f), null);
  assert.equal(motivoPeloNome({ nome: 'Barra de Proteína Bold Bar Cookies 60g' }, f), null, 'barrinha de outra marca continua');
});
