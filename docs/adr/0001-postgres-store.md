# 0001. Move the store to Postgres with SQL migrations and row-level security

- Status: Proposed
- Date: 2026-10-17
- Issue: #35 (matrix row `db`). Also covers rows `backup`, `isolation` and `tenancy`, and the database half of `deploy`.
- Related: [0002](0002-auth-and-sessions.md) depends on this ADR for the `users` columns, `api_tokens` and `audit_events`. Sign-in moved to Authelia, so this ADR builds no password or session tables.

## Decision

1. Run Postgres 16 (`postgres:16-alpine`) in Docker on the Hetzner host, one database container per environment. This is the nexio_stock layout. The owner accepted self-hosting on 2026-10-17.
2. Use `pg` (node-postgres) 8.x as the driver and write raw SQL. Add no ORM and no query builder.
3. Use `node-pg-migrate` 9.x with plain `.sql` migration files under `db/migrations/`. The `pgmigrations` table records history. Migrations run in a one-off container before the app container is swapped. The deploy takes a `pg_dump` before every migration.
4. Isolate tenants in three layers.
   1. Every tenant-owned row has a `tenant_id`, child tables included.
   2. Every foreign key between tenant tables is composite, as in `(tenant_id, customer_id) REFERENCES customers (tenant_id, id)`.
   3. Every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY`, with a policy on `current_setting('app.tenant_id', true)`.
   The app connects as a role that owns nothing and has no `BYPASSRLS`. Writing correct queries is still expected. It is no longer what keeps tenants apart.
5. Every store method becomes `async` and runs inside `withTenant(context, tx => ...)`. That helper checks out a pooled client, runs `BEGIN`, calls `set_config('app.tenant_id', $1, true)`, does the work, and commits. Session-level `SET` is banned. Platform work (the superadmin console, login lookups and jobs) runs through `withPlatform(tx => ...)` on a separate `BYPASSRLS` role.
6. Tests run against real Postgres. Locally it comes from Docker Compose and in CI from a GitHub Actions service container. Vitest migrates and seeds one template database. Each `storeForTest()` call then clones it with `CREATE DATABASE ... TEMPLATE` and connects as the runtime role, never as a superuser.
7. The move is incremental. First the store contract goes async on SQLite. Then each area gets a Postgres implementation, tested against both drivers. Then the app switches to Postgres, and the SQLite code is deleted in the next unit.
8. Demo data comes from an idempotent TypeScript seed (`db/seed/demo.ts`), run on purpose. Nothing seeds on app start. `seed/initial-data.sqlite` gets one idempotent import and then leaves the repo.
9. Backups are a nightly `pg_dump -Fc` plus `pg_dumpall --roles-only`, and a pre-migration dump on every deploy. 14 are kept on the host and each is copied to a Hetzner Storage Box. That allows up to 24 hours of lost data and about 2 hours to restore. A scripted restore drill restores into a throwaway container and checks counts and RLS state.
10. `users` is the membership table. Each row is one Authelia username in one tenant with one role (ADR 0002, decision 2). It has no password column. `tenant_id` is `NOT NULL`, because the superadmin is an Authelia group and has no row.

## Context

- The store has 61 synchronous methods in 12 modules under `src/lib/store/`, reached through `src/lib/tenant-store.ts`. 47 files call `getTenantStore()` or `createTenantStore()`. `src/lib/store/schema.ts` creates 21 tables on every start and patches them with `ALTER TABLE` statements inside a `try` that ignores failures.
- Isolation today is query discipline only. Three child tables have no `tenant_id` (`quotation_lines`, `contract_services`, `contract_audit_events`). Every foreign key is single-column, so the schema allows an invoice that points at another tenant's customer.
- No server has run this app. Row `deploy` says the stack was "never run against a Hetzner host". The only data to carry over is `seed/initial-data.sqlite`: 5 tenants, 11 users, 3 customers, 1 contract, 1 quotation and no invoices (counted with `node:sqlite` on 2026-10-17).
- Team conventions, read-only from `C:\nexio_stock` and `C:\cwerp`:
  - nexio_stock runs `postgres:16-alpine` in Compose and Alembic for migrations. Its `scripts/deploy-remote.sh` asks the new image for the head revision, runs `pg_dump | gzip` when migrations are pending, migrates in a one-off container, keeps 14 dumps, and only then swaps containers. This repo's `deploy/deploy-remote.sh` already copies that flow for SQLite.
  - cwerp uses `pg` 8 and `postgres:16`. It replays a fixed list of `.pg.sql` files with no history table, and it carries a SQL Server compatibility shim (`CompatibilityResult` with `recordset`) in `backend/src/db/connection.ts`. Neither repo uses row-level security.
- A web search found no first-party Hetzner managed Postgres. Managed offers that run on Hetzner come from third parties such as Ubicloud. This is inferred from search results and not checked against Hetzner's own product pages.

### Facts checked for this ADR

| Claim | How it was checked |
| --- | --- |
| `pg` 8.23.1, `node-pg-migrate` 9.0.0 (peer `pg >=4.3.0 <9.0.0`), `@electric-sql/pglite` 0.5.10, `pg-mem` 3.0.14, `kysely` 0.29.6, `drizzle-orm` 0.45.4 are current | `npm view`, 2026-10-17 |
| `node-pg-migrate` runs `.sql` migrations, takes an advisory lock, and its `runner()` accepts `dbClient` or `databaseUrl` | Context7, `/salsita/node-pg-migrate` |
| `pg` is in Next's default `serverExternalPackages` list | `node_modules/next/dist/lib/server-external-packages.jsonc` (Next 16.3.8) |
| By default `pg` returns `int8` and `numeric` as strings and `date` as a JS `Date` | Probe against `pg` 8.23.1 |
| A non-owner role with RLS sees 0 rows without context and only its tenant with `set_config(..., true)`. The setting clears on commit. A row tagged with another tenant fails `WITH CHECK`. A composite FK rejects a cross-tenant reference. `BYPASSRLS` sees everything. The table owner bypasses RLS until `FORCE` is set | Prototype on `postgres:16-alpine` |
| On Postgres 15 and later, a new role cannot create tables in `public` until it gets a grant | The same prototype failed until `GRANT USAGE, CREATE ON SCHEMA public` |
| `pg_dump` as the table owner fails under `FORCE ROW LEVEL SECURITY` ("query would be affected by row-level security policy"). It succeeds once the owner has `BYPASSRLS` | The same prototype, `pg_dump` 16 |
| PGlite supports `CREATE ROLE`, `SET ROLE` and RLS, connects as superuser `postgres` by default, and serializes every query behind one mutex | Probe on 0.5.10. Mutex read in `packages/pglite/src/base.ts` through Context7 |
| `pg-mem` cannot parse RLS DDL | Probe on 3.0.14 failed with "Your query failed to parse" |

## Options considered

The arena ran as one labelled sequential pass in this session. This delegate does not spawn agents, so no cross-judge ran.

### Rubric

1. **Isolation strength.** Can a forgotten `WHERE tenant_id` or a wrong id leak or corrupt another tenant's rows?
2. **Port cost.** How far are today's raw SQL strings from the target?
3. **Test fidelity and speed.** Do tests run the engine and roles that production runs, on the Windows dev box and in CI?
4. **Ops parity.** How close is the setup to nexio_stock and cwerp, in `pg_dump`, migrate-before-swap and Compose?
5. **Safe for the next agent.** Does copying the nearest example produce a tenant-safe query?
6. **Dependencies.** How many packages, how many code generators, how many migration systems?

### Candidates

- **A. `pg`, raw SQL, `node-pg-migrate` SQL files, RLS, real Postgres in tests.**
- **B. Drizzle ORM and `drizzle-kit`, PGlite in tests.** The schema lives in TypeScript and `drizzle-kit` generates migrations. Queries are typed. Tests use the PGlite driver in process.
- **C. Kysely with its migrator and `kysely-codegen`, Testcontainers.** Migrations are written in TypeScript. Row types are generated from the live schema.
- **D. Keep SQLite and add streaming backups (Litestream).** This is the premise attack. One box and five tenants may not need a server database.

| Criterion | A | B | C | D |
| --- | --- | --- | --- | --- |
| Isolation | RLS, FORCE and composite FKs, tested as the runtime role | Same SQL possible, but PGlite tests run as superuser unless the harness calls `SET ROLE` | Same as A | No RLS in SQLite. Query discipline only |
| Port cost | Mechanical. Swap `?` for `$n` and fix a known dialect list | Rewrite all 61 methods into the Drizzle DSL | Rewrite all 61 methods into the builder | None |
| Test fidelity | Same engine, roles and pool as production. Concurrency bugs show up | One connection behind a mutex hides races such as invoice numbering. `node-pg-migrate` cannot run on it without `pglite-socket` | Same as A | Same as today |
| Ops parity | `pg` like cwerp, migrate-before-swap like nexio_stock | New tool for the team | New tool for the team | Differs from both repos and from the matrix decision |
| Next agent | `withTenant` is the only door to a client. RLS catches a missed filter | Typed queries help, but nothing stops a missing tenant filter | Same as B | A missed filter leaks |
| Dependencies | `pg`, `node-pg-migrate` | `drizzle-orm`, `drizzle-kit`, `@electric-sql/pglite` | `kysely`, `kysely-codegen`, `@testcontainers/postgresql` | `litestream` |

### Recommendation

Pick A. It is the only candidate where the port is a translation rather than a rewrite, and the same strings run on both drivers during the move. RLS works the same under any client library, so B and C add nothing to isolation. They only change how SQL is spelled. B's test story is worse in one specific way: PGlite has a single connection and starts as superuser, so the isolation and concurrency tests that matter most would pass without testing anything. D fails the team decision in row `db` and has no answer for isolation.

Grafts from the other candidates:

- From C, row types should come from the schema, not from hand-written casts like `row.status as TenantStatus`. Each area port adds a `parseRow` function per table at the store boundary. If hand-written parsers drift, adding `kysely-codegen` for types only stays a cheap later step.
- From B, PGlite stays as a fallback for a contributor who cannot run Docker. The harness would then have to `SET ROLE` to the runtime role. It is not the default path.
- From D, the backup rule is that a backup does not exist until a restore drill has run against it.

### What would change this decision

- If the owner buys a managed Postgres, the store design stays and only units D2, D11 and D13 change. The provider must allow non-superuser roles, `BYPASSRLS` and `FORCE ROW LEVEL SECURITY`. Some providers restrict `BYPASSRLS`. In that case the platform role becomes a `SECURITY DEFINER` function set.
- If cloning a template database per test file makes `npm test` more than about three times slower than today's SQLite run, switch to schema-per-file inside one database. The speed is a guess until unit D3 measures it.
- If the area ports keep producing the same workaround for a missing query builder, such as dynamic `WHERE` assembly copied across modules, adopt Kysely for query building only and keep the SQL migrations.

## Consequences

- **Concurrency is new.** SQLite ran one synchronous writer, so read-then-write code never raced. With a pool, invoice numbering, bulk runs and payment allocation can race. Each port must use an atomic `UPDATE ... RETURNING` or `SELECT ... FOR UPDATE`, and each gets a concurrency test.
- **Three database roles, plus the container superuser.**
  - `cbs_owner` owns the schema and has `BYPASSRLS`. The migrator, the demo seed and the SQLite import run as `cbs_owner`. It needs the bypass because `FORCE` applies RLS to the owner. Without it, a migration that copies rows would copy none and then drop the source.
  - `cbs_app` is the runtime role, with no ownership and no bypass.
  - `cbs_platform` has `BYPASSRLS` and is used only from `withPlatform`.
  - The app reads `DATABASE_URL` and `DATABASE_PLATFORM_URL`. Only the migrator, the seed and the import read `DATABASE_MIGRATE_URL`.
  - Backups and the restore drill run as the container's `POSTGRES_USER` superuser through `docker compose exec`, as nexio_stock does. `pg_dumpall --roles-only` needs that role anyway.
  - `FORCE` stays on every tenant table, so a future role that owns a table without `BYPASSRLS` still gets filtered.
- **Pre-tenant tables stay outside RLS on purpose.** `tenants` has no `tenant_id` column. `api_tokens` (ADR 0002) has one, but it is read before any tenant is known. Both are reached only through `withPlatform`, and `cbs_app` gets no grant on them. The D3 catalog test names these tables in an explicit allowlist and asserts that `cbs_app` has zero privileges on each one. A new table with a `tenant_id` column must then either get RLS or be added to the allowlist in review. `users` and `audit_events` have RLS. A tenant admin lists only their own users. Audit rows with a null `tenant_id` (platform events) are visible to `cbs_platform` only. Sessions, lockout counters and password hashes live in Authelia, so no table here holds them.
- **Sign-in lookups cross tenants through `withPlatform`.** Resolving `Remote-User` to its rows, and first-arrival binding by email, run before a tenant is known (ADR 0002, decisions 4 and 5). Both are `withPlatform` methods that return only `tenant_id`, `id`, `role` and `status`.
- **Type mapping is fixed once in `src/lib/db/types.ts`.** Money stays in minor units as `bigint`. Its parser returns a `number` and throws above `Number.MAX_SAFE_INTEGER`. `gst_rate` and `escalation_percent` become `numeric(6,3)` and parse to `number`. `date` columns parse to `YYYY-MM-DD` strings. `timestamptz` parses to ISO strings, so the existing domain types keep their string fields.
- **Dialect changes the ports must make.** Each item is a known edit, not a discovery.
  - `?` placeholders become `$n`.
  - `INSERT OR IGNORE` becomes `ON CONFLICT DO NOTHING`.
  - `COLLATE NOCASE` becomes `ORDER BY lower(...)`.
  - `ORDER BY rowid` in `listTenantHistory` becomes `ORDER BY occurred_at, id`.
  - `substr(created_at, 1, 7) = ?` month filters become half-open ranges on `timestamptz`.
  - `String(error).includes('UNIQUE')` becomes a check for SQLSTATE `23505`.
  - JSON text columns (`snapshot`, `details`, `invoice_months`) become `jsonb`.
- **The deploy gains a migrator image stage.** Next's `standalone` output trims `node_modules`, so `node-pg-migrate` ships in a separate `migrator` target of the `Dockerfile`.
- **Scheduled jobs (row `jobs`) get a home.** A job runs as a system actor. It lists tenants through `withPlatform`, then runs per tenant inside `withTenant`. A Postgres table claimed with `FOR UPDATE SKIP LOCKED` is enough for a queue, so the stack needs no Redis. The enable and disable switch per schedule from the team note is a row in that table.
- **`.env.example`, `deploy/README.md` and `seed/README.md` change.** `CLIENT_BILLING_DATABASE` and `CLIENT_BILLING_SEED_MODE` go away in unit D12.

## Implementation plan

Each unit lands alone, keeps `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:e2e` green, and ends with the named check. Units D5 to D9 can land in any order once D4 is in. The rest run in sequence.

1. **D1. Make the store contract async, still on SQLite.** A codemod in `scripts/codemods/async-store.ts` (ts-morph) marks every store method `async` and adds `await` at every call site in `src/` and the tests. Method bodies stay synchronous, so two requests cannot interleave inside a SQLite transaction. Turn on typed linting for `src/` with `@typescript-eslint/no-floating-promises`. That plugin already ships through `eslint-config-next`. The codemod's `--check` mode runs in CI until D12.
   - **Check.** The codemod's `--check` reports 0 store calls that are not awaited or returned. The lint rule reports 0 floating promises. All four commands are green. `NextResponse.json(promise)` still type-checks, so the codemod check covers the case the lint rule cannot see.
2. **D2. Add Postgres for local development and CI.** Add `docker-compose.dev.yml` with `postgres:16-alpine` on host port 5433, so it does not clash with nexio_stock or cwerp on 5432. Add `db/roles.sql` with the three roles and their schema grants. Add a `postgres` service container to `.github/workflows/ci.yml`. Add `DATABASE_URL` and the two other URLs to `.env.example`.
   - **Check.** `src/lib/db/roles.test.ts` asserts that `cbs_app` has `rolsuper` and `rolbypassrls` false and owns no table. It asserts that `cbs_owner` and `cbs_platform` have `rolbypassrls` true and `rolsuper` false. CI runs that test.
3. **D3. Write the baseline migration, the demo seed and the test harness.** Write `db/migrations/0001_baseline.sql` from today's 21 tables. Add `tenant_id` to the three child tables, `UNIQUE (tenant_id, id)` on every parent, composite foreign keys, `ENABLE` and `FORCE ROW LEVEL SECURITY`, policies and grants. `users` lands in its ADR 0002 shape: `tenant_id NOT NULL`, a nullable `authelia_username`, `UNIQUE (tenant_id, lower(email))`, `UNIQUE (tenant_id, authelia_username)`, and no `password` column. Write `db/seed/demo.ts`, which inserts the 5 demo tenants and today's `schema.ts` fixtures with `ON CONFLICT DO NOTHING`, as `cbs_owner`. The seed gives each demo user an `authelia_username` and inserts no `superadmin` row. The seed lands here because the area tests in D5 to D9 act as `nexio-admin`. Tests that act as the superadmin build the platform principal directly. Add `src/lib/db/` with the pool, the type parsers, `withTenant` and `withPlatform`. Add a Vitest global setup that migrates and seeds `cbs_test_template`. Every `storeForTest()` call clones its own database from the template and connects as `cbs_app`, so tests stay as independent as today's per-test `:memory:` stores.
   - **Check.** `src/lib/db/isolation.test.ts` passes. It asserts that every `public` table with a `tenant_id` column has `relrowsecurity` and `relforcerowsecurity` set, unless the table is in the pre-tenant allowlist, where `cbs_app` must hold no privilege. A new table that has neither fails CI. For each tenant table it also checks four cases. No context returns 0 rows, tenant A sees only A, a row tagged B under A fails with `42501`, and a cross-tenant reference fails with `23503`. Running the migrator twice is a no-op, and running the seed twice leaves identical row counts. Record the time per clone and the suite time against the SQLite baseline in the PR.
4. **D4. Split `tenant-store.test.ts` by area and select the driver per run.** `storeForTest()` reads `TEST_DRIVER=sqlite|pg`. Areas that have no Postgres port yet skip under `pg`, and the skip names the unit that ports them.
   - **Check.** The SQLite run has the same test count before and after the split (`vitest run --reporter=json`).
5. **D5. Port tenants, users and settings to `createPgStore`.** On both drivers, the methods in each ported area take a `TenantContext` (`{ tenantId, actor }`) instead of `AppSession`, per ADR 0002. The API-token work then never changes these signatures again. Superadmin methods use `withPlatform`.
   - **Check.** The area tests pass with `TEST_DRIVER=sqlite` and with `TEST_DRIVER=pg`.
6. **D6. Port services, customers and quotations.**
   - **Check.** Both drivers pass.
7. **D7. Port contracts, deposits, task notes and additional services.**
   - **Check.** Both drivers pass.
8. **D8. Port invoices and bulk invoice runs.** Invoice numbers come from a per-tenant counter row taken with `UPDATE ... RETURNING`.
   - **Check.** Both drivers pass. A new test issues 20 invoices in parallel through `Promise.all` on the pool and asserts 20 distinct numbers with no gaps. A bulk run started twice for one period creates one run.
9. **D9. Port payments, reminders and pending-payment close.**
   - **Check.** Both drivers pass. Two parallel payments on one invoice never overpay it.
10. **D10. Add the one-shot SQLite import.** `scripts/import-sqlite.ts <file>` runs as `cbs_owner` and copies a SQLite file into Postgres table by table in foreign-key order, with `ON CONFLICT DO NOTHING`. It drops the plain-text `password` column. It skips the platform `superadmin` row, because the superadmin is an Authelia group. It imports every other user with `authelia_username` null, so each binds by email on first arrival (ADR 0002, decision 5). It is an npm script and never runs on app start. The demo seed is also a script from D3, and nothing seeds on start.
    - **Check.** Importing `seed/initial-data.sqlite` twice leaves per-table counts equal to the source counts, except `users`, which is one lower (the skipped superadmin). The script prints both sets of counts. No imported row has a non-null `authelia_username`.
11. **D11. Switch the app to Postgres.** `getTenantStore()` builds the Postgres store from `DATABASE_URL`. Playwright global setup recreates `cbs_e2e` from the seeded template. `tenant-isolation.test.ts` runs on Postgres. Add `db-staging` and `db-production` services with their own volumes to `deploy/docker-compose.yml`. Each sits on an internal network shared only with its app, separate from the Caddy edge network in ADR 0002. Add the `migrator` stage to the `Dockerfile`. `deploy/deploy-remote.sh` runs `pg_dump`, then the migrator, then swaps the app, following nexio_stock.
    - **Check.** CI is green with Postgres as the only e2e database. `deploy-remote.sh staging` runs end to end against the local Compose stack and leaves a non-empty dump.
12. **D12. Delete SQLite.** Remove `node:sqlite`, `src/lib/store/schema.ts`, the SQLite store factory, `TEST_DRIVER`, the codemod check, the `VACUUM INTO` backup, `CLIENT_BILLING_DATABASE`, `CLIENT_BILLING_SEED_MODE` and `seed/initial-data.sqlite` (after the owner confirms the production import). Point matrix row `db` at `src/lib/db/isolation.test.ts`, set `ours` to `built`, and close #35.
    - **Check.** Searching the repo for `node:sqlite` and `DatabaseSync` returns nothing. `node scripts/check-matrix.mjs` passes. CI is green.
13. **D13. Add backups and the restore drill.** `deploy/backup.sh <env>` runs nightly from a systemd timer on the host. It writes `pg_dumpall --roles-only` and `pg_dump -Fc`, keeps 14 dumps, and copies each to the Hetzner Storage Box with `rsync` over SSH. `deploy-remote.sh` sends its pre-migration dump the same way. Both scripts run as the container superuser. `deploy/restore-drill.sh <dump>` starts a throwaway `postgres:16-alpine` and restores roles and then data. It compares the `pgmigrations` rows with the files in `db/migrations/` and compares per-table counts with the dump's manifest. It runs the RLS catalog query from D3 and writes a dated report.
    - **Check.** The drill exits 0 locally on a dump of the Compose stack. The first drill on the Hetzner host is logged in `.audit/`, and row `backup` moves to `built`.

## Owner decisions (accepted 2026-10-17)

1. **Self-hosted Postgres.** Self-host `postgres:16-alpine` per environment, like nexio_stock, although row `db` says "managed Postgres". Revisit when a paying tenant needs an uptime promise. Update the row's wording when D12 lands.
2. **Backups.** Nightly and pre-deploy dumps, with 14 kept on the host and copies on a Hetzner Storage Box. That allows up to 24 hours of lost data and about 2 hours to restore. WAL archiving waits until someone asks for a window under one hour.
3. **Seed data.** Import `seed/initial-data.sqlite` once with D10, then delete the file from the repo in D12. Developers' `.data/client-billing.sqlite` files are not imported.

## Needs owner decision

None new. Before D13 can run, the owner must create the Storage Box and give the host's backup user an SSH key for it. Backing up Authelia's users file and storage is ADR 0002's owner question 2.
