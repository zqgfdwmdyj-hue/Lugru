#!/usr/bin/env bash
# Spenden-Tool unter eigener Domain mit HTTPS erreichbar machen (einmalig, als root auf dem Server).
#   bash /opt/spenden-tool/spenden-tool/deploy/domain-einrichten.sh lugrspende.de
#
# Voraussetzung: Beim Domain-Anbieter zeigt ein A-Eintrag der Domain (und optional www) auf diesen Server.
# Der vorhandene Caddy des Seller-Tools übernimmt HTTPS (Let's Encrypt, kostenlos) für beide Tools.
# Am Seller-Tool selbst ändert sich nichts außer einer Zeile COMPOSE_FILE in /opt/seller-system/.env.
set -euo pipefail

DOMAIN="${1:?Bitte die Domain angeben, z. B. lugrspende.de}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
APPDIR=/opt/spenden-tool/spenden-tool
SELLER=/opt/seller-system
IP="$(curl -4 -s https://ifconfig.me)"

zeigt_her() { [ "$(getent ahostsv4 "$1" | awk 'NR==1{print $1}')" = "$IP" ]; }

echo "==> DNS prüfen"
if ! zeigt_her "$DOMAIN"; then
  echo "ABBRUCH: $DOMAIN zeigt noch nicht auf $IP (aktuell: $(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true))."
  echo "Beim Domain-Anbieter einen A-Eintrag anlegen: $DOMAIN -> $IP. Danach kann es bis zu einigen Stunden dauern."
  exit 1
fi
NAMEN="$DOMAIN"
if zeigt_her "www.$DOMAIN"; then NAMEN="$DOMAIN, www.$DOMAIN"; else echo "Hinweis: www.$DOMAIN zeigt nicht hierher – nur $DOMAIN wird eingerichtet."; fi

echo "==> Caddy-Eintrag schreiben"
mkdir -p "$APPDIR/deploy/server"
cat > "$APPDIR/deploy/server/spenden.caddy" <<EOT
$NAMEN {
	encode gzip
	request_body {
		max_size 60MB
	}
	reverse_proxy spenden-app:3100
}
EOT

echo "==> Spenden-Tool auf HTTPS umstellen (Port 3021 nur noch intern)"
cd "$APPDIR"
setze() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
setze APP_URL "https://$DOMAIN"
setze PORT "127.0.0.1:3021"
docker compose up -d

echo "==> Caddy des Seller-Tools um die Spenden-Domain ergänzen"
cd "$SELLER"
cp .env "backups/env-vor-spenden-domain-$(date +%F_%H-%M-%S)" 2>/dev/null || cp .env ".env.vor-spenden-domain"
ZUSATZ="$APPDIR/deploy/caddy-seller.yml"
if grep -q "^COMPOSE_FILE=" .env; then
  grep -q "caddy-seller.yml" .env || sed -i "s|^COMPOSE_FILE=.*|&:$ZUSATZ|" .env
else
  echo "COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.hetzner.yml:$ZUSATZ" >> .env
fi
docker compose config -q
docker compose up -d --no-deps caddy

if command -v ufw >/dev/null && ufw status | grep -q "3021/tcp"; then
  echo "==> Firewall: Port 3021 wieder schließen"
  ufw delete allow 3021/tcp >/dev/null || true
fi

echo "==> Prüfen (das Zertifikat kann beim ersten Aufruf bis zu einer Minute dauern)"
for i in $(seq 1 12); do
  if curl -fsS -o /dev/null "https://$DOMAIN/login"; then echo; echo "Fertig: https://$DOMAIN"; exit 0; fi
  sleep 5
done
echo "Noch nicht erreichbar. Protokoll ansehen:  cd $SELLER && docker compose logs --tail 50 caddy"
exit 1
