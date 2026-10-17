# Deploying to Hetzner

This mirrors the nexio_stock flow: a manually dispatched GitHub Actions workflow SSHes to the Hetzner box, checks out the commit, and runs a script that builds with Docker Compose and swaps one environment. nexio_stock and cwerp use no container registry, so neither does this repo. The image is built on the server. CI only checks that it builds.

## Layout

- `Dockerfile` is a multi-stage Next.js `standalone` build on `node:22-bookworm-slim`. The app uses `node:sqlite`, which needs Node 22.
- `deploy/docker-compose.yml` has `app-staging`, `app-production` and `caddy`. Each app has its own named volume mounted at `/data`.
- `deploy/Caddyfile` terminates TLS (automatic certificates) and proxies each domain to its app on port 3000.
- `deploy/deploy-remote.sh <staging|production>` runs on the server.
- `.github/workflows/deploy.yml` is `workflow_dispatch` with an environment choice.

## One-time server setup

1. Install Docker with the Compose plugin. Clone this repo to `/opt/client-billing` and give the deploy user read access to the repo.
2. Create `/opt/client-billing/.env.staging` and `.env.production` from `.env.example`. These files are untracked.
3. Create `/opt/client-billing/deploy/proxy.env` from `deploy/proxy.env.example` with the two domains. Point both DNS records at the server.
4. In the GitHub repo, create environments `staging` and `production` and add the secrets `HETZNER_DEPLOY_KEY`, `HETZNER_HOST` and `HETZNER_USER`. Add required reviewers to `production` if you want a gate.

## Deploying

Run the Deploy workflow from the Actions tab and pick the environment. The workflow deploys the commit of the ref you dispatch it on. A deploy builds the image, backs up the database, replaces only that environment's app container, starts Caddy if it is not running, and fails unless `/api/health` reports healthy.

`GET /api/health` returns `{"ok":true}` with no authentication and reads no tenant data.

## Database and backups

The database is still SQLite. It lives in the named volume `client-billing_<env>_data` (that is, `staging_data` or `production_data`), at `/data/client-billing.sqlite`. On the first start of an empty volume the app copies `seed/initial-data.sqlite` unless `CLIENT_BILLING_SEED_MODE=demo`. The Postgres migration is a separate issue.

Backups:

- Every deploy to a running environment writes a consistent snapshot (`VACUUM INTO`) to `/opt/client-billing/backups/<env>/pre-deploy-<timestamp>.sqlite` on the host. The last 14 are kept. Override the directory with `BACKUP_DIR`.
- The deploy aborts if the snapshot fails, so the running container is left untouched.
- There is no scheduled backup between deploys. Take one manually with the commands in `deploy-remote.sh`, or copy the volume (`docker run --rm -v client-billing_production_data:/data -v "$PWD":/out alpine cp /data/client-billing.sqlite /out/`) while the app is stopped.
- To restore, stop the app service, copy the snapshot over `/data/client-billing.sqlite` in the volume, and start the service.
- Back the host backup directory up off the server. A single Hetzner box is the only copy otherwise.

## Not verified here

The workflow, the server script and TLS issuance have not run against a real server or real secrets. The first staging deploy is the real test.
