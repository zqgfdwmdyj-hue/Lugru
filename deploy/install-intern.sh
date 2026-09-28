#!/usr/bin/env bash
# Richtet das Seller-System auf einem Server ein, auf dem schon andere Dienste laufen.
# Ändert KEINE Firewall und belegt NICHT die Ports 80/443.
# Aufruf als root:  bash install-intern.sh <github-repo-url> <ip> [port]
#   z. B.           bash install-intern.sh https://github.com/name/repo.git 100.72.182.44 3020
set -euo pipefail

REPO="${1:?GitHub-Adresse fehlt}"
BIND_IP="${2:?IP-Adresse fehlt (z. B. die Tailscale-IP des Servers)}"
APP_PORT="${3:-3020}"
DIR=/opt/seller-system

if ss -tln | grep -q ":$APP_PORT "; then
  echo "Port $APP_PORT ist schon belegt – bitte einen anderen Port als dritten Parameter angeben."
  exit 1
fi

command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR"

# Bei einer Neuinstallation den alten Schlüssel weiterverwenden – sonst wären die gespeicherten
# Zugangsdaten in der (erhalten gebliebenen) Datenbank nicht mehr lesbar.
if [ ! -f .env ] && [ -f backups/env-sicherung ]; then
  cp backups/env-sicherung .env && chmod 600 .env
  echo "==> Vorhandene Einstellungen (.env) aus backups/env-sicherung übernommen."
fi
if [ ! -f .env ]; then
  cat > .env <<EOT
APP_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)
APP_URL=http://$BIND_IP:$APP_PORT
BIND_IP=$BIND_IP
APP_PORT=$APP_PORT
CRON_SECRET=$(openssl rand -hex 24)
COMPOSE_PROJECT_NAME=seller-system
COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.intern.yml
EOT
  chmod 600 .env
fi

mkdir -p backups && cp .env backups/env-sicherung && chmod 600 backups/env-sicherung

echo "==> Starten (der erste Build dauert einige Minuten)"
docker compose up -d --build

echo
echo "Fertig. Adresse: http://$BIND_IP:$APP_PORT"
echo "Benutzer anlegen:"
echo "  cd $DIR && docker compose exec app npm run user:create -- --email du@firma.de --firma \"Deine Firma\""
