# Tenants (superadmin)

Tenants lets the platform superadmin create, rename, filter, disable and re-enable isolated billing workspaces and read each tenant's lifecycle history. Tenant admins and users cannot reach it.

## Sub-features

- `tenant-list` shows the tenant portfolio with search, status and month filters.
- `tenant-create` creates a tenant with its default admin and user identities.
- `tenant-edit` renames a tenant.
- `tenant-disable` disables a tenant, which signs its users out of operational pages.
- `tenant-enable` re-enables a disabled tenant (the button is labelled `Approve`).
- `tenant-history` lists `created`, `updated`, `disabled`, `enabled` events in order.
- `tenant-guard` closes the page and the API to tenant sessions and signed-out visitors.

## How to get to it (user POV)

- Sign in as `superadmin`, then choose `Tenants` in the sidebar (route `/tenants`, heading `Tenants`, table `Tenant portfolio`).
- Choose `Create tenant`, or `Edit`, `Archive`, `Approve`, `History` on a row.
- API used by the page: `GET` and `POST /api/tenants`, `PATCH /api/tenants/<id>`, `GET /api/tenants/<id>/history`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true` and you ran `control-billing login superadmin`.
- Five seeded tenants exist (`Nexio Hyper`, `MAASP Associates`, `Evo Fitness`, `Gripdata Analytics`, `OD Badminton`). No tenant is named `Northstar 1`.

- **List.** Run `control-billing snapshot /tenants --as superadmin --out tenants/list.aria.txt`. The text `5 tenants` shows and the table has a row for each seeded tenant. API: `control-billing api GET /api/tenants --as superadmin` returns `items`.
- **Create in the UI.** In a `run` script (with `--as superadmin`) choose `Create tenant`, fill `Tenant name` `Northstar 1`, choose the last `Create tenant` button. A cell matching `Northstar 1` shows in the table, and `control-billing db "SELECT id,name,status FROM tenants WHERE name='Northstar 1'"` returns one `active` row. The tenant's identities appear in `control-billing login` as `<tenant id>-admin` and `<tenant id>-user`.
- **Filter.** Fill `Search tenants` with the name, choose `Apply filters`. Only that tenant remains. `Clear filters` restores the list.
- **Rename.** On the row choose `Edit`, fill `Tenant name`, choose `Save changes`. The row shows the new name.
- **Disable.** Choose `Archive` on the row. The alertdialog `Disable tenant?` appears. Choose `Disable tenant` inside it. The row shows `disabled`. Then run `control-billing snapshot /customers --as <tenant id>-admin` for a tenant that was signed in: it redirects to `/`.
- **Enable.** Choose `Approve` on the row. The row shows `active`.
- **History.** Choose `History`. The dialog named `<tenant name> history` lists `created`, `updated`, `disabled`, `enabled` in that order. Confirm with `db "SELECT action FROM tenant_lifecycle_events WHERE tenant_id = ? ORDER BY occurred_at" --param <tenant id>`.
- **Duplicate name.** Create a tenant named `Nexio Hyper`. The dialog alert contains `already exists`. Cancelling and reopening `Create tenant` shows no alert.
- **Guard.** Run `control-billing snapshot /tenants --as nexio-admin` (redirects to `/dashboard`), `control-billing api GET /api/tenants --as nexio-admin` (status `403`), and `control-billing snapshot /tenants --anonymous` (redirects to `/`). Run `control-billing snapshot /users --as superadmin`, which redirects to `/dashboard` because the superadmin has no tenant user page.
- **Proof.** Save `control-billing screenshot /tenants tenants/list.png --as superadmin`, the history dialog text returned by your `run` script, and the `db` rows with `--out`.

## Gotchas

- Tenant ids are derived from the name when created. Read the id from the row's subtle text or from `db` before building a login id.
- The disable button is labelled `Archive` and the enable button `Approve`. The confirmation dialog says `Disable tenant`.
- A disabled tenant's sessions are rejected on the next request, so test that from a tenant identity logged in before the disable.
- The superadmin has no tenant context. `control-billing api GET /api/customers --as superadmin` returns `401`, which is correct.
- Creating a tenant writes its admin and user rows with no password. The picker needs none.
- Tenant creation is not undoable except by disabling. Restart the instance for a clean list.
