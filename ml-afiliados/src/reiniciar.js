#!/usr/bin/env node
/**
 * npm run reiniciar — reinicia o bot deste PC com calma (o dono deixou o Claude reiniciar quando precisar, 16/10/2026).
 *  - Bot rodando: pede pela porta da trava; ele termina o envio/coleta em andamento, grava a fila e sai, e o
 *    3-iniciar.bat (Windows) ou o systemd (Linux, linux/ml-afiliados.service) liga de novo, com git pull.
 *  - Nenhum bot rodando: abre o 3-iniciar.bat numa janela nova.
 */
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';
import { botRodando, pedirParada } from './instancia.js';
import { log, sleep } from './util.js';

const abrirJanela = () =>
  spawn('cmd.exe', ['/c', 'start "ml-afiliados" "3-iniciar.bat"'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();

if (!(await botRodando())) {
  if (process.platform === 'win32') {
    log('Nenhum bot rodando neste PC: abrindo o 3-iniciar.bat numa janela nova.');
    abrirJanela();
  } else {
    log('Nenhum bot rodando neste servidor. Ligue com: sudo systemctl start ml-afiliados');
    process.exitCode = 1;
  }
} else if (!(await pedirParada())) {
  log('O bot está rodando, mas é de uma versão sem o reinício com calma. Feche a janela dele e abra o 3-iniciar.bat.');
  process.exitCode = 1;
} else {
  log('Pedido enviado: o bot termina o que estiver fazendo e liga de novo na mesma janela.');
  let saiu = false;
  for (let i = 0; i < 120 && !saiu; i++) {
    await sleep(1000);
    saiu = !(await botRodando({ timeoutMs: 800 }));
  }
  log(saiu ? 'O bot parou; o 3-iniciar.bat já está ligando a versão nova.' : 'O bot ainda não parou (pode estar no meio de uma busca). Ele para sozinho assim que terminar.');
}
