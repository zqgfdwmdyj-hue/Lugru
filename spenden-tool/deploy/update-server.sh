#!/usr/bin/env bash
# Neuen Stand holen und neu starten – Daten (Datenbank mit allen Fotos) bleiben erhalten.
# Nie „docker compose down -v" ausführen: -v löscht die Datenbank.
set -euo pipefail
cd /opt/spenden-tool/spenden-tool

mkdir -p backups
if docker compose ps --status running db 2>/dev/null | grep -q db; then
  f="backups/spenden-vor-update-$(date +%Y-%m-%d_%H-%M-%S).dump"
  if docker compose exec -T db pg_dump -U spenden -Fc spenden > "$f.tmp" && mv "$f.tmp" "$f"; then
    echo "Sicherung vor dem Update: $f"
    ls -1t backups/spenden-vor-update-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f   # die letzten 5 behalten
  else
    rm -f "$f.tmp"; echo "ABBRUCH: Sicherung fehlgeschlagen – nichts geändert."; exit 1
  fi
fi

git -C /opt/spenden-tool pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Aktualisiert."
