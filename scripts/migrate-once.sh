#!/usr/bin/env sh
# One-shot Prisma migration runner.
#
# Run this BEFORE deploying a new version of the app that includes new
# Prisma migrations. Do NOT add this to container startup — see Dockerfile
# comment and docs/ops/vps-triage.md §14.
#
# From the host (Dokploy / SSH):
#   docker run --rm --env-file=/path/to/.env \
#     <production-image> \
#     sh /app/scripts/migrate-once.sh
#
# Or interactively inside a running app container:
#   docker exec -it <web-container> sh /app/scripts/migrate-once.sh
#
# Exits 0 on success, non-zero on failure.

set -e

echo "[migrate-once] Running prisma migrate deploy..."
npx prisma migrate deploy

echo "[migrate-once] Done. Schema is up to date."
