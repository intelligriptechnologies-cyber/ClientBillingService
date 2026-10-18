# Settings and templates

Settings lets a tenant admin edit company details, invoice defaults, invoice and email templates, SMTP configuration and retention, preview a template, test SMTP without sending anything, and download the tenant's operational logs. Tenant users cannot open it.

## Sub-features

- `settings-company` edits company name, legal name, GSTIN (validated, shows the implied state), address and logo.
- `settings-templates` previews the invoice template.
- `settings-email` tests the SMTP configuration locally.
- `settings-logs` lists feature-flow and error logs and downloads them.
- `settings-guard` blocks tenant users and signed-out visitors.

## How to get to it (user POV)

- As a tenant admin open `Admin Console` then `Company Settings` (route `/settings`, heading `Tenant settings`).
- Choose the tabs `Company`, `Invoice`, `Templates`, `Email`, `General` or `Operational logs`, then `Edit settings`.
- API used by the page: `GET` and `PUT /api/settings`, `POST /api/settings/preview`, `POST /api/settings/smtp-test`, `GET /api/logs`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true` and you ran `control-billing login nexio-admin`.
- Nexio's settings show `Nexio Hyper · No GSTIN` on the `Company` tab.

- **Open.** Run `control-billing snapshot /settings --out settings/company.aria.txt`. The tablist `Settings sections` holds the six tabs, and the `Company` tab shows `Company settings`, the button `Edit settings`, and the text `Nexio Hyper · No GSTIN`.
- **Company edit and GST validation.** In a `run` script choose `Edit settings` to open the dialog `Edit company settings`. Fill `GSTIN` `29AAGCB7383J1Z5`. The dialog text contains `check digit does not match`, and `Save settings` shows an alert with `check digit`. Fill `GSTIN` `29AAGCB7383J1Z4` and `Legal name` `Nexio Hyper Private Limited`. The dialog shows `State: Karnataka (29)`. `Save settings` shows the status `Settings saved` and the page text `29AAGCB7383J1Z4 · Karnataka`. Confirm with `control-billing db "SELECT gstin,state_code,legal_name FROM tenant_settings WHERE tenant_id='nexio'" --out settings/row.json`.
- **Template preview.** Choose the tab `Templates`, `Edit settings`, `Preview template`. The element with role `status` contains `Preview`. Choose `Cancel`.
- **SMTP test.** Choose the tab `Email`, `Edit settings`, `Test SMTP configuration`. A tenant with no SMTP host shows the alert `Email is not set up`. After saving a host and a From address, reopen `Edit settings` and test again: the status contains `SMTP test passed. The capture transport is active`. Choose `Cancel`. See `email.md` for sending.
- **Logs.** Choose the tab `Operational logs`. The heading `Feature-flow logs` shows. Choose `Download all logs`; the saved file is `operational-logs.txt`. API: `control-billing api GET /api/logs` returns the same tenant's entries, for example `Invoice <number> voided: <reason>` after a void.
- **Guard, user.** Run `control-billing snapshot /settings --as nexio-user`. The result has `redirected: true`, `finalPath: "/dashboard"`, and the navigation has no `Admin Console`.
- **Guard, signed out.** Run `control-billing snapshot /settings --anonymous`. The result lands on `/` with the `Choose a demo identity` heading.
- **Proof.** Save `control-billing screenshot /settings settings/company.png`, the `db` row and the preview and SMTP status text captured by your `run` script (return it from the script). They show the GSTIN, the implied state and the demo-only messages.

## Gotchas

- Each tab opens its own `Edit settings` dialog. Cancel it before moving to another tab.
- Saving a seller GSTIN changes what new invoices become (`Tax Invoice` instead of `Bill of Supply`, `HSN/SAC` required on lines). Restart the instance when the recipe needs the unregistered seller back.
- The SMTP test connects with the saved settings and sends nothing. In the isolated instance the transport is the capture transport, so the status says no connection was made. The password field is write-only: it reopens empty with the placeholder `Saved. Leave blank to keep it.`
- The GSTIN is stored upper-case. A lower-case entry is accepted and normalized.
- `/users` (User management) and `/logs` are also under Admin Console. They are not mapped yet.
