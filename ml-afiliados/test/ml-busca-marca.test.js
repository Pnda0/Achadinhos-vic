import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarPorMarcaML } from '../src/ml/api.js';
import { motivoVendas } from '../src/ml/vendas.js';
import { loadGrupos } from '../src/config.js';
import { motivoPeloNome } from '../src/pipeline.js';
import { BUSCAS_MARCA_POR_COLETA, coletar } from '../src/pipeline.js';
import { Store } from '../src/store.js';

// 04/11/2026, o dono: "não é possível que não tenha nada dessas marcas no Mercado Livre".
test('busca por marca no ML: só o anúncio da loja oficial; vale pela regra de vendas', async () => {
  const api = {
    get: async (url) =>
      url.startsWith('/products/search')
        ? { results: [{ id: 'P1', name: 'Creatina Monohidratada 250g Growth Supplements', domain_id: 'MLB-SUPPLEMENTS' }, { id: 'P2', name: 'Creatina Growth 500g', domain_id: 'MLB-SUPPLEMENTS' }] }
        : url.startsWith('/products/P1/')
          ? { results: [{ item_id: 'MLB111', price: 59.9, original_price: 89.9, condition: 'new', official_store_id: 77, shipping: {} }, { item_id: 'MLB112', price: 49.9, original_price: 89.9, condition: 'new', shipping: {} }] }
          : { results: [{ item_id: 'MLB222', price: 99, original_price: 129, condition: 'new', shipping: {} }] },
    produto: async (id) => ({ nome: id === 'P1' ? 'Creatina Monohidratada 250g Growth Supplements' : 'Creatina Growth 500g', imagem: 'https://x/y.jpg' }),
    salvarCache() {},
  };
  const lista = await buscarPorMarcaML({ grupo: 'Fitness', nome: 'ML marca: creatina growth', buscaML: 'creatina growth' }, { api });
  assert.deepEqual(lista.map((p) => [p.id, p.precoAtual, p.descontoPct, p.lojaOficialML, p.grupo]), [['MLB111', 59.9, 33, true, 'Fitness']], 'o P2 não tem loja oficial');
  assert.equal(motivoVendas(lista[0]), null);
  assert.equal(motivoVendas({ ...lista[0], lojaOficialML: false }), 'sem dado de vendas');
});

test(`coleta: as buscas por marca revezam, ${BUSCAS_MARCA_POR_COLETA} por vez`, async () => {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-marca-')), 'db.json'));
  const cats = Array.from({ length: BUSCAS_MARCA_POR_COLETA + 3 }, (_, i) => ({ grupo: 'Fitness', nome: `ML marca: b${i}`, buscaML: `b${i}`, ativo: true }));
  const feitas = [];
  const grupos = [{ nome: 'Fitness', ativo: true, jid: 'x', filtros: {} }];
  const opcoes = { categoriasML: cats, grupos, buscaMarcaML: async (cat) => (feitas.push(cat.buscaML), []), raspar: async () => [], esperar: async () => {}, mlMinIntervaloH: 999 };
  await coletar(store, opcoes);
  await coletar(store, opcoes);
  assert.equal(feitas.length, 2 * BUSCAS_MARCA_POR_COLETA);
  assert.deepEqual(feitas.slice(BUSCAS_MARCA_POR_COLETA, BUSCAS_MARCA_POR_COLETA + 4), ['b8', 'b9', 'b10', 'b0']);
});

// 04/11/2026, o dono: "que merda é essa de post de carro" — "top track field" trouxe o adesivo da Parati Track & Field.
test("busca por marca no ML: só os tipos de produto do grupo; carro, livro e videogame ficam de fora", async () => {
  const pedidos = [];
  const api = {
    get: async (url) => {
      pedidos.push(url);
      return url.startsWith("/products/search")
        ? {
            results: [
              { id: "C1", name: "Kit Faixa Adesivo Parati Track & Field Modelo Prata", domain_id: "MLB-STICKERS" },
              { id: "C2", name: "Faixa Trac Porta Tras Dir Parati Track & Field Vw", domain_id: "MLB-VEHICLE_EMBLEMS" },
              { id: "C3", name: "International Track & Field 2000 Nintendo 64", domain_id: "MLB-VIDEO_GAMES" },
              { id: "C4", name: "Top Track & Field Feminino Thermodry", domain_id: "MLB-SPORT_BRAS" },
              { id: "C5", name: "Top Track & Field sem tipo" },
            ],
          }
        : { results: [{ item_id: "MLB9", price: 79.9, original_price: 119.9, condition: "new", official_store_id: 5, shipping: {} }] };
    },
    produto: async () => ({ nome: "Top Track & Field Feminino Thermodry", imagem: "https://x/y.jpg" }),
    salvarCache() {},
  };
  const lista = await buscarPorMarcaML({ grupo: "Fitness", nome: "ML marca: top track field", buscaML: "top track field" }, { api });
  assert.deepEqual(lista.map((p) => p.produtoML), ["C4"], "só o top (sutiã esportivo)");
  assert.ok(!pedidos.some((u) => /C1|C2|C3|C5/.test(u)), "nem consulta os anúncios do que não é do tipo certo");
  assert.deepEqual(await buscarPorMarcaML({ grupo: "Beleza", nome: "x", buscaML: "x" }, { api }), [], "grupo sem lista de tipos: não busca");
});

test("carro e moto bloqueados nos grupos (vale também para o que já estava na fila)", () => {
  for (const g of loadGrupos().filter((g) => g.nome !== "Geral")) {
    // O adesivo passava no nicho pela marca (Track & Field): agora cai na palavra bloqueada.
    const adesivo = motivoPeloNome({ nome: "Kit Faixa Adesivo Parati Track & Field Modelo Prata" }, g.filtros);
    // (Track&Field saiu da lista em 05/11/2026, a pedido do dono: o adesivo nem passa mais no nicho.)
    if (g.nome === "Fitness") assert.ok(["palavra bloqueada", "fora do nicho"].includes(adesivo), adesivo);
    else assert.ok(adesivo, g.nome);
    for (const nome of ["Aromatizante para Carro Lavanda Natura", "Capacete Moto Feminino Rosa Nike", "Kit Amortecedor Dianteiro Gol Lupo"]) {
      assert.ok(motivoPeloNome({ nome }, g.filtros), g.nome + ": " + nome);
    }
  }
});

// Na mesma revisão (o dono: "seja criterioso"), estes estavam na fila: estampa "xadrez Vichy" (não é a marca),
// produto de limpeza da "Natura Clean" (não é a Natura dos cosméticos) e roupa de time no Fitness.
test("revisão da fila: xadrez Vichy, Natura Clean e time de futebol ficam de fora; os de verdade continuam", () => {
  const g = Object.fromEntries(loadGrupos().map((x) => [x.nome, x.filtros]));
  for (const nome of ["Papel de Parede Adesivo Xadrez Vichy Aquarela Ternura Várias Cores", "Conjunto Calça e Body Manga Longa Xadrez Vichy Rosa", "Querosene Gel Sabão Perfumado Natura Clean 2 Litros Remove Gorduras", "Kit 2 Querosene Perfumado Chá Branco Premium 1l Natura Clean Limpeza Profunda"]) {
    assert.ok(motivoPeloNome({ nome }, g.Beleza), nome);
  }
  for (const nome of ["Manto Flamengo Masculina Jogo 3 Adidas 2026", "Shorts CR Flamengo Originals adidas Performance Branco", "Camisa Corinthians I 2026 Nike Feminina"]) {
    assert.ok(motivoPeloNome({ nome }, g.Fitness), nome);
  }
  assert.equal(motivoPeloNome({ nome: "Sérum Facial Hidratante com Ácido Hialurônico e Minerais 89 50mL Vichy" }, g.Beleza), null, "Vichy de verdade");
  assert.equal(motivoPeloNome({ nome: "Sabonete em barra Tododia Natura caixa com 5 un de 90g cada" }, g.Beleza), null, "Natura de verdade");
  assert.equal(motivoPeloNome({ nome: "Gel de Limpeza Facial La Roche-Posay Effaclar 300g" }, g.Beleza), null, "gel de limpeza facial continua");
  assert.equal(motivoPeloNome({ nome: "Top Nike One Feminino" }, g.Fitness), null);
});

// 05/11/2026, o dono: "primeiro vê se tem deles [as marcas grandes], procure eles, se não houver vai descendo".
test('busca por marca no ML: as grandes primeiro; as menores só quando as grandes trazem pouco, na ordem do dono', async () => {
  const cats = ['tenis asics feminino', 'whey protein growth supplements', 'creatina new millen', 'max titanium whey', 'yopro', 'integralmedica whey'].map((b) => ({ grupo: 'Fitness', nome: `ML marca: ${b}`, buscaML: b, ativo: true }));
  const grupos = [{ nome: 'Fitness', ativo: true, jid: 'x', filtros: {} }];
  const rodar = async (achaNasGrandes) => {
    const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-grandes-')), 'db.json'));
    const feitas = [];
    const buscaMarcaML = async (cat) => {
      feitas.push(cat.buscaML);
      if (!achaNasGrandes || /asics|millen|yopro/.test(cat.buscaML)) return [];
      return Array.from({ length: 2 }, (_, i) => ({ id: `MLB${cat.buscaML.length}${i}`, grupo: 'Fitness', nome: `Whey ${cat.buscaML} ${i}`, url: `https://x/${cat.buscaML}${i}`, precoAtual: 100, descontoPct: 30, vendidos: '+1000 vendidos', nota: 4.8, imagem: 'i', loja: 'ml' }));
    };
    await coletar(store, { categoriasML: cats, grupos, buscaMarcaML, raspar: async () => [], esperar: async () => {}, mlMinIntervaloH: 999 });
    return feitas;
  };
  assert.deepEqual(await rodar(true), ['whey protein growth supplements', 'max titanium whey', 'integralmedica whey']);
  assert.deepEqual(await rodar(false), ['whey protein growth supplements', 'max titanium whey', 'integralmedica whey', 'yopro', 'tenis asics feminino', 'creatina new millen']);
});
