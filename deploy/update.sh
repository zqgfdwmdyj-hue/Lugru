#!/usr/bin/env bash
# Neuen Stand von GitHub holen und neu starten.
set -euo pipefail
cd /opt/seller-system
git pull --ff-only
docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml up -d --build
docker image prune -f >/dev/null
echo "Aktualisiert."
