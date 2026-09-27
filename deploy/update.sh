#!/usr/bin/env bash
# Neuen Stand von GitHub holen und neu starten.
set -euo pipefail
cd /opt/seller-system
git pull --ff-only
if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose up -d --build; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml up -d --build; fi
docker image prune -f >/dev/null
echo "Aktualisiert."
