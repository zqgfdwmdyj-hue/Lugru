#!/usr/bin/env bash
# Claude-Konnektor (claude.ai) erreichbar machen, wenn das Seller-System nur im privaten Netz (Tailscale) läuft.
#
# Claude ruft den Konnektor aus dem Internet auf und verlangt https://. Dieses Skript gibt über Tailscale Funnel
# NUR die Pfade öffentlich frei, die Claude für Anmeldung und Konnektor braucht – plus die befristeten
# Kunden-Links für Sendungen. Alles andere (Aufträge, Einstellungen, Privatbereich …) bleibt nur über Tailscale
# erreichbar. Öffentlich sind damit: die Login-Seite (mit Sperre nach Fehlversuchen), die Freigabe-Seite für
# Claude, der Konnektor selbst (nur mit Zugangs-Token) und Kunden-Links (nur mit geheimem, befristetem Link).
#
# Aufruf als root auf dem Server:
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh          # einrichten (oder erneut einrichten)
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh status   # anzeigen
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh aus      # wieder schließen
# Anderer Port als 8443 (Funnel erlaubt 443, 8443, 10000):  CLAUDE_PORT=10000 bash …/claude-oeffentlich.sh
set -euo pipefail
cd /opt/seller-system

MODE="${1:-an}"
PORT="${CLAUDE_PORT:-8443}"
PATHS=(/.well-known /api/mcp /oauth/authorize /login /_next /sendung /api/public/sendung)

command -v tailscale >/dev/null || { echo "ABBRUCH: tailscale ist auf diesem Server nicht installiert."; exit 1; }
[ -f .env ] || { echo "ABBRUCH: /opt/seller-system/.env fehlt."; exit 1; }
case "$PORT" in 443|8443|10000) ;; *) echo "ABBRUCH: Tailscale Funnel erlaubt nur die Ports 443, 8443 oder 10000."; exit 1 ;; esac

val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
  cp .env backups/env-sicherung 2>/dev/null && chmod 600 backups/env-sicherung || true
}
compose() {
  if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose "$@"; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml "$@"; fi
}

if [ "$MODE" = "status" ]; then
  tailscale funnel status || true
  echo "PUBLIC_URL=$(val PUBLIC_URL)"
  exit 0
fi

if [ "$MODE" = "aus" ]; then
  for p in "${PATHS[@]}"; do tailscale funnel --https="$PORT" --set-path="$p" off >/dev/null 2>&1 || true; done
  set_env PUBLIC_URL ""
  compose up -d app
  echo "Geschlossen. Claude erreicht das Seller-System nicht mehr; Kunden-Links gehen nur noch im eigenen Netz."
  exit 0
fi

BIND_IP="$(val BIND_IP)"
APP_PORT="$(val APP_PORT)"
if [ -z "$BIND_IP" ] || [ -z "$APP_PORT" ]; then
  echo "ABBRUCH: BIND_IP/APP_PORT fehlen in .env. Das Skript ist für die Einrichtung im privaten Netz (install-intern.sh)."
  echo "Mit eigener Domain und HTTPS (install.sh) braucht es das nicht – dort gilt die Domain direkt."
  exit 1
fi
TARGET="http://$BIND_IP:$APP_PORT"

DNS="$(tailscale status --json --peers=false | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1)"
DNS="${DNS%.}"
[ -n "$DNS" ] || { echo "ABBRUCH: Tailscale-Name dieses Servers nicht gefunden (MagicDNS an? „tailscale status“ prüfen)."; exit 1; }
if [ "$PORT" = "443" ]; then PUBLIC="https://$DNS"; else PUBLIC="https://$DNS:$PORT"; fi

echo "==> Prüfe, ob das Seller-System unter $TARGET antwortet"
curl -fsS -o /dev/null --max-time 10 "$TARGET/login" || { echo "ABBRUCH: $TARGET/login antwortet nicht – läuft die App? (docker compose ps)"; exit 1; }

echo "==> Gebe über Tailscale Funnel frei (Port $PORT): ${PATHS[*]}"
echo "    Ist Funnel für dein Tailnet noch nicht erlaubt, zeigt Tailscale einen Link – im Browser öffnen, erlauben, das Skript läuft dann weiter."
YES=()
tailscale funnel --help 2>&1 | grep -q -- "-yes" && YES=(--yes)
for p in "${PATHS[@]}"; do
  tailscale funnel --bg "${YES[@]}" --https="$PORT" --set-path="$p" "$TARGET$p"
done

echo "==> Trage PUBLIC_URL=$PUBLIC ein und starte die App neu (Daten bleiben erhalten)"
set_env PUBLIC_URL "$PUBLIC"
compose up -d app

echo "==> Warte auf die App"
for _ in $(seq 1 60); do curl -fsS -o /dev/null --max-time 5 "$TARGET/login" && break; sleep 2; done

echo "==> Prüfe die öffentliche Adresse"
if curl -fsS --max-time 15 "$PUBLIC/.well-known/oauth-protected-resource/api/mcp" | grep -q "\"resource\":\"$PUBLIC/api/mcp\""; then
  echo "    ok – Claude findet den Konnektor."
else
  echo "    Hinweis: Die Prüfung von hier aus ging nicht (manchmal braucht das Zertifikat beim ersten Mal 1–2 Minuten)."
  echo "    Später nochmal:  curl $PUBLIC/.well-known/oauth-protected-resource/api/mcp"
fi

echo
echo "Fertig. In Claude als Konnektor-URL eintragen:"
echo "  $PUBLIC/api/mcp"
echo "(Steht auch unter Einstellungen → Claude & KI-Assistent.)"
echo "Wieder schließen:  bash /opt/seller-system/deploy/claude-oeffentlich.sh aus"
