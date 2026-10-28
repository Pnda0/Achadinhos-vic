#!/usr/bin/env bash
# Deixa o seu usuário (o do SSH) cuidar do bot sem digitar senha: ligar, parar, reiniciar e ver o log do serviço.
# Assim o Claude, no PC de casa, faz pelo "ssh achadinhos ..." o que fazia aqui com "npm run reiniciar".
# Rode logado com o seu usuário:  sudo bash /opt/achadinhos/ml-afiliados/linux/liberar-claude.sh
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }
U="${1:-${SUDO_USER:-}}"
if [ -z "$U" ] || [ "$U" = root ]; then
  echo "Rode com sudo a partir do seu usuário (ou diga qual: liberar-claude.sh fulano)."
  exit 1
fi
id "$U" >/dev/null 2>&1 || { echo "Não existe o usuário $U."; exit 1; }

SC="$(command -v systemctl)"
ARQ=/etc/sudoers.d/achadinhos
cat > "$ARQ" <<FIM
# Gerado por liberar-claude.sh: $U pode ligar, parar e reiniciar o bot sem senha (só isso).
$U ALL=(root) NOPASSWD: $SC start ml-afiliados, $SC stop ml-afiliados, $SC restart ml-afiliados
FIM
chmod 440 "$ARQ"
visudo -cf "$ARQ" >/dev/null || { rm -f "$ARQ"; echo "Deu erro na regra do sudo — nada foi mudado."; exit 1; }

# Ler o log do serviço (journalctl -u ml-afiliados) sem sudo.
usermod -aG systemd-journal "$U"

echo "Pronto: $U pode ligar/parar/reiniciar o bot sem senha e ver o log. Saia do SSH e entre de novo para valer."
