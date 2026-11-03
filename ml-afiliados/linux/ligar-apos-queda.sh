#!/usr/bin/env bash
# Faz o servidor ligar sozinho quando a energia volta depois de uma queda — o mesmo que "After Power Loss -> Power On"
# no BIOS, mas pelo Linux (sem precisar de teclado e monitor no servidor). Rode como root:
#   bash /opt/achadinhos/ml-afiliados/linux/ligar-apos-queda.sh
#
# Como funciona (HP 260 G1 DM, chipset Intel série 8 "Lynx Point"): o bit 0 (AFTERG3_EN) do registro GEN_PMCON_3, no
# endereço 0xA4 da ponte LPC (00:1f.0), diz o que o computador faz quando a luz volta: 0 = liga, 1 = fica desligado.
# Em 03/11/2026 ele estava em 1 (desligado). O BIOS regrava esse bit a cada partida com o que está no setup dele,
# então um serviço do systemd põe 0 de novo toda vez que o Linux liga. Para desfazer:
#   systemctl disable --now ligar-apos-queda && rm /etc/systemd/system/ligar-apos-queda.service && setpci -s 00:1f.0 0xa4.b=1:1
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo)."; exit 1; }
LPC=00:1f.0
DEV=/sys/bus/pci/devices/0000:$LPC
# Só nos chipsets Intel em que esse registro fica nesse endereço (série 8/9: 8c4x-8c5x, 9c4x, 9ccx). Nos mais novos ele
# mudou de lugar e escrever ali mexeria em outra coisa: nesses, só pelo BIOS.
[ "$(cat "$DEV/vendor" 2>/dev/null)" = 0x8086 ] && grep -qE '^0x(8c4|8c5|9c4|9cc)' "$DEV/device" 2>/dev/null || {
  echo "Este chipset não é o esperado: ajuste no BIOS (After Power Loss -> Power On)."
  exit 1
}
SETPCI="$(command -v setpci)"

cat > /etc/systemd/system/ligar-apos-queda.service <<FIM
# Gerado por ligar-apos-queda.sh: o servidor liga sozinho quando a energia volta (AFTERG3_EN = 0).
[Unit]
Description=Ligar sozinho quando a energia voltar
[Service]
Type=oneshot
ExecStart=$SETPCI -s $LPC 0xa4.b=0:1
[Install]
WantedBy=multi-user.target
FIM
systemctl daemon-reload
systemctl enable --now ligar-apos-queda.service >/dev/null
V=$((0x$(setpci -s $LPC 0xa4.b) & 1))
[ "$V" = 0 ] && echo "Pronto: quando a energia voltar depois de uma queda, o servidor liga sozinho." || { echo "Não mudou (bit = $V): ajuste no BIOS."; exit 1; }
