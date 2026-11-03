#!/usr/bin/env bash
# Liga a vigia do bot (src/vigia.js): a cada 2 min confere se o bot travou (reinicia sozinho) e atende o /ligar do
# dono no Telegram quando o bot está parado. O instalar.sh já chama; num servidor já instalado, rode como root:
#   bash /opt/achadinhos/ml-afiliados/linux/ligar-vigia.sh
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo)."; exit 1; }
LINUX="$(cd "$(dirname "$0")" && pwd)"

# A vigia roda como o usuário bot: ela só pode ligar e reiniciar o serviço do bot (nada mais) sem senha.
SC="$(command -v systemctl)"
ARQ=/etc/sudoers.d/achadinhos-vigia
cat > "$ARQ" <<FIM
# Gerado por ligar-vigia.sh: a vigia (usuário bot) liga e reinicia o bot sem senha (só isso).
bot ALL=(root) NOPASSWD: $SC start ml-afiliados, $SC restart ml-afiliados
FIM
chmod 440 "$ARQ"
visudo -cf "$ARQ" >/dev/null || { rm -f "$ARQ"; echo "Deu erro na regra do sudo — a vigia não foi ligada."; exit 1; }

cp "$LINUX/ml-afiliados-vigia.service" "$LINUX/ml-afiliados-vigia.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ml-afiliados-vigia.timer >/dev/null
echo "Vigia ligada: a cada 2 min (systemctl list-timers ml-afiliados-vigia.timer; log: journalctl -u ml-afiliados-vigia)."
