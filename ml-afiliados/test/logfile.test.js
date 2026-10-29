import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pedirParaReligar } from '../src/logfile.js';

test('queda do bot: pede para religar, mas não entra em ciclo de quedas seguidas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quedas-'));
  const caiu = path.join(dir, '.caiu');
  let t = Date.parse('2026-10-28T23:18:08Z');
  for (let i = 1; i <= 3; i++) {
    assert.equal(pedirParaReligar({ dir, agora: t }), true, `queda ${i}`);
    assert.ok(fs.existsSync(caiu));
    fs.unlinkSync(caiu); // o 3-iniciar.bat apaga ao ver
    t += 2 * 60_000;
  }
  // 4ª queda em poucos minutos: religar não resolve, a janela fica parada mostrando o erro.
  assert.equal(pedirParaReligar({ dir, agora: t }), false);
  assert.equal(fs.existsSync(caiu), false);
  // Muito tempo depois (ex.: 30 min esperando a internet a cada tentativa), volta a religar.
  assert.equal(pedirParaReligar({ dir, agora: t + 31 * 60_000 }), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
