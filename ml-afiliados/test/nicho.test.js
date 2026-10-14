import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos, loadNichos, loadCategorias } from '../src/config.js';
import { motivoRecusa } from '../src/pipeline.js';
import { estiloDoProduto, tituloPronto } from '../src/caption.js';
import { casaTermo, normalizar } from '../src/util.js';

const fitness = loadGrupos().find((g) => g.nome === 'Fitness');
const prod = (nome, extra = {}) => ({ id: 'MLB1', grupo: 'Fitness', nome, precoAtual: 99, descontoPct: 30, nota: 4.6, vendidos: '+1000 vendidos', ...extra });
const motivo = (nome, extra) => motivoRecusa(prod(nome, extra), fitness.filtros);

test('casaTermo: palavra inteira, sem acento, plural simples e "a+b"', () => {
  assert.equal(normalizar('Pré-Treino  300g (Limão)'), 'pre treino 300g limao');
  assert.equal(casaTermo(normalizar('Pré-Treino Insano 300g'), 'pre treino'), true);
  assert.equal(casaTermo(normalizar('Kit 3 Leggings Suplex'), 'legging'), true);
  assert.equal(casaTermo(normalizar('Tênis De Corrida Masculino'), 'tenis+corrida'), true);
  assert.equal(casaTermo(normalizar('Tênis Casual Feminino'), 'tenis+corrida'), false);
  assert.equal(casaTermo(normalizar('Laptop Fitness Pro'), 'top+fitness'), false); // "top" dentro de "laptop" não vale
  assert.equal(casaTermo(normalizar('Topper De Bolo'), 'top'), false);
});

test('grupo Fitness usa o nicho: palavras, bloqueios e títulos vêm de config/nichos.json', () => {
  assert.ok(fitness, 'grupo Fitness existe em config/grupos.json');
  assert.equal(fitness.nicho, 'fitness');
  assert.ok(fitness.filtros.palavrasObrigatorias.includes('whey'));
  assert.ok(fitness.filtros.palavrasBloqueadas.includes('usado')); // os bloqueios padrão continuam valendo
  assert.ok(fitness.filtros.palavrasBloqueadas.includes('aquario'));
  assert.ok(fitness.filtros.palavrasObrigatorias.includes('fone')); // extras também entram
  assert.deepEqual(fitness.titulos, loadNichos().fitness.titulos);
  assert.ok(loadNichos().fitness.titulos.medio.includes(tituloPronto({ descontoPct: 30 }, fitness.titulos)));
  const geral = loadGrupos().find((g) => g.nome === 'Geral');
  assert.equal(geral.filtros.palavrasObrigatorias, undefined); // grupo sem nicho não muda
  // "ligado" no arquivo (com ou sem canal): toda categoria ativa aponta para um grupo ligado
  const ligados = new Set(loadGrupos().filter((g) => g.ativo || g.emEspera).map((g) => g.nome));
  assert.ok(loadCategorias().filter((c) => c.ativo).every((c) => ligados.has(c.grupo)), 'categoria ativa aponta para grupo ligado');
});

test('site e bot: os três grupos de nicho existem, cada um com o seu nicho e títulos', () => {
  const grupos = loadGrupos();
  for (const [nome, nicho] of [['Fitness', 'fitness'], ['Beleza', 'beleza'], ['Perfumes', 'perfumes']]) {
    const g = grupos.find((x) => x.nome === nome);
    assert.equal(g?.nicho, nicho, nome);
    assert.ok(g.titulos?.alto?.length && g.tema, `${nome} tem títulos e tema`);
    assert.ok(loadCategorias().some((c) => c.ativo && c.grupo === nome), `${nome} tem categoria ativa`);
  }
});

test('perfumes e beleza: cada oferta cai no grupo certo', () => {
  const grupos = loadGrupos();
  const em = (grupo, nome) => motivoRecusa({ id: 'X', grupo, nome, precoAtual: 99, descontoPct: 30, nota: 4.6, vendidos: '+1000 vendidos' }, grupos.find((g) => g.nome === grupo).filtros);
  for (const nome of [
    'Perfume Lattafa Asad Eau De Parfum 100ml Masculino',
    'Club De Nuit Intense Man Armaf Edt 105ml',
    'Body Splash Victoria Secret Love Spell 250ml',
    'Malbec Desodorante Colônia 100ml O Boticário',
    'Kit Perfume Feminino La Rive + Hidratante',
  ]) {
    assert.equal(em('Perfumes', nome), null, nome);
  }
  for (const nome of [
    'Perfume Automotivo Aromatizante Carro Novo',
    'Difusor De Ambiente Perfume Bamboo 250ml',
    'Porta Perfume Recarregável De Bolso 5ml',
    'Perfume Para Roupas Comfort 300ml',
    'Perfume Pet Para Cachorro Banho E Tosa',
  ]) {
    assert.equal(em('Perfumes', nome), 'palavra bloqueada', nome);
  }
  assert.equal(em('Perfumes', 'Base Líquida Matte Ruby Rose'), 'fora do nicho');
  assert.equal(em('Perfumes', 'Perfume Importado 100ml', ), null);
  for (const nome of ['Base Líquida Matte Ruby Rose', 'Sérum Facial Vitamina C 30ml', 'Shampoo Reconstrução 300ml', 'Secador De Cabelo Taiff 2000w', 'Creme Hidratante Corporal 200 Gramas']) {
    assert.equal(em('Beleza', nome), null, nome);
  }
  // perfume agora é só do grupo Perfumes; e palavra bloqueada vale como palavra inteira ("pet" não barra "tapete")
  assert.equal(em('Beleza', 'Perfume Lattafa Asad Eau De Parfum 100ml'), 'fora do nicho');
  assert.equal(em('Beleza', 'Aparador De Grama Elétrico 1000w'), 'palavra bloqueada');
  assert.equal(em('Beleza', 'Escova De Cabelo Para Pet Removedor De Pelos'), 'palavra bloqueada');
  assert.equal(em('Beleza', 'Esmalte Em Gel Kit Competição Unha'), null);
});

test('fitness: o que ENTRA (suplementos, roupa e tênis de treino, relógios e eletrônicos)', () => {
  for (const nome of [
    'Whey Protein Concentrado 900g Growth Supplements',
    'Creatina Monohidratada 300g Dark Lab Pura',
    'Pré-Treino Insano 300g Sabor Limão',
    'Hipercalórico Anabolic Mass 28500 3kg Suplemento Profit Sabor Cookies & Cream',
    'Vitamina C 1000mg 120 Cápsulas',
    'Colágeno Verisol Hidrolisado 120 Cápsulas',
    'Calça Legging Feminina Academia Cintura Alta',
    'Kit 3 Leggings Suplex Lisa',
    'Top Fitness Feminino Com Bojo Removível',
    'Kit 3 Bermudas Dry Fit Masculina Treino',
    'Camiseta Dry Fit Masculina Kit 5',
    'Tênis Kappa Pulse Unissex Academia Caminhada',
    'Tênis Olympikus Corre 3 Masculino',
    'Tênis Masculino Esportivo Leve Para Corrida',
    'Smartwatch Xiaomi Redmi Watch 5 Active',
    'Relógio Inteligente Amazfit Bip 5',
    'Fone De Ouvido Esportivo Bluetooth Jbl Endurance',
    'Balança Digital Corporal Bioimpedância Bluetooth',
  ]) {
    assert.equal(motivo(nome), null, nome);
  }
});

test('fitness: equipamentos e acessórios de relógio entram com títulos do tema', () => {
  for (const nome of [
    'Halter Emborrachado 5kg Par',
    'Kettlebell Emborrachado 12kg',
    'Tapete De Yoga Antiderrapante 6mm',
    'Kit Faixa Elástica Mini Band 5 Intensidades',
    'Pulseira Para Apple Watch Silicone 45mm',
    'Película Protetora Smartwatch 44mm Kit 3',
    'Carregador Magnético Para Smartwatch Amazfit',
  ]) {
    assert.equal(motivo(nome), null, nome);
    assert.deepEqual(estiloDoProduto(prod(nome), fitness).titulos, fitness.titulos, nome);
  }
});

test('fitness: extras (tênis casual, fone) entram com títulos gerais; beleza, perfume e ração têm os seus grupos', () => {
  for (const nome of ['Tênis Vizzano Casual Feminino Plataforma Leve Ultra Conforto', 'Fone De Ouvido Bluetooth Sem Fio Tws']) {
    assert.equal(motivo(nome), null, nome);
    assert.deepEqual(estiloDoProduto(prod(nome), fitness), { titulos: null, tema: null }, nome);
  }
  for (const nome of ["Perfume Feminino L' Eau de Parfum Fragrância Floral Gourmand", 'Protetor Solar Corporal Fps 50', 'Ração Golden Gatos Castrados 10kg']) {
    assert.equal(motivo(nome), 'fora do nicho', nome);
  }
  // casam com "vitamina"/"proteina", mas não são de treino
  for (const nome of ['Sérum Facial Vitamina C 30ml', 'Shampoo Reconstrução Proteína Capilar', 'Ração Premium Alta Proteína Cães Adultos 15kg']) {
    assert.equal(motivo(nome), 'palavra bloqueada', nome);
  }
  assert.deepEqual(estiloDoProduto(prod('Whey Protein 900g'), fitness).titulos, fitness.titulos);
  assert.deepEqual(estiloDoProduto(prod('Qualquer'), { titulos: ['X'] }).titulos, ['X']); // grupo sem nicho
});

test('fitness: o que FICA DE FORA', () => {
  for (const nome of [
    'Nobreak Attiv 600 Bivolt 600va Preto',
    'Video Porteiro Ivr 1010 Branco E Preto Intelbras',
    'Liquidificador Easy Power 550w Mondial',
    'Notebook Laptop Gamer 16gb',
    'Pulseira Feminina Prata 925 Coração',
    'Película Vidro 3d Para iPhone 15',
    'Carregador Turbo Usb-c 20w Para Celular',
    'Creme De Leite Nestlé 200g',
  ]) {
    assert.equal(motivo(nome), 'fora do nicho', nome);
  }
  for (const nome of ['Bomba De Aquário Para Suplemento Líquido', 'Whey Protein 900g Usado']) {
    assert.equal(motivo(nome), 'palavra bloqueada', nome);
  }
  assert.equal(motivo('Creatina 300g', { descontoPct: 5 }), 'desconto baixo');
  assert.equal(motivo('Creatina 300g', { nota: 3.1 }), 'nota baixa');
});
