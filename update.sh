#!/usr/bin/env bash
# Neuen Stand holen und neu starten (Home Assistant lädt dabei auch ein neues Image).
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
docker compose pull homeassistant
docker compose up -d --build
