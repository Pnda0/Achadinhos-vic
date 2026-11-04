import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finalDoValor, gravarNoEnv, lerAtribuicao, nomesDoEnv } from '../src/env-arquivo.js';

test('/env: lê "NOME=valor" e "NOME valor"; troca a linha certa e acrescenta a nova sem mexer no resto', () => {
  assert.deepEqual(lerAtribuicao('AWIN_API_TOKEN=abc-123'), { nome: 'AWIN_API_TOKEN', valor: 'abc-123' });
  assert.deepEqual(lerAtribuicao('AWIN_API_TOKEN  "abc 123"'), { nome: 'AWIN_API_TOKEN', valor: 'abc 123' });
  assert.deepEqual(lerAtribuicao('CHAVE=a=b'), { nome: 'CHAVE', valor: 'a=b' });
  assert.equal(lerAtribuicao('AWIN_API_TOKEN='), null);
  assert.equal(lerAtribuicao('1NOME=x'), null);
  assert.equal(lerAtribuicao('só texto'), null);

  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mla-env-')), '.env');
  fs.writeFileSync(arq, '# comentário\r\nSENDER=telegram\r\nAWIN_API_TOKEN=velho\r\nAWIN_API_TOKEN_X=fica\r\n');
  assert.equal(gravarNoEnv('AWIN_API_TOKEN', 'novo', arq), 'trocado');
  assert.equal(gravarNoEnv('SHOPEE_APP_ID', '123', arq), 'novo');
  assert.equal(fs.readFileSync(arq, 'utf8'), '# comentário\r\nSENDER=telegram\r\nAWIN_API_TOKEN=novo\r\nAWIN_API_TOKEN_X=fica\r\nSHOPEE_APP_ID=123\r\n');
  assert.deepEqual(nomesDoEnv(arq), ['SENDER', 'AWIN_API_TOKEN', 'AWIN_API_TOKEN_X', 'SHOPEE_APP_ID']);
  assert.equal(finalDoValor('abcdefghijkl'), '…ijkl');
  assert.equal(finalDoValor('curto'), '(curto)');
});
