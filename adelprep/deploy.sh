#!/usr/bin/env bash
# Lädt die AdelPrep-Website per FTPS ins Hetzner-Webhosting (public_html von adelprep.de).
# Aufruf aus dem Repo-Ordner:  ./adelprep/deploy.sh
# Zugangsdaten stehen in adelprep/.env (wird nicht committet), Vorlage: adelprep/.env.example
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${ADELPREP_FTP_HOST:?ADELPREP_FTP_HOST fehlt (siehe .env.example)}"
: "${ADELPREP_FTP_USER:?ADELPREP_FTP_USER fehlt}"
: "${ADELPREP_FTP_PASSWORD:?ADELPREP_FTP_PASSWORD fehlt}"
ZIEL="${ADELPREP_FTP_DIR:-public_html}"

command -v lftp >/dev/null || { echo "lftp fehlt. Installieren mit: sudo apt install lftp"; exit 1; }

echo "Lade adelprep/public nach $ADELPREP_FTP_HOST:$ZIEL …"
lftp -u "$ADELPREP_FTP_USER","$ADELPREP_FTP_PASSWORD" "$ADELPREP_FTP_HOST" <<LFTP
set ftp:ssl-force true
set ftp:ssl-protect-data true
set ssl:verify-certificate true
mirror --reverse --only-newer --verbose public "$ZIEL"
bye
LFTP
echo "Fertig: https://adelprep.de"
