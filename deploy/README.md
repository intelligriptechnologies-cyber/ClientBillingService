# Deploying to Hetzner

This mirrors the nexio_stock flow: a manually dispatched GitHub Actions workflow SSHes to the Hetzner box, checks out the commit, and runs a script that builds with Docker Compose and swaps one environment. nexio_stock and cwerp use no container registry, so neither does this repo. The image is built on the server. CI only checks that it builds.

## Layout

- `Dockerfile` is a multi-stage Next.js `standalone` build on `node:22-bookworm-slim`. The runner stage also installs headless Chromium (see PDF rendering). The `migrator` stage carries `node-pg-migrate`, `db/migrations`, the demo seed and the SQLite import, because the standalone output trims `node_modules`.
- `deploy/docker-compose.yml` has, per environment, `app-<env>`, `db-<env>` (`postgres:16-alpine` with its own volume `<env>_pgdata`) and `migrator-<env>` (profile `migrate`, run once per deploy), plus one `caddy`. Each database sits on an internal network, `<env>-db`, that only its own app and migrator join. It publishes no port. The apps also sit on the default network, which Caddy shares.
- `deploy/Caddyfile` terminates TLS (automatic certificates) and proxies each domain to its app on port 3000.
- `deploy/deploy-remote.sh <staging|production>` runs on the server.
- `.github/workflows/deploy.yml` is `workflow_dispatch` with an environment choice.

## One-time server setup

1. Install Docker with the Compose plugin. Clone this repo to `/opt/client-billing` and give the deploy user read access to the repo.
2. Create `/opt/client-billing/.env.staging` and `.env.production` from `.env.example`, with `DATABASE_URL` and `DATABASE_PLATFORM_URL` pointing at `db-<env>:5432/cbs`. Create `.env.staging.db` and `.env.production.db` with `POSTGRES_PASSWORD`, `CBS_OWNER_PASSWORD`, `CBS_APP_PASSWORD`, `CBS_PLATFORM_PASSWORD` and `DATABASE_MIGRATE_URL`, as the end of `.env.example` describes. Pick new passwords per environment. These files are untracked.
3. Create `/opt/client-billing/deploy/proxy.env` from `deploy/proxy.env.example` with the two domains. Point both DNS records at the server.
4. In the GitHub repo, create environments `staging` and `production` and add the secrets `HETZNER_DEPLOY_KEY`, `HETZNER_HOST` and `HETZNER_USER`. Add required reviewers to `production` if you want a gate.

## Deploying

Run the Deploy workflow from the Actions tab and pick the environment. The workflow deploys the commit of the ref you dispatch it on. `deploy-remote.sh` then runs these steps in order, and any failure stops it before the app is swapped:

1. Build the app and migrator images.
2. Start `db-<env>` and wait until it is healthy.
3. Apply `db/roles.sql` with the role passwords from `.env.<env>.db`. A second run changes nothing.
4. Write `pg_dump -Fc` of the database, as the container superuser, to `/opt/client-billing/backups/<env>/pre-deploy-<timestamp>.dump`, and keep the last 14. An empty dump aborts the deploy.
5. Run the migrator once. It applies pending files in `db/migrations` as `cbs_owner` and records them in `pgmigrations`.
6. Sign in as `DATABASE_URL` and `DATABASE_PLATFORM_URL` from the migrator image. The app's health check reads no data, so a wrong password would otherwise show only on the first real request.
7. Replace only that environment's app container, start Caddy if it is not running, and fail unless `/api/health` reports healthy.

The first deploy of an environment migrates an empty database and seeds nothing. To load the initial data once, run the SQLite import from the migrator image (see `seed/README.md`):

```sh
docker compose -f deploy/docker-compose.yml --profile migrate run --rm migrator-production node scripts/import-sqlite.ts seed/initial-data.sqlite
```

`GET /api/health` returns `{"ok":true}` with no authentication and reads no tenant data.

## PDF rendering

Invoice and bulk-preview PDFs are printed by headless Chromium through `playwright-core`, from the same HTML the invoice page previews. `playwright-core` is a production dependency. The runner stage of the `Dockerfile` runs `playwright-core install --with-deps chromium-headless-shell` as root, which installs the browser into `/ms-playwright` and the Debian libraries and fonts it needs (the fonts include the rupee sign). This adds a few hundred MB to the image and about a minute to the build.

- One Chromium is started on the first PDF request and reused. At most two pages render at once, and a render that takes over 35 seconds is abandoned and the browser is replaced.
- If Chromium cannot start, the download route answers `503` with a message saying so. The rest of the app is unaffected.
- `CLIENT_BILLING_CHROMIUM_NO_SANDBOX=1` is set in the image because the container runs as the unprivileged `node` user, and many Linux hosts' default Docker profile blocks Chromium's sandbox. Set it to `0` to turn the sandbox back on. It rendered both ways on Docker Desktop, but nobody has run the image on the Hetzner host. The browser only prints HTML the app generated and escaped, with JavaScript disabled and the network offline.
- `CLIENT_BILLING_CHROMIUM_PATH` points the app at a different Chromium executable. Outside Docker run `npx playwright install chromium` once.
- Budget roughly 300 MB of RAM for the browser while a PDF renders.

## Database and backups

The database is Postgres 16, one container per environment, with its data in the named volume `client-billing_<env>_pgdata`. The app connects as `cbs_app` and `cbs_platform`. The migrator, the demo seed and the SQLite import connect as `cbs_owner` (ADR 0001, Consequences). The app refuses to start without `DATABASE_URL` and `DATABASE_PLATFORM_URL`, unless `CLIENT_BILLING_STORE=sqlite` asks for the legacy SQLite store, which ADR 0001 unit D12 deletes. The app volume at `/data` is left from the SQLite store and goes with it.

Backups:

- Every deploy writes a `pg_dump -Fc` before it migrates, to `/opt/client-billing/backups/<env>/pre-deploy-<timestamp>.dump` on the host. The last 14 are kept. Override the directory with `BACKUP_DIR`.
- The deploy aborts if the dump fails or is empty, so the running container is left untouched.
- If a running app still holds a SQLite file, the deploy also writes the old `VACUUM INTO` snapshot beside the dumps, until unit D12 removes it.
- There is no scheduled backup between deploys yet. ADR 0001 unit D13 adds the nightly dump, `pg_dumpall --roles-only`, the Storage Box copy and the restore drill. Take one manually with `docker compose -f deploy/docker-compose.yml exec -T db-production sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.dump`.
- To restore a dump, stop the app service and run `pg_restore --clean --if-exists -U postgres -d cbs` inside `db-<env>` with the file on stdin, then start the service. No restore has been rehearsed yet. That is D13's drill.
- Back the host backup directory up off the server. A single Hetzner box is the only copy otherwise.

## Not verified here

The workflow, the server script and TLS issuance have not run against a real server or real secrets. `deploy-remote.sh` itself has not run end to end anywhere, because it tags global images and binds ports 80 and 443. Its database steps (database up, roles, dump, migrator, role sign-in) ran twice on Docker Desktop under a separate Compose project, with the migrator image built from this `Dockerfile`. The second run's dump held the schema and the migrator had nothing to do. The SQLite import also ran twice from the migrator image. The app build, the app swap and Caddy did not run. The first staging deploy is the real test.
