#!/usr/bin/env bash
# Instala o bot num servidor Linux novo (Ubuntu 22.04/24.04 ou Debian 12, 64 bits). Rode como root:
#   curl -fsSL https://raw.githubusercontent.com/Pnda0/Achadinhos-vic/main/ml-afiliados/linux/instalar.sh | bash
# Instala Node 22, Google Chrome (para o WhatsApp Web), o bot em /opt/achadinhos e o serviço que liga sozinho.
# NÃO liga o bot: antes, copie o .env e a pasta data/ do PC de casa (README, seção 3.16) e DESLIGUE o bot de casa —
# os dois ligados ao mesmo tempo postariam cada oferta duas vezes.
set -euo pipefail

PASTA=/opt/achadinhos
REPO=https://github.com/Pnda0/Achadinhos-vic.git

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i)."; exit 1; }

echo "== Pacotes básicos e fuso de Brasília"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates fonts-liberation fonts-noto-color-emoji >/dev/null
timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true

echo "== Node.js 22"
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "== Google Chrome (o navegador do WhatsApp Web)"
if ! command -v google-chrome-stable >/dev/null; then
  if [ "$(dpkg --print-architecture)" = amd64 ]; then
    curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    apt-get install -y -qq /tmp/chrome.deb >/dev/null
    rm -f /tmp/chrome.deb
  else
    # ARM: não há Chrome do Google; o Chromium do Debian serve (no Ubuntu ele vem como snap, que não funciona em serviço).
    apt-get install -y -qq chromium >/dev/null || { echo "Instale um Chromium que não seja snap e ponha o caminho em CHROME_PATH no .env."; }
  fi
fi

echo "== Memória de reserva (swap de 2 GB, se não houver)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Usuário 'bot' e o código em $PASTA"
id bot >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash bot
if [ ! -d "$PASTA/.git" ]; then git clone --quiet "$REPO" "$PASTA"; fi
chown -R bot:bot "$PASTA"
chmod +x "$PASTA/ml-afiliados/linux/"*.sh
sudo -u bot bash -c "cd $PASTA/ml-afiliados && PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund --silent && git rev-parse HEAD > node_modules/.instalado-em"

echo "== Serviço (liga com o servidor, religa se cair)"
cp "$PASTA/ml-afiliados/linux/ml-afiliados.service" /etc/systemd/system/ml-afiliados.service
systemctl daemon-reload
systemctl enable ml-afiliados >/dev/null

cat <<FIM

Pronto. Falta:
  1. Copiar do PC de casa o .env e a pasta data/ para $PASTA/ml-afiliados/ (README, seção 3.16)
     e rodar: chown -R bot:bot $PASTA
  2. No .env do servidor: WHATSAPP_NUMERO=55DDDNUMERO do chip do bot (conecta por código no Telegram)
     e CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (para o painel).
  3. DESLIGAR o bot do PC de casa (fechar a janela e tirar o atalho da pasta Inicializar).
  4. Ligar:            systemctl start ml-afiliados
     Ver o que faz:    journalctl -u ml-afiliados -f
     Reiniciar:        systemctl restart ml-afiliados
FIM
