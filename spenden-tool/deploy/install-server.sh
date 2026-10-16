#!/usr/bin/env bash
# Richtet das Spenden-Tool auf dem bestehenden Hetzner-Server ein – getrennt vom Seller-Tool:
# eigener Ordner, eigene Container, eigene Datenbank, eigener Port.
#
# Aufruf als root:
#   bash install-server.sh [port] [branch] [repo-url]
# Standard: Port 3021, Branch main, Repo-Adresse wie beim Seller-Tool (/opt/seller-system).
set -euo pipefail

PORT="${1:-3021}"
BRANCH="${2:-main}"
REPO="${3:-$(git -C /opt/seller-system remote get-url origin 2>/dev/null || true)}"
[ -n "$REPO" ] || { echo "Bitte die GitHub-Adresse als 3. Parameter angeben."; exit 1; }
SRC=/opt/spenden-tool
IP="$(curl -4 -s https://ifconfig.me)"

command -v docker >/dev/null || { echo "Docker fehlt – ist das der richtige Server?"; exit 1; }

echo "==> Code holen nach $SRC (Branch $BRANCH)"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q origin "$BRANCH" && git -C "$SRC" checkout -q "$BRANCH" && git -C "$SRC" pull -q --ff-only origin "$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$SRC"
fi
cd "$SRC/spenden-tool"

PASSWORT=""
if [ ! -f .env ]; then
  echo "==> Zugangsdaten erzeugen"
  PASSWORT="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)"
  cat > .env <<EOT
APP_PASSWORD=$PASSWORT
APP_SECRET=$(openssl rand -hex 32)
APP_URL=http://$IP:$PORT
PORT=$PORT
# Für die KI-Preisrecherche hier den Schlüssel eintragen, dann: bash deploy/update-server.sh
ANTHROPIC_API_KEY=
PREISVORSCHLAG_ANTEIL=0.25
EOT
  chmod 600 .env
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> Firewall: Port $PORT öffnen"
  ufw allow "$PORT/tcp" >/dev/null
fi

echo "==> Starten (der erste Build dauert einige Minuten)"
docker compose up -d --build

echo
echo "Fertig. Adresse: http://$IP:$PORT"
if [ -n "$PASSWORT" ]; then echo "Team-Passwort: $PASSWORT   (steht auch in $SRC/spenden-tool/.env)"; fi
echo "Hinweis: Falls in der Hetzner-Cloud-Konsole eine Firewall aktiv ist, dort Port $PORT (TCP) freigeben."
