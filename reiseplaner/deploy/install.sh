#!/usr/bin/env bash
# Installiert den Reiseplaner in einem EIGENEN Ordner (/opt/reiseplaner) als eigenes Docker-Projekt.
# Berührt weder /opt/seller-system noch andere Container, Ports 80/443 oder die Firewall.
# Aufruf als root:  bash install.sh <github-repo-url> [branch] [port]
#   z. B.           bash install.sh https://github.com/zqgfdwmdyj-hue/Lugru.git reiseplaner 3030
set -euo pipefail

REPO="${1:?GitHub-Adresse fehlt}"
BRANCH="${2:-main}"
PORT="${3:-3030}"
DIR=/opt/reiseplaner

command -v docker >/dev/null || { echo "Docker fehlt – bitte zuerst installieren."; exit 1; }
docker compose version >/dev/null || { echo "docker compose fehlt."; exit 1; }

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" pull -q --ff-only origin "$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/reiseplaner"

if [ ! -f .env ]; then
  if ss -tln | grep -q ":$PORT "; then
    echo "Port $PORT ist schon belegt – bitte einen freien Port als dritten Parameter angeben."
    exit 1
  fi
  cat > .env <<EOT
BIND_IP=127.0.0.1
REISE_PORT=$PORT
OEFFENTLICHE_URL=
ANTHROPIC_API_KEY=
KI_MODELL=
GYG_API_KEY=
GYG_PARTNER_ID=
REISE_DOMAIN=
EOT
  echo "==> .env angelegt ($DIR/reiseplaner/.env) – Schlüssel und Adresse dort eintragen."
fi
chmod 600 .env

echo "==> Bauen und starten (eigenes Projekt „reiseplaner“)"
docker compose up -d --build

for i in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$(grep '^REISE_PORT=' .env | cut -d= -f2)/gesund" >/dev/null 2>&1; then break; fi
  sleep 2
done
echo
docker compose ps
echo
docker compose logs reiseplaner | grep -E "Einrichtungscode|läuft auf" || true
echo
echo "Test vom eigenen Rechner aus (SSH-Tunnel, ohne etwas freizugeben):"
echo "  ssh -L 3030:127.0.0.1:$(grep '^REISE_PORT=' .env | cut -d= -f2) root@<server>   → http://localhost:3030"
