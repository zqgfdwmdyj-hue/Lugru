#!/usr/bin/env bash
# Richtet die Smart-Home-Zentrale auf einem Server ein, auf dem schon andere Dienste laufen
# (z. B. neben dem Seller-System). Ändert keine Firewall und belegt nicht die Ports 80/443.
# Aufruf als root:  bash install.sh <github-repo-url> <ip> [port]
#   z. B.           bash install.sh https://github.com/name/smarthome.git 100.72.182.44 8123
# Optional vorab setzen: AUFNAHMEN_PFAD (Ziel der Videos, z. B. NAS), PUID/PGID (Besitzer),
# SMARTHOME_DIR (Installationsordner).
set -euo pipefail

REPO="${1:?GitHub-Adresse fehlt}"
BIND_IP="${2:?IP-Adresse fehlt (z. B. die Tailscale-IP des Servers: tailscale ip -4)}"
HA_PORT="${3:-8123}"
# Auf dem UGREEN-NAS z. B.: SMARTHOME_DIR=/volume1/docker/smarthome bash install.sh …
DIR="${SMARTHOME_DIR:-/opt/smarthome}"

command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ] && ss -tln | grep -q ":$HA_PORT "; then
  echo "Port $HA_PORT ist schon belegt – bitte einen anderen Port als dritten Parameter angeben."
  exit 1
fi

if [ ! -f .env ]; then
  cat > .env <<EOT
BIND_IP=$BIND_IP
HA_PORT=$HA_PORT
RING_INTERVALL_MINUTEN=5
RING_RUECKBLICK_TAGE=7
RING_AUFBEWAHRUNG_TAGE=90
RING_WEBHOOK_ID=ring-archiv-$(openssl rand -hex 16)
AUFNAHMEN_PFAD=${AUFNAHMEN_PFAD:-./aufnahmen}
PUID=${PUID:-1000}
PGID=${PGID:-1000}
COMPOSE_PROJECT_NAME=smarthome
EOT
  chmod 600 .env
fi
WEBHOOK_ID="$(grep '^RING_WEBHOOK_ID=' .env | cut -d= -f2)"

# Von Home Assistant erwartete Dateien (nicht im Git, die Oberfläche schreibt hinein).
cd homeassistant
[ -f secrets.yaml ] || { echo "ring_archiv_webhook: $WEBHOOK_ID" > secrets.yaml; chmod 600 secrets.yaml; }
for f in automations.yaml scripts.yaml scenes.yaml; do [ -f "$f" ] || : > "$f"; done
cd ..

# Das Ring-Archiv läuft als PUID:PGID aus .env (Standard 1000:1000).
wert() { grep "^$1=" .env | tail -1 | cut -d= -f2- || true; }
AUFNAHMEN="$(wert AUFNAHMEN_PFAD)"; AUFNAHMEN="${AUFNAHMEN:-./aufnahmen}"
U="$(wert PUID)"; G="$(wert PGID)"
mkdir -p "$AUFNAHMEN" ring-daten
chown "${U:-1000}:${G:-1000}" ring-daten
# Bei einer eingebundenen NAS-Freigabe legt die Mount-Option uid/gid den Besitzer fest.
chown "${U:-1000}:${G:-1000}" "$AUFNAHMEN" 2>/dev/null ||
  echo "Hinweis: Besitzer von $AUFNAHMEN nicht änderbar (NAS-Freigabe?) – Schreibrechte prüfen."

echo "==> Starten (der erste Download dauert einige Minuten)"
docker compose up -d --build

echo
echo "Fertig. Home Assistant: http://$BIND_IP:$HA_PORT  (erstes Konto dort anlegen)"
echo "Ring-Archiv einmalig anmelden:"
echo "  cd $DIR && docker compose run --rm ring-archiv anmelden && docker compose restart ring-archiv"
