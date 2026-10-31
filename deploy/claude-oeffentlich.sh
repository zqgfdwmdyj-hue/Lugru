#!/usr/bin/env bash
# Claude-Konnektor (claude.ai) öffentlich mit https erreichbar machen – ohne das ganze Seller-System freizugeben.
#
# Claude ruft den Konnektor aus dem Internet auf und verlangt https://. Freigegeben werden NUR: Login,
# Freigabe-Seite für Claude, der Konnektor (/api/mcp, nur mit Zugangs-Token), die Metadaten (/.well-known),
# Skripte/Logo der Login-Seite, die befristeten Kunden-Links für Sendungen und die Handy-Endpunkte
# (/api/mobil/*: Kurzbefehle, Widget – nur mit Geräte-Schlüssel mk_…, Rate-Limit und Protokoll im Seller-System),
# der Deal-Kurzbefehl (/api/deal-eingang, Schlüssel dk_…) und Lugru Deals (/api/public/lugru-deals/*,
# Verbindungsschlüssel).
# Alles andere (Aufträge, Einstellungen, Privatbereich …) antwortet unter dieser Adresse mit „nicht freigegeben“
# (unter /api/* als JSON, damit Kurzbefehle und Skripte eine lesbare Fehlermeldung bekommen).
#
# Aufruf als root auf dem Server – je nach Server eine der Varianten:
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh domain claude.deine-domain.de
#        Webserver Caddy auf dem Server (Ports 80/443): eigene Subdomain mit https. Vorher beim Domain-Anbieter
#        einen DNS-Eintrag (A-Record) für die Subdomain auf die IP dieses Servers anlegen.
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh tailscale
#        Server im Tailscale-Netz: Tailscale Funnel (Port 8443, anderer Port: CLAUDE_PORT=10000 …).
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh url https://seller.deine-domain.de
#        Das ganze Seller-System läuft schon unter einer https-Adresse: nur diese Adresse eintragen.
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh aktualisieren   # nach einem Update: Freigabe neu schreiben
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh status
#   bash /opt/seller-system/deploy/claude-oeffentlich.sh aus      # Freigabe wieder schließen
set -euo pipefail
cd /opt/seller-system

MODE="${1:-}"
ARG="${2:-}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TS_PORT="${CLAUDE_PORT:-8443}"
PATHS=(/.well-known /api/mcp /oauth/authorize /login /_next /icons /sendung /api/public/sendung /api/mobil /api/deal-eingang /api/public/lugru-deals)
BEGIN="# seller-system-claude BEGIN"
END="# seller-system-claude END"

[ -f .env ] || { echo "ABBRUCH: /opt/seller-system/.env fehlt."; exit 1; }
mkdir -p backups
val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
  cp .env backups/env-sicherung && chmod 600 backups/env-sicherung
}
compose() {
  if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose "$@"; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml "$@"; fi
}
APP_PORT="$(val APP_PORT)"; APP_PORT="${APP_PORT:-3020}"
LOCAL="http://127.0.0.1:$APP_PORT"
server_ip() { hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^(127|10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.' | head -1; }

restart_app() {
  echo "==> Starte die App mit der neuen Adresse neu (Daten bleiben erhalten)"
  compose up -d app
  for _ in $(seq 1 60); do curl -fsS -o /dev/null --max-time 5 "$LOCAL/login" && return 0; sleep 2; done
  echo "    Hinweis: Die App antwortet noch nicht unter $LOCAL – „docker compose ps“ prüfen."
}
check_public() {
  local base="$1"
  echo "==> Prüfe $base (beim ersten Mal holt der Webserver das Zertifikat – bis zu 1–2 Minuten)"
  for _ in $(seq 1 "${CHECK_TRIES:-24}"); do
    if curl -fsS --max-time 10 "$base/.well-known/oauth-protected-resource/api/mcp" 2>/dev/null | grep -q "\"resource\":\"$base/api/mcp\""; then
      echo "    ok – Claude findet den Konnektor."
      return 0
    fi
    sleep 5
  done
  echo "    Noch keine Antwort. Später prüfen:  curl $base/.well-known/oauth-protected-resource/api/mcp"
}
done_msg() {
  echo
  echo "Fertig. In Claude (Einstellungen → Konnektoren → Eigenen Konnektor hinzufügen) als URL eintragen:"
  echo "  $1/api/mcp"
  echo "(Steht auch im Seller-System unter Einstellungen → Claude & KI-Assistent.)"
  echo "Wieder schließen:  bash /opt/seller-system/deploy/claude-oeffentlich.sh aus"
}
# Freigabe-Block für Caddy. /api/mobil/* prüft das Seller-System selbst (Geräte-Schlüssel, Nur-ansehen-Konten,
# Rate-Limit, Protokoll), ebenso /api/deal-eingang (Deal-Kurzbefehl: Schlüssel dk_… oder Anmeldung) und
# /api/public/lugru-deals/* (Lugru Deals: Verbindungsschlüssel); gesperrte /api/*-Pfade antworten als JSON, alles
# andere als Text.
caddy_block() {
  local domain="$1"
  printf '\n%s – Freigabe für den Claude-Konnektor und die Handy-Endpunkte (deploy/claude-oeffentlich.sh), nur diese Pfade\n' "$BEGIN"
  printf '%s {\n' "$domain"
  printf '\tencode gzip\n'
  printf '\t@frei path /.well-known/* /api/mcp /api/mcp/* /oauth/authorize /login /_next/* /icons/* /sendung/* /api/public/sendung/* /api/mobil/* /api/deal-eingang /api/public/lugru-deals/*\n'
  printf '\thandle @frei {\n\t\treverse_proxy 127.0.0.1:%s\n\t}\n' "$APP_PORT"
  printf '\t@api path /api/*\n'
  printf '\thandle @api {\n'
  printf '\t\theader Content-Type "application/json; charset=utf-8"\n'
  printf '\t\trespond `{"ok":false,"error":"Über diese Adresse nicht freigegeben.","antwort":"Über diese Adresse nicht freigegeben."}` 404\n'
  printf '\t}\n'
  printf '\thandle {\n\t\trespond "Nicht freigegeben" 404\n\t}\n'
  printf '}\n%s\n' "$END"
}
caddy_remove_block() {
  [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE" || return 1
  sed -i "/^$BEGIN/,/^$END/d" "$CADDYFILE"
}
caddy_reload() {
  if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    echo "ABBRUCH: Die Caddy-Konfiguration ist so nicht gültig – alte Fassung wird wiederhergestellt."
    cp "$1" "$CADDYFILE"
    caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1 | tail -3 || true
    exit 1
  fi
  if systemctl is-active --quiet caddy 2>/dev/null; then systemctl reload caddy; else caddy reload --config "$CADDYFILE" --adapter caddyfile; fi
}

case "$MODE" in
  status)
    echo "PUBLIC_URL=$(val PUBLIC_URL)"
    [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE" && { echo "Caddy-Freigabe:"; sed -n "/^$BEGIN/,/^$END/p" "$CADDYFILE"; }
    command -v tailscale >/dev/null && tailscale funnel status || true
    ;;

  aus)
    if [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE"; then
      bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
      caddy_remove_block && caddy_reload "$bak"
      echo "Caddy-Freigabe entfernt (Sicherung: $bak)."
    fi
    if command -v tailscale >/dev/null; then
      for p in "${PATHS[@]}"; do tailscale funnel --https="$TS_PORT" --set-path="$p" off >/dev/null 2>&1 || true; done
    fi
    set_env PUBLIC_URL ""
    restart_app
    echo "Geschlossen. Claude erreicht das Seller-System nicht mehr."
    ;;

  domain)
    DOMAIN="$(printf '%s' "$ARG" | tr 'A-Z' 'a-z' | sed 's|^https\?://||; s|/.*$||')"
    printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "ABBRUCH: Bitte eine Adresse angeben, z. B.:  … claude-oeffentlich.sh domain claude.deine-domain.de"; exit 1; }
    command -v caddy >/dev/null || { echo "ABBRUCH: Caddy ist auf diesem Server nicht installiert (Variante „tailscale“ oder „url“ nutzen)."; exit 1; }
    [ -f "$CADDYFILE" ] || { echo "ABBRUCH: $CADDYFILE nicht gefunden (anderer Ort? CADDYFILE=/pfad/Caddyfile davor setzen)."; exit 1; }
    curl -fsS -o /dev/null --max-time 10 "$LOCAL/login" || { echo "ABBRUCH: Das Seller-System antwortet nicht unter $LOCAL – läuft die App? (docker compose ps)"; exit 1; }
    IP="$(server_ip)"
    DNS_IPS="$( (getent ahostsv4 "$DOMAIN" 2>/dev/null || true) | awk '{print $1}' | sort -u | tr '\n' ' ')"
    if [ -z "$IP" ] || ! printf ' %s ' "$DNS_IPS" | grep -q " $IP "; then
      echo "ABBRUCH: $DOMAIN zeigt noch nicht auf diesen Server."
      echo "  Beim Domain-Anbieter einen DNS-Eintrag anlegen:  Typ A,  Name: ${DOMAIN%%.*} (bzw. $DOMAIN),  Wert: ${IP:-<IP dieses Servers>}"
      echo "  Aktuell zeigt $DOMAIN auf: ${DNS_IPS:-nichts}. Nach dem Anlegen ein paar Minuten warten, dann das Skript erneut starten."
      exit 1
    fi
    # Gibt es die Adresse schon außerhalb unseres Blocks? Dann nichts anfassen.
    if sed "/^$BEGIN/,/^$END/d" "$CADDYFILE" | grep -qE "(^|[[:space:],])(https?://)?$DOMAIN([[:space:],:{]|$)"; then
      echo "ABBRUCH: $DOMAIN steht schon in $CADDYFILE (für etwas anderes). Bitte eine eigene Subdomain nehmen, z. B. claude.${DOMAIN#*.}"
      exit 1
    fi
    bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
    echo "==> Trage $DOMAIN in $CADDYFILE ein (Sicherung: $bak)"
    caddy_remove_block || true
    caddy_block "$DOMAIN" >> "$CADDYFILE"
    caddy_reload "$bak"
    PUBLIC="https://$DOMAIN"
    set_env PUBLIC_URL "$PUBLIC"
    restart_app
    check_public "$PUBLIC"
    done_msg "$PUBLIC"
    ;;

  url)
    PUBLIC="$(printf '%s' "$ARG" | sed 's|/*$||')"
    printf '%s' "$PUBLIC" | grep -qE '^https://[^/]+$' || { echo "ABBRUCH: Bitte die https-Adresse angeben, z. B.:  … claude-oeffentlich.sh url https://seller.deine-domain.de"; exit 1; }
    curl -fsS -o /dev/null --max-time 15 "$PUBLIC/login" || { echo "ABBRUCH: $PUBLIC/login antwortet nicht."; exit 1; }
    set_env PUBLIC_URL "$PUBLIC"
    restart_app
    check_public "$PUBLIC"
    done_msg "$PUBLIC"
    ;;

  aktualisieren)
    # Nach einem Update: bestehende Freigabe mit den aktuellen Pfaden neu schreiben (gleiche Adresse, kein Neustart).
    if [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE"; then
      DOMAIN="$(sed -n "/^$BEGIN/,/^$END/p" "$CADDYFILE" | sed -n 's/^\([^[:space:]#][^[:space:]]*\) {$/\1/p' | head -1)"
      [ -n "$DOMAIN" ] || { echo "ABBRUCH: Adresse im Caddy-Block nicht gefunden – „domain <adresse>“ erneut ausführen."; exit 1; }
      bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
      caddy_remove_block
      caddy_block "$DOMAIN" >> "$CADDYFILE"
      caddy_reload "$bak"
      echo "Caddy-Freigabe für $DOMAIN aktualisiert (Sicherung: $bak)."
      PUBLIC="https://$DOMAIN"
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$PUBLIC/api/mobil/erfassen" || true)"
      if [ "$code" = "401" ]; then echo "    ok – Handy-Endpunkte erreichbar und geschützt (ohne Schlüssel 401)."; else echo "    Hinweis: $PUBLIC/api/mobil/erfassen antwortet mit $code statt 401."; fi
      for p in /api/deal-eingang /api/public/lugru-deals/deals; do
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$PUBLIC$p" || true)"
        if [ "$code" = "401" ]; then echo "    ok – $p erreichbar und geschützt (ohne Schlüssel 401)."; else echo "    Hinweis: $PUBLIC$p antwortet mit $code statt 401."; fi
      done
    elif command -v tailscale >/dev/null && tailscale funnel status 2>/dev/null | grep -q "/api/mcp"; then
      BIND_IP="$(val BIND_IP)"; [ -z "$BIND_IP" ] || [ "$BIND_IP" = "0.0.0.0" ] && BIND_IP=127.0.0.1
      YES=(); tailscale funnel --help 2>&1 | grep -q -- "-yes" && YES=(--yes)
      for p in "${PATHS[@]}"; do tailscale funnel --bg "${YES[@]}" --https="$TS_PORT" --set-path="$p" "http://$BIND_IP:$APP_PORT$p"; done
      echo "Tailscale-Freigabe aktualisiert: ${PATHS[*]}"
    else
      echo "Keine Freigabe eingerichtet – zuerst „domain …“, „tailscale“ oder „url …“ ausführen."
      exit 1
    fi
    ;;

  tailscale)
    command -v tailscale >/dev/null || { echo "ABBRUCH: tailscale ist auf diesem Server nicht installiert."; exit 1; }
    case "$TS_PORT" in 443|8443|10000) ;; *) echo "ABBRUCH: Tailscale Funnel erlaubt nur die Ports 443, 8443 oder 10000."; exit 1 ;; esac
    BIND_IP="$(val BIND_IP)"; [ -z "$BIND_IP" ] || [ "$BIND_IP" = "0.0.0.0" ] && BIND_IP=127.0.0.1
    TARGET="http://$BIND_IP:$APP_PORT"
    curl -fsS -o /dev/null --max-time 10 "$TARGET/login" || { echo "ABBRUCH: $TARGET/login antwortet nicht – läuft die App?"; exit 1; }
    DNS="$(tailscale status --json --peers=false | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1)"; DNS="${DNS%.}"
    [ -n "$DNS" ] || { echo "ABBRUCH: Tailscale-Name dieses Servers nicht gefunden (MagicDNS an?)."; exit 1; }
    if [ "$TS_PORT" = "443" ]; then PUBLIC="https://$DNS"; else PUBLIC="https://$DNS:$TS_PORT"; fi
    echo "==> Gebe über Tailscale Funnel frei (Port $TS_PORT): ${PATHS[*]}"
    echo "    Ist Funnel für dein Tailnet noch nicht erlaubt, zeigt Tailscale einen Link – öffnen, erlauben, es geht dann weiter."
    YES=(); tailscale funnel --help 2>&1 | grep -q -- "-yes" && YES=(--yes)
    for p in "${PATHS[@]}"; do tailscale funnel --bg "${YES[@]}" --https="$TS_PORT" --set-path="$p" "$TARGET$p"; done
    set_env PUBLIC_URL "$PUBLIC"
    restart_app
    check_public "$PUBLIC"
    done_msg "$PUBLIC"
    ;;

  *)
    IP="$(server_ip)"
    echo "Welche Variante passt zu diesem Server?"
    if command -v caddy >/dev/null && [ -f "$CADDYFILE" ]; then
      echo "  Hier läuft der Webserver Caddy → eigene Subdomain mit https:"
      echo "    1. Beim Domain-Anbieter DNS-Eintrag anlegen: Typ A, z. B. Name „claude“, Wert ${IP:-<IP dieses Servers>}"
      echo "    2. bash /opt/seller-system/deploy/claude-oeffentlich.sh domain claude.deine-domain.de"
    fi
    command -v tailscale >/dev/null && echo "  Tailscale ist installiert →  bash /opt/seller-system/deploy/claude-oeffentlich.sh tailscale"
    echo "  Läuft das Seller-System schon komplett unter https →  bash /opt/seller-system/deploy/claude-oeffentlich.sh url https://…"
    exit 1
    ;;
esac
