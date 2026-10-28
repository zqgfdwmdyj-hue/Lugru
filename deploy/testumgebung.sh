#!/usr/bin/env bash
# Testumgebung neben dem echten Seller-System: eigene Datenbank (seller_test), erfundene Daten, Konten je Rolle.
# Mails werden abgefangen, Post/DHL/Amazon/eBay/Claude nur simuliert (Testdienste), alles andere nach außen gesperrt.
# Das echte System und seine Daten bleiben unberührt.
#
# Aufruf als root auf dem Server:
#   bash /opt/seller-system/deploy/testumgebung.sh an                     # einrichten bzw. starten (zeigt Zugang)
#   bash /opt/seller-system/deploy/testumgebung.sh zuruecksetzen          # Testdaten frisch anlegen
#   bash /opt/seller-system/deploy/testumgebung.sh domain test.deine-domain.de   # mit https von außen erreichbar
#   bash /opt/seller-system/deploy/testumgebung.sh pruefen                # Kurzprüfung (Testumgebung + echtes System getrennt?)
#   bash /opt/seller-system/deploy/testumgebung.sh status
#   bash /opt/seller-system/deploy/testumgebung.sh aus [--loeschen]       # anhalten (mit --loeschen: Test-Datenbank weg)
# Updates (update.sh) aktualisieren die Testumgebung automatisch mit.
set -uo pipefail
cd "${SELLER_DIR:-/opt/seller-system}"

MODE="${1:-status}"
ARG="${2:-}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
OVERRIDE="deploy/docker-compose.testumgebung.yml"
BEGIN="# seller-system-test BEGIN"
END="# seller-system-test END"

[ -f .env ] || { echo "ABBRUCH: .env fehlt – zuerst das echte System einrichten."; exit 1; }
mkdir -p backups
val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
compose() {
  if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose "$@"; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml "$@"; fi
}
active() { val COMPOSE_FILE | grep -q "docker-compose.testumgebung.yml"; }
rand() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
TEST_PORT="$(val TEST_PORT)"; TEST_PORT="${TEST_PORT:-3041}"
LOCAL="http://127.0.0.1:$TEST_PORT"

wait_up() {
  for _ in $(seq 1 90); do curl -fs -o /dev/null --max-time 5 "$LOCAL/login" && return 0; sleep 2; done
  echo "    Hinweis: Die Testumgebung antwortet noch nicht unter $LOCAL – „docker compose logs app-test“ ansehen."
  return 1
}
seed() {
  echo "==> Lege Testdaten an (setzt nur die Test-Datenbank seller_test zurück)"
  compose stop app-test >/dev/null 2>&1 || true
  compose run --rm --no-deps -e TESTDATEN_PASSWORT="$(val TEST_PASSWORT)" app-test npx tsx --conditions=react-server scripts/testdaten.ts || { echo "ABBRUCH: Testdaten konnten nicht angelegt werden."; exit 1; }
  compose up -d app-test testdienste
}
access() {
  local url; url="$(val TEST_URL)"
  echo
  echo "Testumgebung: ${url:-$LOCAL}"
  [ -z "$url" ] && echo "  (nur auf dem Server erreichbar – von außen mit:  testumgebung.sh domain test.deine-domain.de"
  [ -z "$url" ] && echo "   oder per SSH-Tunnel: ssh -L $TEST_PORT:127.0.0.1:$TEST_PORT root@<Server>, dann http://127.0.0.1:$TEST_PORT)"
  echo "  Konten: inhaber (Inhaber, Privat), lager (nur Palettenlager), buero (Start, Posteingang, Kalender, WaWi, Buchhaltung),"
  echo "          pruefer (nur ansehen: Paletten + WaWi), familie (nur Privat/Familie)"
  echo "  Passwort für alle Testkonten: $(val TEST_PASSWORT)"
  echo "  Abgefangene Mails und simulierte Aufrufe: Einstellungen → Testumgebung"
}
db_exists() { compose exec -T db psql -U seller -d seller -tAc "select 1 from pg_database where datname='seller_test'" 2>/dev/null | grep -q 1; }

case "$MODE" in
  an)
    cp .env "backups/env-vor-testumgebung-$(date +%Y-%m-%d_%H-%M-%S)" && chmod 600 backups/env-vor-testumgebung-*
    [ -n "$(val TEST_APP_SECRET)" ] || set_env TEST_APP_SECRET "$(rand 48)"
    [ -n "$(val TEST_PASSWORT)" ] || set_env TEST_PASSWORT "Test-$(rand 12)"
    [ -n "$(val TEST_PORT)" ] || set_env TEST_PORT "$TEST_PORT"
    if ! active; then
      cf="$(val COMPOSE_FILE)"; [ -n "$cf" ] || cf="docker-compose.yml:deploy/docker-compose.hetzner.yml"
      set_env COMPOSE_FILE "$cf:$OVERRIDE"
      echo "==> Testumgebung in COMPOSE_FILE eingetragen"
    fi
    chmod 600 .env
    avail="$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')"
    [ -n "$avail" ] && [ "$avail" -lt 400 ] && echo "    Hinweis: nur ${avail} MB Arbeitsspeicher frei – die Testumgebung braucht etwa 250 MB."
    echo "==> Datenbank seller_test"
    compose up -d db >/dev/null
    for _ in $(seq 1 30); do compose exec -T db pg_isready -U seller >/dev/null 2>&1 && break; sleep 2; done
    db_exists || compose exec -T db createdb -U seller seller_test || { echo "ABBRUCH: Test-Datenbank konnte nicht angelegt werden."; exit 1; }
    docker image inspect seller-system-app >/dev/null 2>&1 || { echo "==> Baue das Programm (einmalig)"; compose build app || exit 1; }
    compose up -d testdienste
    seed
    wait_up
    access
    ;;

  zuruecksetzen)
    active || { echo "Testumgebung ist aus – zuerst:  testumgebung.sh an"; exit 1; }
    seed
    wait_up
    access
    ;;

  domain)
    active || { echo "Testumgebung ist aus – zuerst:  testumgebung.sh an"; exit 1; }
    DOMAIN="$(printf '%s' "$ARG" | tr 'A-Z' 'a-z' | sed 's|^https\?://||; s|/.*$||')"
    printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "ABBRUCH: Bitte eine Adresse angeben, z. B.:  … testumgebung.sh domain test.deine-domain.de"; exit 1; }
    command -v caddy >/dev/null && [ -f "$CADDYFILE" ] || { echo "ABBRUCH: Webserver Caddy ($CADDYFILE) nicht gefunden."; exit 1; }
    IP="$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^(127|10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.' | head -1)"
    DNS_IPS="$( (getent ahostsv4 "$DOMAIN" 2>/dev/null || true) | awk '{print $1}' | sort -u | tr '\n' ' ')"
    if [ -z "$IP" ] || ! printf ' %s ' "$DNS_IPS" | grep -q " $IP "; then
      echo "ABBRUCH: $DOMAIN zeigt noch nicht auf diesen Server. Beim Domain-Anbieter: Typ A, Name ${DOMAIN%%.*}, Wert ${IP:-<IP>}."
      exit 1
    fi
    if sed "/^$BEGIN/,/^$END/d" "$CADDYFILE" | grep -qE "(^|[[:space:],])(https?://)?$DOMAIN([[:space:],:{]|$)"; then
      echo "ABBRUCH: $DOMAIN steht schon in $CADDYFILE (für etwas anderes)."; exit 1
    fi
    bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
    sed -i "/^$BEGIN/,/^$END/d" "$CADDYFILE"
    {
      echo ""
      echo "$BEGIN – Testumgebung (deploy/testumgebung.sh), erfundene Daten"
      echo "$DOMAIN {"
      echo "	encode gzip"
      echo "	header X-Robots-Tag \"noindex, nofollow\""
      echo "	reverse_proxy 127.0.0.1:$TEST_PORT"
      echo "}"
      echo "$END"
    } >> "$CADDYFILE"
    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
      cp "$bak" "$CADDYFILE"; echo "ABBRUCH: Caddy-Konfiguration ungültig – alte Fassung wiederhergestellt."; exit 1
    fi
    if systemctl is-active --quiet caddy 2>/dev/null; then systemctl reload caddy; else caddy reload --config "$CADDYFILE" --adapter caddyfile; fi
    set_env TEST_URL "https://$DOMAIN"
    compose up -d app-test
    wait_up
    for _ in $(seq 1 24); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/login")" = "200" ] && break; sleep 5; done
    access
    ;;

  pruefen)
    ok=0; bad=0
    chk() { if eval "$2"; then echo "  ✔ $1"; ok=$((ok + 1)); else echo "  ✘ $1"; bad=$((bad + 1)); fi; }
    active || { echo "Testumgebung ist aus."; exit 1; }
    wait_up # direkt nach einem Update/Neustart braucht sie kurz
    page="$(curl -s --max-time 10 "$LOCAL/login")"
    chk "Testumgebung antwortet ($LOCAL)" '[ -n "$page" ]'
    chk "Testumgebung zeigt das Banner „TESTUMGEBUNG“" 'grep -q "TESTUMGEBUNG" <<<"$page"'
    live="$(val APP_PORT)"; live="${live:-3020}"
    livepage="$(curl -s --max-time 10 "http://127.0.0.1:$live/login")"
    chk "Echtes System antwortet und zeigt KEIN Test-Banner (Normalbetrieb)" '[ -n "$livepage" ] && ! grep -q "TESTUMGEBUNG" <<<"$livepage"'
    chk "Testumgebung nutzt die Datenbank seller_test" '[ "$(compose exec -T app-test sh -c '"'"'echo "$DATABASE_URL"'"'"' | sed "s|.*/||")" = "seller_test" ]'
    chk "Echtes System nutzt NICHT seller_test" '[ "$(compose exec -T app sh -c '"'"'echo "$DATABASE_URL"'"'"' | sed "s|.*/||")" != "seller_test" ]'
    chk "Testdienste laufen" 'compose exec -T testdienste node -e "fetch(\"http://127.0.0.1:4010/__gesund\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"'
    chk "Verbindung nach außen ist gesperrt (Test-Abruf an example.com)" '[ "$(curl -s --max-time 20 "$LOCAL/api/public/testumgebung")" = "gesperrt" ]'
    echo; [ "$bad" = 0 ] && echo "Ergebnis: alles in Ordnung ($ok Prüfungen)." || echo "Ergebnis: $bad Punkt(e) offen."
    ;;

  aus)
    compose stop app-test testdienste >/dev/null 2>&1 || true
    compose rm -f app-test testdienste >/dev/null 2>&1 || true
    if [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE"; then
      bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
      sed -i "/^$BEGIN/,/^$END/d" "$CADDYFILE"
      if systemctl is-active --quiet caddy 2>/dev/null; then systemctl reload caddy; else caddy reload --config "$CADDYFILE" --adapter caddyfile; fi
    fi
    if active; then set_env COMPOSE_FILE "$(val COMPOSE_FILE | sed "s|:$OVERRIDE||")"; fi
    set_env TEST_URL ""
    if [ "$ARG" = "--loeschen" ]; then compose exec -T db dropdb -U seller --if-exists seller_test && echo "Test-Datenbank gelöscht."; fi
    echo "Testumgebung aus. Das echte System läuft unverändert weiter."
    ;;

  status|*)
    if active; then
      echo "Testumgebung: an"
      compose ps app-test testdienste 2>/dev/null | tail -n +2
      access
    else
      echo "Testumgebung: aus  (einrichten:  bash /opt/seller-system/deploy/testumgebung.sh an)"
    fi
    ;;
esac
