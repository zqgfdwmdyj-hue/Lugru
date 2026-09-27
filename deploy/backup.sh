#!/bin/sh
# Tägliche Sicherung der ganzen Datenbank (pg_dump, Custom-Format) nach /backups.
# Läuft im Container „backup" (gleiche Postgres-Version wie die Datenbank).
# Absprache mit der App über Dateien im Ordner: .jetzt (Sicherung anfordern), .keep (Anzahl),
# .letzte (Zeitpunkt der letzten erfolgreichen Sicherung), .status (ok oder Fehlermeldung).
set -u
cd "${BACKUP_DIR:-/backups}" || exit 1
while true; do
  now=$(date +%s)
  last=$(cat .letzte 2>/dev/null || echo 0)
  if [ -f .jetzt ] || [ $((now - last)) -ge 86400 ]; then
    f="sellersystem-auto-$(date +%Y-%m-%d_%H-%M-%S).dump"
    if err=$(pg_dump -Fc -f "$f.tmp" 2>&1) && mv "$f.tmp" "$f"; then
      date +%s > .letzte
      echo ok > .status
      echo "Sicherung erstellt: $f"
    else
      rm -f "$f.tmp"
      echo "$err" | tail -n 3 | tr '\n' ' ' > .status
      echo "Sicherung fehlgeschlagen: $err"
      # Nicht jede Minute neu versuchen – in einer Stunde wieder.
      echo $((now - 86400 + 3600)) > .letzte
    fi
    rm -f .jetzt
    keep=$(cat .keep 2>/dev/null || echo 30)
    ls -1t sellersystem-auto-*.dump 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm -f
  fi
  sleep 60
done
