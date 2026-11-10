import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos, loadNichos, loadCategorias, loadFontes } from '../src/config.js';
import { motivoRecusa } from '../src/pipeline.js';
import { estiloDoProduto, tituloPronto } from '../src/caption.js';
import { casaTermo, normalizar } from '../src/util.js';

// Estes testes conferem as PALAVRAS do nicho; o filtro de marcas (soMarcas) tem teste próprio (marcas.test.js).
const semFiltroDeMarca = (g) => ({ ...g, filtros: { ...g.filtros, soMarcas: false } });
const fitness = semFiltroDeMarca(loadGrupos().find((g) => g.nome === 'Fitness'));
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
    // Cada grupo precisa de alguma fonte: busca no ML ou um canal do Telegram que o alimente (o Perfumes, desde
    // 15/10/2026, vive só do @promobigodeperfumes, a pedido do dono).
    const canais = (loadFontes().cfg.canaisTelegram?.canais || []).filter((c) => typeof c === 'object' && c.destino === nome);
    assert.ok(loadCategorias().some((c) => c.ativo && c.grupo === nome) || canais.length, `${nome} tem de onde tirar ofertas`);
  }
});

test('perfumes e beleza: cada oferta cai no grupo certo', () => {
  const grupos = loadGrupos().map(semFiltroDeMarca);
  const em = (grupo, nome) => motivoRecusa({ id: 'X', grupo, nome, precoAtual: 99, descontoPct: 30, nota: 4.6, vendidos: '+1000 vendidos' }, grupos.find((g) => g.nome === grupo).filtros);
  for (const nome of [
    'Body Splash Victoria Secret Love Spell 250ml',
    'Body Splash Natura Ekos Maracujá 200ml',
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
  // 10/11/2026, o dono: "pode tirar masculino 100%" ("semMasculino" no Perfumes).
  for (const nome of ['Perfume Lattafa Asad Eau De Parfum 100ml Masculino', 'Club De Nuit Intense Man Armaf Edt 105ml']) assert.equal(em('Perfumes', nome), 'masculino', nome);
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
    'Tênis Kappa Pulse Unissex Academia Caminhada',
    'Tênis Olympikus Corre 3 Feminino',
    'Smartwatch Xiaomi Redmi Watch 5 Active',
    'Fone De Ouvido Esportivo Bluetooth Jbl Endurance',
    'Balança Digital Corporal Bioimpedância Bluetooth',
  ]) {
    assert.equal(motivo(nome), null, nome);
  }
  // Relógio de marca tem preço mínimo (config/marcas.json > precoMinimo): a R$ 99 seria réplica.
  assert.equal(motivo('Relógio Inteligente Amazfit Bip 5', { precoAtual: 399 }), null);
});

test('fitness: equipamentos entram com títulos do tema; acessório avulso de relógio não (05/11/2026)', () => {
  for (const nome of [
    'Halter Emborrachado 5kg Par',
    'Kettlebell Emborrachado 12kg',
    // (Tapete de yoga era exemplo daqui até 04/11/2026, quando o dono tirou yoga e pilates do Fitness.)
    'Kit Faixa Elástica Mini Band 5 Intensidades',
  ]) {
    assert.equal(motivo(nome), null, nome);
    assert.deepEqual(estiloDoProduto(prod(nome), fitness).titulos, fitness.titulos, nome);
  }
  // O dono, 05/11/2026: "relógio inteligente de marca boa, não genéricos" — pulseira, película e carregador avulsos saem.
  for (const nome of ['Pulseira Para Apple Watch Silicone 45mm', 'Película Protetora Smartwatch 44mm Kit 3', 'Carregador Magnético Para Smartwatch Amazfit']) assert.ok(motivo(nome), nome);
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

// 10/11/2026, o dono: "pq enviou tenis masculino?" (Tênis Masculino Olympikus Proof 3). Masculino fica de fora do Fitness.
test('fitness: masculino fica de fora; feminino e unissex passam', () => {
  for (const nome of ['Kit 3 Bermudas Dry Fit Masculina Treino', 'Camiseta Dry Fit Masculina Kit 5', 'Tênis Olympikus Corre 3 Masculino', 'Tênis Masculino Esportivo Leve Para Corrida', 'Tênis Masculino Olympikus Proof 3 Original']) {
    assert.equal(motivo(nome), 'palavra bloqueada', nome);
  }
  for (const nome of ['Tênis Olympikus Corre 3 Feminino', 'Tênis Unissex Masculino e Feminino Nike Revolution']) assert.equal(motivo(nome), null, nome);
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

// 06/11/2026, o dono: "não é possível que não tinha promoção melhor: Loop De Banda Respirável Com Alça - Fitbit".
test('fitness: pulseira de relógio com outro nome (loop, banda, alça, strap) fica de fora; o relógio não', () => {
  for (const nome of ['Loop De Banda Respirável Com Alça Para Fitbit Charge 6', 'Strap Nylon Esportivo Apple Watch 41mm', 'Alça Loop Magnética Para Garmin Forerunner', 'Bumper Protetor Galaxy Watch 6 44mm']) {
    assert.equal(motivo(nome), 'palavra bloqueada', nome);
  }
  for (const nome of ['Smartwatch Fitbit Charge 6 Preto', 'Relógio Garmin Forerunner 265 GPS', 'Kit Faixa Elástica Mini Band 5 Intensidades']) assert.equal(motivo(nome, { precoAtual: 899 }), null, nome);
});

test('casaTermo: "re:" é expressão sobre o nome normalizado; expressão inválida não casa nem quebra', () => {
  assert.equal(casaTermo(normalizar('Fonte Turbo 20W'), 're:\\bfonte\\b(?! de proteina)'), true);
  assert.equal(casaTermo(normalizar('Whey Fonte de Proteína'), 're:\\bfonte\\b(?! de proteina)'), false);
  assert.equal(casaTermo('qualquer coisa', 're:(['), false);
});

// 06/11/2026, o dono: "caiu fonte de carregador de celular no grupo fitness, tá certo isso?". "Carregador" já era
// bloqueado; o anúncio que diz "Fonte" e cita o relógio (Apple Watch, Galaxy Watch, Mi Band: palavra do nicho e marca) passava.
test('fitness: fonte, carregador, cabo e power bank de celular ficam de fora; "fonte de proteína" não', () => {
  for (const nome of [
    'Fonte Turbo 20W USB-C Original Para iPhone iPad AirPods Apple Watch',
    'Fonte Carregador Turbo 25W Samsung Galaxy Watch',
    'Fonte Xiaomi 33W Para Mi Band',
    'Kit 2 Carregadores Turbo Galaxy Watch Galaxy Buds',
    'Adaptador De Energia USB-C 20W Para iPhone e Apple Watch',
    'Power Bank Magnético 10000mAh Para iPhone e Apple Watch',
    'Cabo USB-C Magnético Para Apple Watch 1m',
    'Cabo Magnético Para Smartwatch Amazfit Bip',
    'Base De Carregamento Magnética Para Smartwatch Amazfit',
  ]) {
    assert.equal(motivo(nome), 'palavra bloqueada', nome);
  }
  for (const nome of [
    'Whey Protein Concentrado 900g Growth Supplements Fonte De Proteína',
    'Pasta De Amendoim Dr. Peanut 600g Alta Fonte De Proteínas',
    'Barra De Proteína Bold 60g Fonte De Fibras',
    'Maltodextrina 1kg Fonte De Energia',
    'Iogurte YoPRO 160g Rica Fonte De Proteína',
    'Whey Protein 3W 900g Max Titanium Excelente Fonte Proteica',
    'Creatina Monohidratada 300g Growth Supplements Fonte',
    'Fone De Ouvido Esportivo Bluetooth Jbl Endurance',
  ]) {
    assert.equal(motivo(nome), null, nome);
  }
  // Nos outros grupos também: carregador, fonte e adaptador de tomada, cabo USB e power bank nunca são do tema.
  const beleza = semFiltroDeMarca(loadGrupos().find((g) => g.nome === 'Beleza'));
  for (const w of ['carregador+celular', 'fonte+usb', 'adaptador+tomada', 'cabo+usb', 'power bank']) assert.ok(beleza.filtros.palavrasBloqueadas.includes(w), w);
});

test('relógio de marca barato demais é réplica ou acessório que cita a marca; o de verdade passa', async () => {
  const { motivoPrecoDaMarca } = await import('../src/marcas.js');
  assert.match(motivoPrecoDaMarca({ nome: 'Relógio Smartwatch Série 9 Tipo Apple Watch 45mm', precoAtual: 89.9 }) || '', /Apple Watch/);
  assert.match(motivoPrecoDaMarca({ nome: 'Smartwatch Galaxy Watch 6 Classic 47mm', precoAtual: 79 }) || '', /Galaxy Watch/);
  assert.match(motivoPrecoDaMarca({ nome: 'Carregador Para Garmin Forerunner', precoAtual: 29 }) || '', /Garmin/);
  for (const [nome, preco] of [['Apple Watch SE GPS 40mm Caixa Meia-noite de Alumínio', 1599], ['Xiaomi Smart Band 9 Active Preto', 119], ['Monitor Cardíaco Garmin HRM-Dual', 449], ['Relógio Inteligente Amazfit Bip 5', 399]]) {
    assert.equal(motivoPrecoDaMarca({ nome, precoAtual: preco }), null, nome);
  }
});

// 06/11/2026, o dono: "whey, creatina, tênis, yopro, monster, coca zero, barrinha, essas coisas tem que ser prioridade".
test('fitness: Monster, Coca Zero e Pepsi Black entram (só zero/energético); Coca normal não', async () => {
  const { marcaDoProduto } = await import('../src/marcas.js');
  for (const [nome, marca] of [['Energético Monster Energy Ultra Lata 473ml Pack 6', 'Monster'], ['Refrigerante Coca-Cola Sem Açúcar Lata 350ml 12 Unidades', 'Coca-Cola Zero'], ['Coca Cola Zero 2L', 'Coca-Cola Zero'], ['Refrigerante Zero Pepsi Black Lata 350ml Pack com 12 unidades', 'Pepsi Black']]) {
    assert.equal(marcaDoProduto({ nome }), marca, nome);
    assert.equal(motivo(nome), null, nome);
  }
  assert.equal(marcaDoProduto({ nome: 'Refrigerante Coca-Cola Original Lata 350ml' }), null);
  assert.equal(marcaDoProduto({ nome: 'Boneca Monster High Draculaura' }), null);
});
