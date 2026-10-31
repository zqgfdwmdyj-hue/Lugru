#!/usr/bin/env bash
# Testumgebung neben dem echten Seller-System: eigene Datenbank (seller_test), erfundene Daten, Konten je Rolle.
# Mails werden abgefangen, Post/DHL/Amazon/eBay/Claude nur simuliert (Testdienste), alles andere nach außen gesperrt.
# Das echte System und seine Daten bleiben unberührt.
#
# Aufruf als root auf dem Server:
#   bash /opt/seller-system/deploy/testumgebung.sh an                     # einrichten bzw. starten (zeigt Zugang)
#   bash /opt/seller-system/deploy/testumgebung.sh zuruecksetzen          # Testdaten frisch anlegen
#   bash /opt/seller-system/deploy/testumgebung.sh domain test.deine-domain.de --pruefen   # nur Voraussetzungen prüfen
#   bash /opt/seller-system/deploy/testumgebung.sh domain test.deine-domain.de   # mit https von außen erreichbar
#   bash /opt/seller-system/deploy/testumgebung.sh domain aus                    # öffentliche Adresse wieder entfernen
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
# Für die Domain: öffentliche IP dieses Servers, echtes System, Caddy neu laden, nur-lokal-Prüfung
server_ip() { printf '%s' "${SERVER_IP:-$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^(127|10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.' | head -1)}"; }
LIVE_PORT="$(val APP_PORT)"; LIVE_PORT="${LIVE_PORT:-3020}"
prod_url() { local u; u="$(val APP_URL)"; case "$u" in https://*) printf '%s' "${u%/}" ;; *) printf 'http://127.0.0.1:%s' "$LIVE_PORT" ;; esac; }
# Echtes System antwortet (200) und zeigt KEIN Test-Banner.
prod_ok() { local p; p="$(curl -fs --max-time 15 "$(prod_url)/login")" && [ -n "$p" ] && ! grep -q "TESTUMGEBUNG" <<<"$p"; }
# Port der Testumgebung hört nur auf 127.0.0.1 (nie 0.0.0.0).
only_local() { local a; a="$(ss -Htln "sport = :$TEST_PORT" 2>/dev/null | awk '{print $4}' | sed "s/:$TEST_PORT\$//" | sort -u)"; [ -n "$a" ] && ! grep -qvE '^(127\.0\.0\.1|\[::1\])$' <<<"$a"; }
reload_caddy() { if systemctl is-active --quiet caddy 2>/dev/null; then systemctl reload caddy; else caddy reload --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; fi; }
dns_ips() { (getent ahostsv4 "$1" 2>/dev/null || true) | awk '{print $1}' | sort -u | tr '\n' ' '; }
# Öffentliche Adresse: gültiges Zertifikat (curl prüft es), Banner, noindex, ohne Anmeldung kein Inhalt.
public_page() { curl -fs --max-time 15 "$1/login"; }

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
    # testumgebung.sh domain test.deine-domain.de [--pruefen]   (--pruefen: nur Voraussetzungen, nichts ändern)
    # testumgebung.sh domain aus                                (Adresse wieder entfernen)
    if [ "$ARG" = "aus" ]; then
      if [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE"; then
        bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
        sed -i "/^$BEGIN/,/^$END/d" "$CADDYFILE"; reload_caddy
      fi
      set_env TEST_URL ""
      active && compose up -d app-test >/dev/null 2>&1
      echo "Öffentliche Adresse entfernt – Testumgebung nur noch auf dem Server ($LOCAL)."
      prod_ok && echo "Echtes System antwortet weiter normal." || echo "ACHTUNG: echtes System antwortet nicht – „docker compose ps“ und Caddy prüfen."
      exit 0
    fi
    DOMAIN="$(printf '%s' "$ARG" | tr 'A-Z' 'a-z' | sed 's|^https\?://||; s|/.*$||')"
    printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "ABBRUCH: Bitte eine Adresse angeben, z. B.:  … testumgebung.sh domain test.deine-domain.de"; exit 1; }
    NUR_PRUEFEN=0; [ "${3:-}" = "--pruefen" ] && NUR_PRUEFEN=1
    IP="$(server_ip)"; DNS_IPS="$(dns_ips "$DOMAIN")"
    fehlt=0
    pre() { if eval "$2"; then echo "  ✔ $1"; else echo "  ✘ $1${3:+ – $3}"; fehlt=1; fi; }
    active && wait_up >/dev/null # nach Update/Neustart kurz warten
    echo "Voraussetzungen für https://$DOMAIN:"
    pre "Testumgebung läuft ($LOCAL)" 'active && curl -fs -o /dev/null --max-time 10 "$LOCAL/login"' "zuerst: testumgebung.sh an"
    pre "Port $TEST_PORT nur lokal (127.0.0.1)" 'only_local' "darf nicht nach außen offen sein"
    pre "Webserver Caddy auf dem Server ($CADDYFILE)" 'command -v caddy >/dev/null && [ -f "$CADDYFILE" ]' "Caddy fehlt – nichts geändert"
    pre "DNS: $DOMAIN zeigt auf diesen Server (${IP:-?})" '[ -n "$IP" ] && printf " %s " "$DNS_IPS" | grep -q " $IP "' "DNS zeigt: ${DNS_IPS:-keinen Eintrag}. Beim Domain-Anbieter anlegen: Typ A, Name ${DOMAIN%%.*}, Wert ${IP:-<IP>}"
    pre "$DOMAIN nicht schon für etwas anderes im Caddyfile" '! { [ -f "$CADDYFILE" ] && sed "/^$BEGIN/,/^$END/d" "$CADDYFILE" | grep -qE "(^|[[:space:],])(https?://)?$DOMAIN([[:space:],:{]|$)"; }'
    pre "Echtes System antwortet normal ($(prod_url))" 'prod_ok' "erst das echte System in Ordnung bringen"
    pre "Caddy hört auf Port 80 und 443 (für das Zertifikat)" 'ss -Htln "sport = :443" | grep -q . && ss -Htln "sport = :80" | grep -q .'
    [ "$fehlt" = 0 ] || { echo "ABBRUCH: Voraussetzungen fehlen – nichts geändert."; exit 1; }
    if [ "$NUR_PRUEFEN" = 1 ]; then echo "Alles bereit. Einrichten mit:  testumgebung.sh domain $DOMAIN"; exit 0; fi

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
      cp "$bak" "$CADDYFILE"; echo "ABBRUCH: Caddy-Konfiguration ungültig – alte Fassung wiederhergestellt, nichts geändert."; exit 1
    fi
    reload_caddy || { cp "$bak" "$CADDYFILE"; reload_caddy; echo "ABBRUCH: Caddy ließ sich nicht neu laden – alte Fassung wiederhergestellt."; exit 1; }
    sleep 2
    # Das echte System muss unverändert weiterlaufen – sonst sofort zurück.
    if ! prod_ok; then
      cp "$bak" "$CADDYFILE"; reload_caddy
      echo "ABBRUCH: Das echte System antwortete nach der Änderung nicht – alte Caddy-Fassung wiederhergestellt."; exit 1
    fi
    echo "==> Caddy leitet https://$DOMAIN an 127.0.0.1:$TEST_PORT weiter (Sicherung: $bak)"
    set_env TEST_URL "https://$DOMAIN"
    compose up -d app-test >/dev/null 2>&1
    wait_up
    echo "==> Warte auf das Zertifikat für $DOMAIN (bis 2 Minuten)"
    for _ in $(seq 1 24); do public_page "https://$DOMAIN" >/dev/null && break; sleep 5; done
    public_page "https://$DOMAIN" >/dev/null || echo "    Hinweis: https://$DOMAIN antwortet noch nicht – in ein paar Minuten „testumgebung.sh pruefen“ (Caddy-Log: journalctl -u caddy -n 50)."
    access
    echo
    exec bash "$0" pruefen
    ;;

  pruefen)
    ok=0; bad=0
    chk() { if eval "$2"; then echo "  ✔ $1"; ok=$((ok + 1)); else echo "  ✘ $1"; bad=$((bad + 1)); fi; }
    active || { echo "Testumgebung ist aus."; exit 1; }
    wait_up # direkt nach einem Update/Neustart braucht sie kurz
    for _ in $(seq 1 60); do curl -fs -o /dev/null --max-time 5 "http://127.0.0.1:$LIVE_PORT/login" && break; sleep 2; done # echtes System ebenso
    page="$(curl -s --max-time 10 "$LOCAL/login")"
    chk "Testumgebung antwortet ($LOCAL)" '[ -n "$page" ]'
    chk "Testumgebung zeigt das Banner „TESTUMGEBUNG“" 'grep -q "TESTUMGEBUNG" <<<"$page"'
    live="$(val APP_PORT)"; live="${live:-3020}"
    livepage="$(curl -s --max-time 10 "http://127.0.0.1:$live/login")"
    chk "Echtes System antwortet und zeigt KEIN Test-Banner (Normalbetrieb)" '[ -n "$livepage" ] && ! grep -q "TESTUMGEBUNG" <<<"$livepage"'
    [ "$(prod_url)" != "http://127.0.0.1:$LIVE_PORT" ] && chk "Echtes System unter $(prod_url) wie gewohnt (ohne Test-Banner)" 'prod_ok'
    chk "Port $TEST_PORT nur lokal erreichbar (127.0.0.1)" 'only_local'
    chk "Testumgebung nutzt die Datenbank seller_test" '[ "$(compose exec -T app-test sh -c '"'"'echo "$DATABASE_URL"'"'"' | sed "s|.*/||")" = "seller_test" ]'
    chk "Echtes System nutzt NICHT seller_test" '[ "$(compose exec -T app sh -c '"'"'echo "$DATABASE_URL"'"'"' | sed "s|.*/||")" != "seller_test" ]'
    chk "Testdienste laufen" 'compose exec -T testdienste node -e "fetch(\"http://127.0.0.1:4010/__gesund\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"'
    chk "Verbindung nach außen ist gesperrt (Test-Abruf an example.com)" '[ "$(curl -s --max-time 20 "$LOCAL/api/public/testumgebung")" = "gesperrt" ]'
    url="$(val TEST_URL)"
    if [ -n "$url" ]; then
      pub="$(public_page "$url")"
      chk "$url antwortet mit gültigem Zertifikat" '[ -n "$pub" ]'
      chk "$url zeigt das Banner „TESTUMGEBUNG“" 'grep -q "TESTUMGEBUNG" <<<"$pub"'
      chk "$url ist für Suchmaschinen gesperrt (noindex)" 'curl -sI --max-time 10 "$url/login" | grep -qi "^x-robots-tag:.*noindex"'
      chk "$url zeigt ohne Anmeldung nichts (Weiterleitung zur Anmeldung)" 'curl -s -o /dev/null -w "%{redirect_url}" --max-time 10 "$url/auftraege" | grep -q "/login"'
      chk "$url: Verbindung nach außen gesperrt" '[ "$(curl -s --max-time 20 "$url/api/public/testumgebung")" = "gesperrt" ]'
    fi
    echo; [ "$bad" = 0 ] && echo "Ergebnis: alles in Ordnung ($ok Prüfungen)." || { echo "Ergebnis: $bad Punkt(e) offen."; exit 1; }
    ;;

  aus)
    compose stop app-test testdienste >/dev/null 2>&1 || true
    compose rm -f app-test testdienste >/dev/null 2>&1 || true
    if [ -f "$CADDYFILE" ] && grep -qF "$BEGIN" "$CADDYFILE"; then
      bak="backups/Caddyfile-$(date +%Y-%m-%d_%H-%M-%S)"; cp "$CADDYFILE" "$bak"
      sed -i "/^$BEGIN/,/^$END/d" "$CADDYFILE"; reload_caddy
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
