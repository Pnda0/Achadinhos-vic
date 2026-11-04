import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrupos } from '../src/config.js';
import { generoDoProduto } from '../src/genero.js';
import { casaTermo, normalizar } from '../src/util.js';

// 04/11/2026, o dono: "por que você tá mandando chuteira e bola de futebol? esqueceu que o grupo é feminino".
test('Fitness: chuteira, bola de futebol e camisa de time ficam de fora (mesmo de marca da lista); pilates e legging não', () => {
  const fitness = loadGrupos().find((g) => g.nome === 'Fitness');
  const bloqueado = (nome) => fitness.filtros.palavrasBloqueadas.some((w) => casaTermo(normalizar(nome), w));
  for (const nome of ['Chuteira Society Nike Phantom GX', 'Chuteiras Adidas Predator Campo', 'Bola de Futebol Adidas Al Rihla', 'Bola Futsal Penalty', 'Caneleira Nike Mercurial', 'Luva de Goleiro Puma', 'Camisa do Time Flamengo Adidas', 'Bola de Basquete Spalding', 'Óculos de Natação Profissional Decathlon Nabaiji', 'Touca de Natação Speedo', 'Nadadeira Mormaii', 'Kit Snorkel Mergulho'])
    assert.ok(bloqueado(nome), nome);
  for (const nome of ['Legging Fitness Lupo Cintura Alta', 'Tênis Nike Revolution 7 Feminino', 'Top Esportivo Adidas'])
    assert.ok(!bloqueado(nome), nome);
  assert.equal(generoDoProduto({ nome: 'Chuteira Nike Phantom' }), 'm');
  assert.equal(generoDoProduto({ nome: 'Chuteira Feminina Nike' }), 'f');
});
