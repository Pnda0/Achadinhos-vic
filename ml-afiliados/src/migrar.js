#!/usr/bin/env node
/**
 * npm run migrar — prepara a mudança do bot do PC de casa para o servidor Linux (pedido do dono, 22/10/2026).
 *  1. desliga o bot daqui com calma e SEM religar (os dois ligados = cada oferta sai duas vezes);
 *  2. tira o bot do início automático do Windows (o atalho vira ".desligado" — dá para voltar renomeando);
 *  3. junta num arquivo só, na pasta Downloads (fora do OneDrive: tem senhas): o .env (já com WHATSAPP_NUMERO),
 *     a pasta data/ (fila, histórico, preços, analytics, cookies do ML) e o login do Cloudflare do wrangler (painel).
 *     Ficam de fora o perfil do navegador e a sessão do WhatsApp: no servidor ele conecta de novo por código.
 * `npm run migrar -- --teste` só monta o arquivo, sem desligar nada.
 * No servidor: linux/instalar.sh e depois linux/receber.sh <arquivo> (README, seção 3.16).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, ROOT } from './config.js';
import { botRodando, pedirParada } from './instancia.js';
import { diaLocal, log, sleep } from './util.js';

const teste = process.argv.includes('--teste');

if (!teste) {
  if (await botRodando()) {
    log('⏹️  Desligando o bot deste PC (sem religar)...');
    if (!(await pedirParada({ religar: false }))) {
      log('O bot está rodando numa versão antiga: feche a janela dele e rode de novo.');
      process.exit(1);
    }
    for (let i = 0; i < 120 && (await botRodando({ timeoutMs: 800 })); i++) await sleep(1000);
    if (await botRodando({ timeoutMs: 800 })) {
      log('O bot ainda não parou (talvez no meio de uma busca). Rode de novo em alguns minutos.');
      process.exit(1);
    }
    log('✅ Bot deste PC desligado.');
  }
  // Início automático do Windows: o atalho da pasta Inicializar vira ".desligado".
  const inicializar = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  for (const f of fs.existsSync(inicializar) ? fs.readdirSync(inicializar) : []) {
    if (!/\.lnk$/i.test(f) || !/achadinhos|ml-afiliados|iniciar/i.test(f)) continue;
    fs.renameSync(path.join(inicializar, f), path.join(inicializar, `${f}.desligado`));
    log(`✅ Tirei do início automático do Windows: ${f} (para voltar, tire o ".desligado" do nome).`);
  }
}

// Monta a pasta da mudança num lugar temporário e compacta.
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'achadinhos-migracao-'));
const destino = path.join(raiz, 'ml-afiliados');
fs.mkdirSync(destino, { recursive: true });

let env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const numero = (() => {
  try {
    return fs.readFileSync(path.join(DATA_DIR, 'whatsapp-numero.txt'), 'utf8').trim();
  } catch {
    return '';
  }
})();
if (numero && !/^WHATSAPP_NUMERO=\d+/m.test(env)) env += `\n# Número do chip do bot: no servidor o WhatsApp conecta por código (chega no Telegram do dono).\nWHATSAPP_NUMERO=${numero}\n`;
fs.writeFileSync(path.join(destino, '.env'), env);

const FORA = /[\\/](perfil-ml|site-configurando)([\\/]|$)|\.lock$|SingletonLock/;
fs.cpSync(DATA_DIR, path.join(destino, 'data'), { recursive: true, filter: (origem) => !FORA.test(origem) });

const wrangler = path.join(process.env.APPDATA || '', 'xdg.config', '.wrangler', 'config', 'default.toml');
const comWrangler = fs.existsSync(wrangler);
if (comWrangler) {
  fs.mkdirSync(path.join(raiz, 'wrangler'), { recursive: true });
  fs.copyFileSync(wrangler, path.join(raiz, 'wrangler', 'default.toml'));
}

const pastaSaida = [path.join(os.homedir(), 'Downloads'), os.homedir()].find((p) => fs.existsSync(p));
const arquivo = path.join(pastaSaida, `achadinhos-migracao-${diaLocal()}${teste ? '-teste' : ''}.tar.gz`);
// O tar do próprio Windows (o do Git Bash confunde "C:" com outro computador).
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
const r = spawnSync(TAR, ['-czf', arquivo, '-C', raiz, 'ml-afiliados', ...(comWrangler ? ['wrangler'] : [])], { stdio: 'inherit' });
fs.rmSync(raiz, { recursive: true, force: true });
if (r.status !== 0) {
  log('❌ Não consegui compactar (tar). Nada foi apagado; veja o erro acima.');
  process.exit(1);
}

const mb = (fs.statSync(arquivo).size / 1e6).toFixed(1);
log(`📦 Pronto: ${arquivo} (${mb} MB)${numero ? ` — WhatsApp do chip ${numero}` : ' — sem o número do WhatsApp (ponha WHATSAPP_NUMERO no .env do servidor)'}${comWrangler ? ', com o login do painel' : ''}.`);
log('   Tem senhas: leve por pendrive ou rede local, e apague depois de usar.');
log('   No servidor (como root): bash instalar.sh  e depois  bash /opt/achadinhos/ml-afiliados/linux/receber.sh <arquivo>');
if (teste) log('   (teste: o bot deste PC continua ligado.)');
