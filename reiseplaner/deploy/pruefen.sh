#!/usr/bin/env bash
# Nur lesen, nichts ändern: zeigt, was auf dem Server läuft, damit der Reiseplaner nichts stört.
# Aufruf:  bash pruefen.sh [subdomain]     z. B.  bash pruefen.sh reise.lugru.de
set -u
echo "=== Docker-Container ==="
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || echo "Docker nicht gefunden"
echo
echo "=== Docker-Compose-Projekte ==="
docker compose ls 2>/dev/null
echo
echo "=== Belegte Ports 80, 443, 3030–3040 ==="
ss -tlnp 2>/dev/null | awk 'NR==1 || $4 ~ /:(80|443|30[34][0-9])$/'
echo
echo "=== Webserver-Konfigurationen ==="
for f in /etc/caddy/Caddyfile /opt/seller-system/deploy/Caddyfile; do [ -f "$f" ] && echo "$f:" && grep -vE '^\s*(#|$)' "$f" | head -20; done
ls /etc/nginx/sites-enabled 2>/dev/null && echo "(nginx vorhanden)"
echo
echo "=== Tailscale ==="
tailscale ip -4 2>/dev/null || echo "kein Tailscale"
echo
echo "=== Öffentliche IP ==="
curl -4 -s --max-time 5 https://ifconfig.me; echo
if [ -n "${1:-}" ]; then
  echo
  echo "=== DNS für $1 ==="
  getent hosts "$1" || echo "$1 löst (noch) nicht auf"
fi
echo
echo "=== Freier Speicher ==="
df -h / | tail -1
