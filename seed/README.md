# Initial app data

`initial-data.sqlite` is a SQLite backup of the current `.data/client-billing.sqlite`, captured on 2026-10-08. It includes every table and record, including users and their credentials.

When the app creates a new persistent database, it copies this file once. Later app opens use the existing database, so edits made in the app remain in place. The snapshot is fixed; later edits do not change it automatically.

The end-to-end test server sets `CLIENT_BILLING_SEED_MODE=demo` to use the separate demo fixtures.
