# Client Billing Service verification map

This directory is the maintained source for verifying the user-facing behavior of Client Billing Service (product name Ledgerly in the UI). Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch an isolated instance with `control-billing up`. It serves `http://127.0.0.1:<port>` (the port is in the `up` output) on a fresh Postgres database, `cbs_verify_<name>`, migrated and loaded with the demo seed.
- `control-billing` below means `node .claude/skills/verify/control-billing.mjs`.
- Run `control-billing doctor` and require `ok: true`, the printed port and database path, and a `builtFrom.commit` that matches the checkout.
- Seed state per tenant, using Nexio Hyper (`nexio`) as the reference: customer `Nexio Hyper Customer` (GSTIN `29AAGCB7383J1Z4`, state 29), service `Managed billing service`, contract `Nexio Hyper managed billing contract` (2026-01-01 to 2026-12-31, monthly, deposit of 250.00), invoice `NEX-2026-001` (issued, 1,180.00, dated 2026-10-01, due 2026-10-15), invoice `NEX-2026-000` (paid, with payment reference `SEED-PAID`), and one held security deposit. Other tenants are `maasp`, `evo`, `gripdata`, `od`, with the same shape and a three-letter invoice prefix taken from the tenant name.
- Company settings start with no GSTIN, so new invoices are issued as `Bill of Supply` until a seller GSTIN is saved.
- Never drive an instance that was not started by this verification run. Never touch port 3000.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise. After a mutation run `control-billing down` and `up` for a fresh database instead of repairing rows.
- Sign in as the identity the feature file names with `control-billing login <id>` (the real picker). `--as <id>` selects an identity per command.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position. The quoted names below come from the running app and from `e2e/*.spec.ts`.
- Multi-step UI journeys run through `control-billing run <script.mjs>`; the script receives an authenticated Playwright `page`. `journeys/customer-then-invoice.mjs` is the worked example.
- Read pages through `control-billing snapshot <path>` and `control-billing screenshot <path> <file.png>`. Read data through `control-billing api GET <path>` and, as a second view, `control-billing db "<SELECT ...>"`.
- Treat every quoted label, route and flag as literal.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot or screenshot where the tenant name and route are visible.
- API proof includes the status code and body.
- Mutation proof includes a read-only `db` row, saved with `--out`.
- Record the feature ID and entry point used with every artifact (put them in the `--out` file name).
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- Status of this map: `customers` plus `invoices` creation was driven end to end with `journeys/customer-then-invoice.mjs`. The other recipes were assembled from the repo's Playwright specs and from ARIA snapshots of the seeded pages, and have not all been executed through this CLI. A run that drives one of them should update the file if a handle differs.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-billing` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command or handle and an observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Invoices](./invoices.md) covers the register, creating, correcting and voiding invoices, the invoice detail and PDF, and the bulk invoice run.
- [Payments and pending payments](./payments.md) covers recording and editing payments, the payment register export, reminders and closing outstanding invoices.
- [Contracts and renewals](./contracts.md) covers contract creation and validation, the renewal tracker, and the security-deposit ledger.
- [Customers and services](./customers-services.md) covers customer create, filter, edit, deactivate and tenant isolation, plus the service catalogue and quotations.
- [GST sales report and exports](./gst-reports.md) covers the monthly GST register, CSV, HSN CSV and PDF exports, and the seller and client GST setup that shapes them.
- [Settings and templates](./settings-templates.md) covers company settings, template preview, the SMTP test and operational logs.
- [Email delivery](./email.md) covers sending an invoice by email with the PDF attached, the per-invoice delivery log, and email payment reminders.
- [Tenants (superadmin)](./tenants.md) covers platform tenant creation, editing, disabling, re-enabling and history.
- [Demo login](./demo-login.md) covers the identity picker, role-based navigation, sign out and route protection.

Not mapped yet: Additional Services, Task Notes, User management (`/users`), Logs (`/logs`), the dashboard cards, quotations beyond download, and the PWA manifest.
