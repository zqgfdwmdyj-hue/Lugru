#!/usr/bin/env bash
# Sichert alle Reiseplaner-Daten (Reisen, Konten, Fotos) als .tar.gz nach /opt/reiseplaner-sicherungen.
# Aufruf:  bash sichern.sh        (z. B. täglich per cron)
set -euo pipefail
ZIEL=/opt/reiseplaner-sicherungen
mkdir -p "$ZIEL" && chmod 700 "$ZIEL"
DATEI="reiseplaner-$(date +%Y-%m-%d_%H-%M).tar.gz"
docker run --rm -v reiseplaner_reisedaten:/daten:ro -v "$ZIEL":/ziel alpine tar czf "/ziel/$DATEI" -C /daten .
chmod 600 "$ZIEL/$DATEI"
ls -1t "$ZIEL"/reiseplaner-*.tar.gz | tail -n +15 | xargs -r rm -f   # die letzten 14 behalten
echo "Sicherung: $ZIEL/$DATEI"
