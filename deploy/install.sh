#!/usr/bin/env bash
# Richtet das Seller-System auf einem frischen Hetzner-Server (Ubuntu 24.04) ein.
# Aufruf als root:  bash install.sh <github-repo-url> [domain]
set -euo pipefail

REPO="${1:?Bitte die GitHub-Adresse angeben, z. B. https://github.com/name/repo}"
IP="$(curl -4 -s https://ifconfig.me)"
DOMAIN="${2:-${IP//./-}.sslip.io}"
DIR=/opt/seller-system

echo "==> Pakete und Docker installieren"
apt-get update -qq
apt-get install -y -qq git curl ufw >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "==> Firewall: nur SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> Code holen"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  echo "==> Geheimnisse erzeugen"
  cat > .env <<EOT
APP_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)
APP_URL=https://$DOMAIN
DOMAIN=$DOMAIN
CRON_SECRET=$(openssl rand -hex 24)
EOT
  chmod 600 .env
fi

echo "==> Starten (der erste Build dauert einige Minuten)"
docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml up -d --build

echo
echo "Fertig. Adresse: https://$DOMAIN"
echo "Benutzer anlegen:"
echo "  cd $DIR && docker compose exec app npm run user:create -- --email du@firma.de --firma \"Deine Firma\""
