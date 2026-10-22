#!/usr/bin/env bash
# Recebe o arquivo do "npm run migrar" (PC de casa) e liga o bot no servidor. Rode como root, DEPOIS do instalar.sh:
#   bash /opt/achadinhos/ml-afiliados/linux/receber.sh /caminho/achadinhos-migracao-AAAA-MM-DD.tar.gz
# Põe no lugar o .env, a pasta data/ (fila, histórico, preços, analytics, cookies do ML) e o login do Cloudflare
# (painel), e liga o serviço. O WhatsApp conecta de novo: o código chega no Telegram do dono.
set -euo pipefail

ARQ="${1:?Informe o arquivo .tar.gz gerado no PC de casa (npm run migrar)}"
PASTA=/opt/achadinhos/ml-afiliados

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i)."; exit 1; }
[ -d "$PASTA" ] || { echo "Rode primeiro o instalar.sh."; exit 1; }
[ -f "$ARQ" ] || { echo "Não achei o arquivo $ARQ"; exit 1; }

systemctl stop ml-afiliados 2>/dev/null || true
TMP="$(mktemp -d)"
tar -xzf "$ARQ" -C "$TMP"

cp "$TMP/ml-afiliados/.env" "$PASTA/.env"
sed -i 's/\r$//' "$PASTA/.env" # fim de linha do Windows
chmod 600 "$PASTA/.env"
mkdir -p "$PASTA/data"
cp -a "$TMP/ml-afiliados/data/." "$PASTA/data/"
rm -f "$PASTA/data/.reiniciar"

if [ -f "$TMP/wrangler/default.toml" ]; then
  mkdir -p /home/bot/.config/.wrangler/config
  cp "$TMP/wrangler/default.toml" /home/bot/.config/.wrangler/config/default.toml
  chmod 600 /home/bot/.config/.wrangler/config/default.toml
  chown -R bot:bot /home/bot/.config
  echo "Login do Cloudflare (painel) copiado."
fi
rm -rf "$TMP"

chown -R bot:bot /opt/achadinhos
systemctl start ml-afiliados

cat <<FIM

Bot ligado no servidor.
  - Em ~1 minuto chega no seu Telegram o código para conectar o WhatsApp do bot
    (celular do chip > WhatsApp > Aparelhos conectados > Conectar com número de telefone).
  - Acompanhar:  journalctl -u ml-afiliados -f
  - Apague o arquivo da mudança (tem senhas):  rm "$ARQ"
FIM
