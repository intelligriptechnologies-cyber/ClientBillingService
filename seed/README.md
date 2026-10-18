# Initial app data

`initial-data.sqlite` is a SQLite backup of the current `.data/client-billing.sqlite`, captured on 2026-10-08. It includes every table and record, including users and their credentials.

When the app creates a new persistent database, it copies this file once. Later app opens use the existing database, so edits made in the app remain in place. The snapshot is fixed; later edits do not change it automatically.

The end-to-end test server sets `CLIENT_BILLING_SEED_MODE=demo` to use the separate demo fixtures.

## Importing it into Postgres

`scripts/import-sqlite.ts` copies a SQLite store file into Postgres once (ADR 0001, unit D10). Run it on purpose against a migrated database. Nothing imports on app start.

```sh
DATABASE_MIGRATE_URL=postgres://cbs_owner:...@host:5432/cbs npm run db:migrate
DATABASE_MIGRATE_URL=postgres://cbs_owner:...@host:5432/cbs npm run db:import-sqlite -- seed/initial-data.sqlite
```

- It runs as `cbs_owner` and refuses a role without `BYPASSRLS`, because row-level security would hide the rows it counts.
- It copies table by table in foreign-key order, inside one transaction, with `ON CONFLICT DO NOTHING`. A second run inserts nothing.
- It drops the plain-text `password` column and skips the `superadmin` row, because the superadmin is an Authelia group. Every other user arrives with `authelia_username` null and binds by email on first arrival (ADR 0002, decision 5).
- `quotation_lines`, `contract_services` and `contract_audit_events` have no `tenant_id` in SQLite. They take their parent's.
- A date or time that SQLite kept as `''` (the tenants' `created_at` and `updated_at` in this file) takes the column default, which is the import time. It becomes null where the column allows null. The import stops on any other.
- It seeds `invoice_counters` with each imported tenant's invoice count, so numbering continues after the imported invoices.
- It prints the source, skipped, inserted and target count per table, and exits 1 when a table holds fewer rows than it copied.

Into an empty migrated database, this file gives the source counts in every table except `users`, which is one lower. The superadmin is the missing row.
