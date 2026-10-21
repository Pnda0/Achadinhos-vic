#!/usr/bin/env bash
# Liga o bot no servidor Linux (chamado pelo serviço ml-afiliados.service) — o mesmo papel do 3-iniciar.bat:
# atualiza pelo GitHub, reinstala as bibliotecas se o código mudou e liga o bot. Quando o bot sai (reinício pedido
# com "npm run reiniciar", queda, erro), o systemd chama este script de novo depois de alguns segundos.
set -u
cd "$(dirname "$0")/.."

echo "Atualizando o bot pelo GitHub..."
git pull --ff-only --quiet || echo "Não consegui atualizar — seguindo com a versão que já está aqui."

# Reinstala só se o código mudou desde a última instalação que deu certo.
atual="$(git rev-parse HEAD 2>/dev/null || echo sem-git)"
instalado="$(cat node_modules/.instalado-em 2>/dev/null || echo nada)"
if [ "$atual" != "$instalado" ]; then
  echo "Instalando o que mudou..."
  if PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund --silent; then
    echo "$atual" > node_modules/.instalado-em
  else
    echo "Falha no npm install — veja acima."
  fi
fi

rm -f data/.reiniciar # o systemd já religa sozinho; o aviso só serve para o .bat do Windows
exec node src/index.js
