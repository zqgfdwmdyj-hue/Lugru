#!/usr/bin/env bash
# Seller-System nur noch über https erreichbar machen: App-Port (z. B. 3020) nach außen schließen und die Adresse für
# Links (APP_URL) auf die https-Adresse stellen. Geht danach etwas nicht, wird der alte Stand automatisch zurückgeholt.
#
# Aufruf als root auf dem Server:
#   bash /opt/seller-system/deploy/absichern.sh                                 # nur prüfen, ändert nichts
#   bash /opt/seller-system/deploy/absichern.sh anwenden https://deine-domain.de
#   bash /opt/seller-system/deploy/absichern.sh zurueck                         # Stand vor „anwenden“ zurückholen
#
# Gibt nie Passwörter oder Schlüssel aus – nur Adressen (APP_URL, PUBLIC_URL) und Ports.
set -uo pipefail
cd "${SELLER_DIR:-/opt/seller-system}"

MODE="${1:-pruefen}"
ARG="${2:-}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
CLAUDE_BEGIN="# seller-system-claude BEGIN"
CLAUDE_END="# seller-system-claude END"

[ -f .env ] || { echo "ABBRUCH: /opt/seller-system/.env fehlt."; exit 1; }
mkdir -p backups
val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
compose() {
  if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose "$@"; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml "$@"; fi
}
APP_PORT="$(val APP_PORT)"; APP_PORT="${APP_PORT:-3020}"
server_ip() { hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^(127|10|172\.(1[6-9]|2[0-9]|3[01])|192\.168|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7]))\.' | head -1; }
IP="${SERVER_IP:-$(server_ip)}"
OK=0; WARN=0
ok()   { echo "  ✔ $*"; OK=$((OK + 1)); }
warn() { echo "  ✘ $*"; WARN=$((WARN + 1)); }
info() { echo "    $*"; }

# Adressen, auf die der App-Port gerade hört (0.0.0.0 = von überall).
listen_addrs() { ss -Htln "sport = :$APP_PORT" 2>/dev/null | awk '{print $4}' | sed "s/:$APP_PORT\$//" | sort -u | tr '\n' ' '; }
# Antwortet die App unter der öffentlichen IP direkt (ohne https)?
open_from_outside() { [ -n "$IP" ] && curl -s -o /dev/null --max-time 5 "http://$IP:$APP_PORT/login"; }
# Website-Blöcke im Caddyfile, die auf den App-Port weiterleiten: „<Adressen>|<Ziel>“ (ohne die Claude-Freigabe).
caddy_sites() {
  [ -f "$CADDYFILE" ] || return 0
  sed "/^$CLAUDE_BEGIN/,/^$CLAUDE_END/d" "$CADDYFILE" | awk -v port="$APP_PORT" '
    { line = $0; sub(/#.*/, "", line) }
    depth == 0 && line ~ /\{[[:space:]]*$/ { site = line; sub(/\{[[:space:]]*$/, "", site); gsub(/^[[:space:]]+|[[:space:]]+$/, "", site) }
    depth > 0 && line ~ (":" port "([^0-9]|$)") {
      n = split(line, w, /[[:space:]]+/)
      for (i = 1; i <= n; i++) if (w[i] ~ (":" port "$")) print site "|" w[i]
    }
    { o = gsub(/\{/, "{", line); c = gsub(/\}/, "}", line); depth += o - c }
  '
}
private_host() { printf '%s' "$1" | grep -qE '^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|[0-9.]+$)'; }
url_host() { printf '%s' "$1" | sed -E 's|^[a-z]+://||; s|[/:].*$||'; }
https_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1/login")" = "200" ]; }

check_app_url() {
  local u; u="$(val APP_URL)"
  echo "Adresse für Links (APP_URL) – Benachrichtigungen, Google/Microsoft-Anmeldung, Kalender, Anmelde-Cookie:"
  if [ -z "$u" ]; then warn "APP_URL ist leer"; return; fi
  info "APP_URL=$u"
  case "$u" in https://*) ok "https – Anmelde-Cookie wird nur verschlüsselt übertragen" ;; *) warn "kein https – Anmelde-Cookie ohne „Secure“, Links unverschlüsselt" ;; esac
  if private_host "$(url_host "$u")"; then warn "IP/interne Adresse – Links in Meldungen gehen unterwegs (Handy, Kunden) nicht auf"; else ok "Name statt IP-Adresse"; fi
  local p; p="$(val PUBLIC_URL)"
  [ -n "$p" ] && info "PUBLIC_URL=$p  (Claude-Konnektor und Kunden-Links)"
  if [ -n "$p" ] && private_host "$(url_host "$p")"; then warn "PUBLIC_URL ist eine interne Adresse"; fi
  # Was die laufende App wirklich benutzt (nur Namen der Variablen ausgeben, keine Werte außer Adressen).
  local inner; inner="$(compose exec -T app sh -c 'printf "%s\n%s\n" "$APP_URL" "$PUBLIC_URL"' 2>/dev/null | head -2 | tr '\n' ' ')"
  [ -n "$inner" ] && info "Laufende App benutzt: $inner"
  local bad; bad="$(compose exec -T app printenv 2>/dev/null | grep -E '^[A-Z_]+=https?://(100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])|10\.|192\.168\.)' | cut -d= -f1 | tr '\n' ' ')"
  if [ -n "$bad" ]; then warn "interne Adresse in der laufenden App: $bad"; else ok "keine interne 100.x/10.x/192.168.x-Adresse in den Adress-Variablen der laufenden App"; fi
}

check_port() {
  local a; a="$(listen_addrs)"
  echo "App-Port $APP_PORT:"
  if [ -z "$a" ]; then warn "niemand hört auf Port $APP_PORT – läuft die App? (docker compose ps)"; return; fi
  info "hört auf: $a"
  if printf ' %s ' "$a" | grep -qE ' (0\.0\.0\.0|\*|\[::\]) '; then warn "von überall erreichbar (0.0.0.0) – unverschlüsselt per http://${IP:-<IP>}:$APP_PORT"; else ok "nur auf $a"; fi
  if open_from_outside; then warn "http://$IP:$APP_PORT antwortet – das Seller-System ist ohne https erreichbar"; else ok "http://${IP:-<IP>}:$APP_PORT antwortet nicht"; fi
}

check_caddy() {
  echo "Webserver Caddy ($CADDYFILE):"
  if ! command -v caddy >/dev/null || [ ! -f "$CADDYFILE" ]; then info "kein Caddy auf dem Server gefunden"; return; fi
  local sites; sites="$(caddy_sites)"
  if [ -z "$sites" ]; then warn "keine Website im Caddyfile leitet auf Port $APP_PORT weiter"; return; fi
  while IFS='|' read -r site target; do
    local th; th="$(printf '%s' "$target" | sed -E 's|^[a-z]+://||; s|:[0-9]+$||')"
    case "$th" in 127.0.0.1|localhost|"") ok "$site → $target (funktioniert auch, wenn der Port nach außen zu ist)" ;; *) warn "$site → $target – nach dem Schließen nicht mehr erreichbar; vorher im Caddyfile auf 127.0.0.1:$APP_PORT ändern" ;; esac
    for d in $(printf '%s' "$site" | tr ',' ' '); do
      d="$(printf '%s' "$d" | sed -E 's|^https?://||; s|/.*$||; s|:[0-9]+$||')"
      [ -z "$d" ] && continue
      if https_ok "https://$d"; then ok "https://$d/login antwortet (200)"; else warn "https://$d/login antwortet nicht mit 200"; fi
    done
  done <<< "$sites"
  if grep -qF "$CLAUDE_BEGIN" "$CADDYFILE"; then
    local p; p="$(val PUBLIC_URL)"
    if [ -n "$p" ] && curl -fsS --max-time 10 "$p/.well-known/oauth-protected-resource/api/mcp" 2>/dev/null | grep -q "\"resource\":\"$p/api/mcp\""; then ok "Claude-Freigabe $p findet den Konnektor"; else warn "Claude-Freigabe $p antwortet nicht wie erwartet"; fi
    if [ -n "$p" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$p/auftraege")" = "404" ]; then ok "$p/auftraege ist gesperrt (404 „Nicht freigegeben“)"; elif [ -n "$p" ]; then warn "$p/auftraege ist NICHT gesperrt"; fi
  fi
}

check_others() {
  echo "Andere Dienste, die von außen erreichbar sind (gehören nicht zum Seller-System – bitte prüfen, ob gewollt):"
  local found=0
  while read -r addr; do
    local port="${addr##*:}" host="${addr%:*}"
    case "$port" in 22|80|443|"$APP_PORT") continue ;; esac
    case "$host" in
      0.0.0.0|\*|\[::\])
        local who; who="$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E "(0\.0\.0\.0|::):$port->" | awk '{print $1}' | head -1)"
        [ -z "$who" ] && who="$(ss -Htlnp "sport = :$port" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | sed 's/users:(("//; s/"$//')"
        info "Port $port${who:+ ($who)}"; found=1 ;;
    esac
  done < <(ss -Htln 2>/dev/null | awk '{print $4}' | sort -u)
  [ "$found" = 0 ] && info "keine"
  info "Zusätzlich empfohlen: in der Hetzner Cloud Console eine Firewall nur mit 22, 80, 443 (eingehend)."
}

# Lokale Änderung an docker-compose.yml (z. B. Port von Hand auf 127.0.0.1) blockiert „git pull“ im Update.
# Bei der internen Installation legt deploy/docker-compose.intern.yml den Port fest – die Änderung ist dann überflüssig.
compose_only_port_change() {
  git diff --quiet -- docker-compose.yml 2>/dev/null && return 1
  grep -q "^COMPOSE_FILE=.*docker-compose.intern.yml" .env || return 1
  ! git diff -U0 -- docker-compose.yml | grep -E '^[+-] ' | grep -vqE '^[+-][[:space:]]+- "([0-9.]+:)?[0-9]+:3000"$'
}
check_compose() {
  if compose_only_port_change; then
    warn "docker-compose.yml lokal geändert (nur der Port) – blockiert Updates; wird bei „anwenden“ zurückgesetzt (Port regelt deploy/docker-compose.intern.yml)"
  elif ! git diff --quiet -- docker-compose.yml 2>/dev/null; then
    warn "docker-compose.yml lokal geändert – blockiert Updates. Ansehen: git diff docker-compose.yml"
  fi
}

summary() {
  echo
  if [ "$WARN" = 0 ]; then echo "Ergebnis: alles in Ordnung ($OK Prüfungen)."; else echo "Ergebnis: $WARN Punkt(e) offen, $OK in Ordnung."; fi
}

case "$MODE" in
  pruefen|status|"")
    check_port; check_compose; echo; check_app_url; echo; check_caddy; echo; check_others; summary
    if [ "$WARN" != 0 ]; then
      echo "Beheben (Port schließen + APP_URL auf https, mit automatischer Rücknahme bei Fehlern):"
      first="$(caddy_sites | head -1 | cut -d'|' -f1 | tr ',' ' ' | awk '{print $1}' | sed -E 's|^https?://||')"
      echo "  bash /opt/seller-system/deploy/absichern.sh anwenden https://${first:-deine-domain.de}"
    fi
    ;;

  anwenden)
    URL="$(printf '%s' "$ARG" | sed 's|/*$||')"
    printf '%s' "$URL" | grep -qE '^https://[a-z0-9.-]+$' || { echo "ABBRUCH: Bitte die https-Adresse angeben, z. B.:  … absichern.sh anwenden https://deine-domain.de"; exit 1; }
    HOST="$(url_host "$URL")"
    echo "==> Vorprüfung: $URL/login muss schon jetzt über https antworten"
    https_ok "$URL" || { echo "ABBRUCH: $URL/login antwortet nicht mit 200 – erst Caddy/DNS für $HOST einrichten. Nichts geändert."; exit 1; }
    target="$(caddy_sites | while IFS='|' read -r s t; do printf '%s' "$s" | tr ',' ' ' | grep -qwE "(https?://)?$HOST" && echo "$t"; done | head -1)"
    if [ -n "$target" ]; then
      th="$(printf '%s' "$target" | sed -E 's|^[a-z]+://||; s|:[0-9]+$||')"
      case "$th" in 127.0.0.1|localhost|"") echo "    Caddy leitet $HOST an $target weiter – passt." ;;
        *) echo "ABBRUCH: Caddy leitet $HOST an $target weiter. Nach dem Schließen ginge das nicht mehr."
           echo "  In $CADDYFILE „$target“ durch „127.0.0.1:$APP_PORT“ ersetzen, „systemctl reload caddy“, dann erneut starten. Nichts geändert."
           exit 1 ;;
      esac
    else
      echo "    Hinweis: $HOST nicht im Caddyfile gefunden – entscheidend ist die Prüfung nach der Umstellung (sonst automatische Rücknahme)."
    fi
    bak="backups/env-vor-absichern-$(date +%Y-%m-%d_%H-%M-%S)"
    cp .env "$bak" && chmod 600 "$bak" && echo "$bak" > backups/.absichern-letzte
    echo "==> Stelle um: Port $APP_PORT nur noch intern (127.0.0.1), APP_URL=$URL  (Sicherung der .env: $bak)"
    set_env BIND_IP 127.0.0.1
    if compose_only_port_change; then
      git diff -- docker-compose.yml > "$bak.docker-compose.diff"
      git checkout -- docker-compose.yml && echo "    docker-compose.yml: lokale Port-Änderung zurückgesetzt (gesichert: $bak.docker-compose.diff)"
    fi
    set_env APP_URL "$URL"
    compose up -d app
    for _ in $(seq 1 60); do curl -fs -o /dev/null --max-time 5 "http://127.0.0.1:$APP_PORT/login" && break; sleep 2; done
    echo "==> Prüfe"
    if ! https_ok "$URL"; then
      echo "  ✘ $URL/login antwortet nach der Umstellung nicht – hole den alten Stand zurück."
      cp "$bak" .env; compose up -d app
      echo "Zurückgenommen. Bitte die Ausgabe von  bash /opt/seller-system/deploy/absichern.sh  schicken."
      exit 1
    fi
    cp .env backups/env-sicherung && chmod 600 backups/env-sicherung
    check_port; check_compose; echo; check_app_url; echo; check_caddy; summary
    echo
    echo "Fertig. Ab jetzt nur noch $URL öffnen (Lesezeichen/App-Symbol mit http://…:$APP_PORT löschen, am Handy die App"
    echo "von $URL neu zum Startbildschirm hinzufügen). Einmal neu anmelden kann nötig sein."
    echo "Google-/Microsoft-Postfach oder -Kalender erst beim nächsten Neu-Verbinden betroffen – dort als Weiterleitungs-URI:"
    echo "  $URL/api/oauth/google/callback   und   $URL/api/oauth/microsoft/callback"
    echo "Rückgängig:  bash /opt/seller-system/deploy/absichern.sh zurueck"
    ;;

  zurueck)
    bak="$(cat backups/.absichern-letzte 2>/dev/null || true)"
    [ -n "$bak" ] && [ -f "$bak" ] || { echo "ABBRUCH: Keine Sicherung von „anwenden“ gefunden."; exit 1; }
    cp "$bak" .env && cp .env backups/env-sicherung && chmod 600 backups/env-sicherung
    compose up -d app
    echo "Stand vor „anwenden“ zurückgeholt ($bak)."
    ;;

  *)
    echo "Aufruf:  absichern.sh [pruefen] | anwenden https://deine-domain.de | zurueck"; exit 1 ;;
esac
