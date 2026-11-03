#!/usr/bin/env bash
# Pull the latest Kess Cloud from GitHub and restart it. Data and certificates are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f deploy/docker-compose.yml up -d --build
docker image prune -f >/dev/null
echo "Kess Cloud updated to $(git log -1 --format='%h %s')"
