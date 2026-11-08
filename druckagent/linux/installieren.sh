#!/usr/bin/env bash
# lugru-druckagent auf Linux (z. B. Mini-PC) als systemd-Dienst einrichten. Aufruf: sudo bash installieren.sh
set -euo pipefail
ZIEL=/opt/lugru-druckagent
QUELLE="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null || { echo "Node.js fehlt: sudo apt install -y nodejs (Version ≥ 18)"; exit 1; }
id lugru-druckagent >/dev/null 2>&1 || useradd --system --no-create-home --groups lp lugru-druckagent
mkdir -p "$ZIEL"
cp "$QUELLE/../lugru-druckagent.mjs" "$ZIEL/"
if [ ! -f "$ZIEL/config.json" ] || [ "${1:-}" = "--neu" ]; then
  read -rp "Adresse des Seller-Systems (z. B. https://seller.example.com): " SERVER
  read -rp "Gerätetoken (beginnt mit da_): " TOKEN
  printf '{\n  "server": "%s",\n  "token": "%s",\n  "drucker": [],\n  "leerlaufAusMin": 10,\n  "ordner": null,\n  "medien": []\n}\n' "${SERVER%/}" "$TOKEN" > "$ZIEL/config.json"
fi
chown -R lugru-druckagent:lp "$ZIEL"
chmod 600 "$ZIEL/config.json"
cp "$QUELLE/lugru-druckagent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lugru-druckagent
sudo -u lugru-druckagent node "$ZIEL/lugru-druckagent.mjs" --drucker || true
echo "Fertig – Status: systemctl status lugru-druckagent"
