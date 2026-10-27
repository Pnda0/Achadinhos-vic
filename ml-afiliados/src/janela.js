/**
 * Desliga a "Edição rápida" da janela preta do bot (Windows). Com ela ligada, um clique dentro da janela começa uma
 * seleção e o Windows segura tudo o que o bot escreve na tela até alguém apertar uma tecla: o bot inteiro congela.
 * Provável causa do bot parado das 8h02 às 10h39 de 27/10/2026 (sem postar e sem atender ao pedido de reinício).
 * O PowerShell filho usa a mesma janela, então muda o modo dela. Sem janela (serviço, testes), não faz nada.
 */
import { spawn } from 'node:child_process';

const ENABLE_QUICK_EDIT_MODE = 0x40;
const ENABLE_EXTENDED_FLAGS = 0x80; // sem ela o Windows ignora a mudança da edição rápida

export const SCRIPT_EDICAO_RAPIDA = [
  "$k = Add-Type -Name Console -Namespace MlAfiliados -PassThru -MemberDefinition '",
  '[DllImport("kernel32.dll")] public static extern System.IntPtr GetStdHandle(int h);',
  '[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(System.IntPtr h, out int m);',
  '[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(System.IntPtr h, int m);',
  "';",
  '$h = $k::GetStdHandle(-10); $m = 0;',
  `if ($k::GetConsoleMode($h, [ref]$m)) { [void]$k::SetConsoleMode($h, ($m -band (-bnot ${ENABLE_QUICK_EDIT_MODE})) -bor ${ENABLE_EXTENDED_FLAGS}) }`,
].join('\n');

export function desligarEdicaoRapida({ plataforma = process.platform, janela = process.stdin.isTTY, executar = spawn } = {}) {
  if (plataforma !== 'win32' || !janela) return false;
  const codificado = Buffer.from(SCRIPT_EDICAO_RAPIDA, 'utf16le').toString('base64');
  executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificado], { stdio: ['inherit', 'ignore', 'ignore'] }).on('error', () => {});
  return true;
}
