#!/usr/bin/env bash
# Runs on the Hetzner server from /opt/client-billing after the workflow checks out the commit.
# Usage: deploy/deploy-remote.sh <production|staging>
#
# Builds the image, snapshots the SQLite database from the running container
# (kept in the host backup dir), swaps only the chosen app service, then waits for health.
# The other environment and Caddy are left untouched, except that Caddy is started if absent.
set -euo pipefail

ENV_NAME="${1:?usage: deploy-remote.sh <production|staging>}"
case "$ENV_NAME" in production | staging) ;; *) echo "unknown env: $ENV_NAME" >&2; exit 2 ;; esac

cd "$(dirname "$0")/.."
SERVICE="app-$ENV_NAME"
C=(docker compose -f deploy/docker-compose.yml)
BACKUP_DIR="${BACKUP_DIR:-/opt/client-billing/backups/$ENV_NAME}"
KEEP_BACKUPS=14

for f in ".env.$ENV_NAME" deploy/proxy.env; do
  [ -f "$f" ] || { echo "missing $f on the server; see deploy/README.md" >&2; exit 1; }
done

"${C[@]}" build "$SERVICE"

if [ -n "$("${C[@]}" ps -q --status running "$SERVICE")" ]; then
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  "${C[@]}" exec -T "$SERVICE" node -e "
    const { DatabaseSync } = require('node:sqlite');
    const fs = require('node:fs');
    const db = new DatabaseSync(process.env.CLIENT_BILLING_DATABASE);
    fs.mkdirSync('/tmp/backup', { recursive: true });
    db.exec(\"VACUUM INTO '/tmp/backup/pre-deploy.sqlite'\");
    db.close();
  "
  "${C[@]}" cp "$SERVICE:/tmp/backup/pre-deploy.sqlite" "$BACKUP_DIR/pre-deploy-$STAMP.sqlite"
  "${C[@]}" exec -T "$SERVICE" rm -f /tmp/backup/pre-deploy.sqlite
  [ -s "$BACKUP_DIR/pre-deploy-$STAMP.sqlite" ] || { echo "backup is empty; aborting" >&2; exit 1; }
  echo "Backup written: $BACKUP_DIR/pre-deploy-$STAMP.sqlite"
  ls -1t "$BACKUP_DIR"/pre-deploy-*.sqlite | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
else
  echo "No running $SERVICE; skipping backup (first deploy)"
fi

"${C[@]}" up -d --no-deps "$SERVICE"
"${C[@]}" up -d --no-deps caddy

for _ in $(seq 1 30); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' "$("${C[@]}" ps -q "$SERVICE")")"
  [ "$STATUS" = healthy ] && { "${C[@]}" ps; exit 0; }
  sleep 2
done
echo "$SERVICE did not become healthy" >&2
"${C[@]}" logs --tail 50 "$SERVICE" >&2
exit 1
