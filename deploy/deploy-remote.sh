#!/usr/bin/env bash
# Runs on the Hetzner server from /opt/client-billing after the workflow checks out the commit.
# Usage: deploy/deploy-remote.sh <production|staging>
#
# The nexio_stock flow on Postgres (ADR 0001, unit D11): build the app and migrator images, start the
# environment's database, apply db/roles.sql, write a pg_dump into the host backup dir, migrate in a one-off
# container, check the app's two roles can sign in, and only then swap the app container and wait for health.
# Any failed step exits (set -e) before the swap, so the running app is left untouched. The other environment
# is never touched, and Caddy is only started if absent.
set -euo pipefail

ENV_NAME="${1:?usage: deploy-remote.sh <production|staging>}"
case "$ENV_NAME" in production | staging) ;; *) echo "unknown env: $ENV_NAME" >&2; exit 2 ;; esac

cd "$(dirname "$0")/.."
SERVICE="app-$ENV_NAME"
DB="db-$ENV_NAME"
MIGRATOR="migrator-$ENV_NAME"
C=(docker compose -f deploy/docker-compose.yml)
BACKUP_DIR="${BACKUP_DIR:-/opt/client-billing/backups/$ENV_NAME}"
KEEP_BACKUPS=14

for f in ".env.$ENV_NAME" ".env.$ENV_NAME.db" deploy/proxy.env; do
  [ -f "$f" ] || { echo "missing $f on the server; see deploy/README.md" >&2; exit 1; }
done

"${C[@]}" build "$SERVICE"
"${C[@]}" --profile migrate build "$MIGRATOR"
"${C[@]}" up -d --wait "$DB"

# The roles are idempotent. Their passwords come from .env.<env>.db inside the database container.
"${C[@]}" exec -T "$DB" sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v owner_password="${CBS_OWNER_PASSWORD:?set CBS_OWNER_PASSWORD in .env.<env>.db}" \
  -v app_password="${CBS_APP_PASSWORD:?set CBS_APP_PASSWORD in .env.<env>.db}" \
  -v platform_password="${CBS_PLATFORM_PASSWORD:?set CBS_PLATFORM_PASSWORD in .env.<env>.db}"' < db/roles.sql

# The SQLite snapshot stays until ADR 0001 unit D12 removes it. It runs only if a running app still has the file.
if [ -n "$("${C[@]}" ps -q --status running "$SERVICE")" ] && "${C[@]}" exec -T "$SERVICE" sh -c 'test -f "${CLIENT_BILLING_DATABASE:-/nonexistent}"'; then
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
  [ -s "$BACKUP_DIR/pre-deploy-$STAMP.sqlite" ] || { echo "SQLite backup is empty; aborting" >&2; exit 1; }
  echo "SQLite backup written: $BACKUP_DIR/pre-deploy-$STAMP.sqlite"
  ls -1t "$BACKUP_DIR"/pre-deploy-*.sqlite | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
fi

# A dump before every migration, as the container superuser (ADR 0001, Consequences), in the custom format that
# the restore drill of unit D13 reads.
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
"${C[@]}" exec -T "$DB" sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$DUMP"
[ -s "$DUMP" ] || { echo "pg_dump wrote nothing; aborting" >&2; rm -f "$DUMP"; exit 1; }
echo "Backup written: $DUMP ($(du -h "$DUMP" | cut -f1))"
ls -1t "$BACKUP_DIR"/pre-deploy-*.dump | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

"${C[@]}" --profile migrate run --rm --no-deps -T "$MIGRATOR"

# The app's health check reads no data, so a wrong password in .env.<env> would only show on the first real
# request. Sign in as both runtime roles from the migrator image before the swap instead.
"${C[@]}" --profile migrate run --rm --no-deps -T "$MIGRATOR" node -e "
  const pg = require('pg');
  const check = async (name) => {
    const url = process.env[name];
    if (!url) throw new Error(name + ' is not set in .env.$ENV_NAME');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const { rows } = await client.query('SELECT current_user AS role');
    await client.end();
    console.log(name + ' signs in as ' + rows[0].role);
  };
  check('DATABASE_URL').then(() => check('DATABASE_PLATFORM_URL')).catch((error) => { console.error(error.message); process.exit(1); });
"

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
