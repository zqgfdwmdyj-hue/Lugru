#!/usr/bin/env bash
# Neuen Stand von GitHub holen und neu starten – Daten und Anbindungen bleiben erhalten.
#
# Wo liegt was?
#   Datenbank (alle Daten, Anbindungen, Postfächer …)  → Docker-Volume „seller-system_dbdata"
#   Schlüssel für die gespeicherten Zugangsdaten       → APP_SECRET in /opt/seller-system/.env
#   Sicherungen                                        → /opt/seller-system/backups
# Ein Update tauscht nur das Programm aus. Nie „docker compose down -v" ausführen (-v löscht die Datenbank)
# und APP_SECRET nie ändern (sonst sind gespeicherte Passwörter/Tokens nicht mehr lesbar).
set -euo pipefail
cd /opt/seller-system

compose() {
  if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose "$@"; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml "$@"; fi
}

# 1. .env muss da sein und der Schlüssel derselbe wie beim letzten Update.
if [ ! -f .env ] || ! grep -q "^APP_SECRET=" .env; then
  echo "ABBRUCH: .env mit APP_SECRET fehlt."
  echo "Letzte Kopie: backups/env-sicherung (zurückholen mit: cp backups/env-sicherung .env)"
  exit 1
fi
mkdir -p backups
fingerprint=$(grep "^APP_SECRET=" .env | sha256sum | cut -c1-16)
if [ -f backups/.schluessel ] && [ "$(cat backups/.schluessel)" != "$fingerprint" ]; then
  echo "ABBRUCH: APP_SECRET in .env hat sich seit dem letzten Update geändert."
  echo "Mit dem neuen Schlüssel wären alle gespeicherten Zugangsdaten (Amazon, eBay, Postfächer, Kalender …) unlesbar."
  echo "Alte .env zurückholen:  cp backups/env-sicherung .env   – und das Update erneut starten."
  echo "Nur wenn der Wechsel wirklich gewollt ist:  rm backups/.schluessel"
  exit 1
fi
echo "$fingerprint" > backups/.schluessel
cp .env backups/env-sicherung && chmod 600 backups/env-sicherung

# 2. Sicherung der Datenbank vor dem Update (falls die Datenbank läuft).
if compose ps --status running db 2>/dev/null | grep -q db; then
  f="backups/sellersystem-vor-update-$(date +%Y-%m-%d_%H-%M-%S).dump"
  if compose exec -T db pg_dump -U seller -Fc seller > "$f.tmp" && mv "$f.tmp" "$f"; then
    echo "Sicherung vor dem Update: $f"
    ls -1t backups/sellersystem-vor-update-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f   # die letzten 5 behalten
  else
    rm -f "$f.tmp"
    echo "ABBRUCH: Sicherung vor dem Update fehlgeschlagen – nichts geändert."
    exit 1
  fi
fi

# 3. Neuen Stand holen und starten. Die Datenbank-Änderungen (Migrationen) laufen beim Start automatisch
#    und ergänzen nur – vorhandene Daten bleiben.
git pull --ff-only
compose up -d --build
docker image prune -f >/dev/null
# Build-Reste älter als 3 Tage wegräumen (neuere bleiben, damit das nächste Update schnell baut).
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
echo "Aktualisiert. Daten und Anbindungen sind unverändert."
