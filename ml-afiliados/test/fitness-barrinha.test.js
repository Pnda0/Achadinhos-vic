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

// 05/11/2026, o dono: "o Sentinela Promo só manda coisa boa... o que importa lá são os whey, as barrinhas" e
// "Supercoffee 3.0 Caffeine Army – Baunilha 380g, tem?". Marcas de suplemento que faltavam.
test('Fitness: suplementos das marcas que faltavam (Dark Lab, Caffeine Army...) entram; FTW de placa de vídeo não', () => {
  for (const nome of ['Supercoffee 3.0 Caffeine Army – Baunilha 380g', 'Creatina 100% Pura 1kg Dark Lab', 'Whey Protein Gold Standard Optimum Nutrition 907g', 'Creatina Monohidratada FTW 300g', 'Whey Protein Concentrado Dymatize Elite 900g', 'Pré-Treino Soldiers Nutrition 300g']) {
    assert.equal(motivoPeloNome({ nome }, f), null, nome);
  }
  assert.ok(motivoPeloNome({ nome: 'Placa de Vídeo EVGA GeForce RTX 3080 FTW3 Ultra' }, f));
  assert.ok(motivoPeloNome({ nome: 'Pelúcia Pura Vida Praia' }, f), 'Puravida só com produto de suplemento');
});

// 05/11/2026, o dono: "relógio inteligente de marca boa, não genéricos".
test('Fitness: relógio inteligente de marca boa entra; genérico, acessório e GPS de carro não', () => {
  for (const nome of ['Smartwatch Amazfit Balance Feminino Rosa', 'Relógio Garmin Forerunner 265 GPS Feminino', 'Garmin Venu 3S Sage Gray', 'Apple Watch SE GPS 40mm Estelar', 'Samsung Galaxy Watch7 40mm Creme', 'Xiaomi Smart Band 9 Rosa', 'Relógio Polar Pacer Pro Branco', 'Smartwatch Huawei Watch Fit 3 Rosa', 'Coros Pace 3 GPS Branco']) {
    assert.equal(motivoPeloNome({ nome }, f), null, nome);
  }
  for (const nome of ['Smartwatch D20 Feminino Rosa Bluetooth', 'Relógio Inteligente Ultra 9 Pro Max', 'Pulseira de Silicone Compatível Apple Watch 41mm', 'Película para Galaxy Watch 6', 'Carregador Magnético Amazfit Bip', 'GPS Automotivo Garmin Drive 52', 'Smartphone Xiaomi Redmi Note 13 128GB', 'Blusa Fleece Polar Feminina', 'Smartwatch Infantil Xiaomi Kids']) {
    assert.ok(motivoPeloNome({ nome }, f), nome);
  }
});

// 05/11/2026, o dono (bravo, com o grupo no ar): "DREJEW 2 Peças Brincos De Pérola" saiu no Fitness. "Fila" (a marca)
// também é fileira ("pérola fila dupla"): marca com nome de palavra comum só vale junto do tipo de produto certo.
test('Fitness: bijuteria e palavras comuns que são marca (fila, puma, growth, +mu, dux) não passam sozinhas', () => {
  for (const nome of ['DREJEW 2 Peças Brincos De Pérola', 'DREJEW 2 Peças Brincos De Pérola Fila Dupla Feminino', 'Colar de Pérolas 3 Filas Banhado a Ouro', 'Organizador de Fila Retrátil', 'Pelúcia Puma Filhote', 'Hair Growth Oil Alecrim 30ml', 'Brinco Argola Adidas', 'Anel Prata 925 Ajustável', 'Tiara Fitness Feminina Strass', 'Kit Pincéis Maquiagem Nike']) {
    assert.ok(motivoPeloNome({ nome }, f), nome);
  }
  for (const nome of ['Tênis Fila Racer Feminino', 'Legging Puma Feminina Training', 'Creatina Growth 250g', 'Whey Protein Concentrado Growth 1kg', 'Kit 12 Barrinhas +Mu Proteína', 'Whey Dux Nutrition 900g']) {
    assert.equal(motivoPeloNome({ nome }, f), null, nome);
  }
});
