# Contracts and renewals

Contracts let a tenant record a billing agreement with a customer, services, a frequency and invoice months. The renewal tracker lists contracts by end date and records renewals, and the security-deposit ledger settles the deposit held for a contract.

## Sub-features

- `contract-list` lists contracts with search, month and status filters.
- `contract-create` creates a contract with services, frequency, invoice months and deposit.
- `contract-validate` rejects a quarterly contract without exactly three invoice months and a contract with no service.
- `contract-defaults` fills the name, end date and escalation review date from the customer, frequency and start date, and keeps manual entries.
- `contract-edit` edits services, dates and frequency of an existing contract.
- `renewal-list` filters contracts by renewal state (`Expired`, `Upcoming`, `Current`).
- `renewal-record` renews a contract with a new end date and note.
- `renewal-audit` shows a contract's audit events.
- `deposit-settle` settles a held security deposit with a closeout note.

## How to get to it (user POV)

- Open `Master Data` then `Contracts` (route `/contracts`) and choose `Add contract`, or `Edit` on a row.
- Open `Master Data` then `Renewal Tracker` (route `/renewals`) and choose `Renew` or `Audit` on a row.
- Open `Billing` then `Security Deposits` (route `/security-deposits`, heading `Security-deposit ledger`) and choose `Settle`.
- API used by the pages: `GET` and `POST /api/contracts`, `PATCH /api/contracts/<id>`, `GET /api/renewals`, `GET` and `POST /api/renewals/<contract id>`, `GET` and `POST /api/deposits`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true` and you ran `control-billing login nexio-admin`.
- Customer `Nexio Hyper Customer`, service `Managed billing service` and contract `Nexio Hyper managed billing contract` (ends 2026-12-31) exist. No contract is named `Quarterly reporting`.

- **List.** Run `control-billing snapshot /contracts --out contracts/list.aria.txt`. The register shows `Nexio Hyper managed billing contract`.
- **Create in the UI.** In a `run` script choose `Add contract`, fill `Contract name`, select a `Customer` option by index 1, fill `Start date` `2026-04-01`, `End date` `2027-03-31`, `Contract value` `12000`, select `quarterly` in `Billing frequency`, click the month chips `Jan`, `Apr`, `Jul`, fill `Security deposit` `2500`, click `Select services`, check the first checkbox in the group `Services`, click `Select services` again, choose `Create contract`. The register shows `Quarterly reporting` and the text `months 1, 4, 7`.
- **Create through the API.** Write the contract JSON to a file and run `control-billing api POST /api/contracts --body-file contract.json` with `customerId` `nexio-customer`, `serviceIds` `["nexio-service"]`, `billingFrequency` `quarterly`, `invoiceMonths` `[1,4,7]`, `valueMinor` 1200000, `securityDepositMinor` 250000. The status is `201` and `status` is `active`. Confirm with `control-billing db "SELECT name,billing_frequency,invoice_months,security_deposit_minor FROM contracts WHERE name='Quarterly reporting'" --out contracts/row.json`.
- **Validation.** In the dialog select `quarterly`, click only `Jan`, choose `Create contract`. The text `Quarterly contracts require 3 invoice months.` appears. With no service checked the text is `Select at least one service.`
- **Defaults.** After selecting `Nexio Hyper Customer` the `Contract name` reads `Billing - Nexio v1 monthly`. Changing `Billing frequency` to `quarterly` changes it to `... quarterly`. A start date of `2026-04-15` fills `End date` `2027-03-31` and `Escalation review date` `2027-02-01`. A name typed by hand is kept when the frequency or customer changes.
- **Edit.** On the row choose `Edit`, change `Start date`, remove `Managed billing service` with the button `Remove Managed billing service`, choose `Save changes`. The row no longer lists that service.
- **Renewal list.** Run `control-billing snapshot /renewals --out contracts/renewals.aria.txt`. The heading `Renewal Tracker` shows the contract row with `Notice 30 days`, `Due in N days`, and the buttons `Audit` and `Renew`.
- **Record renewal.** Create a contract that ended in the past (`Start date` `2025-01-01`, `End date` `2026-01-01`). In `Renewal Tracker` choose `Renew` on its row, fill `New end date` `2027-01-01` and `Renewal note`, choose `Record renewal`. The row shows `2027-01-01`. `db "SELECT end_date FROM contracts WHERE name = ?" --param <name>` reads `2027-01-01`.
- **Settle deposit.** Open `/security-deposits`, choose the last `Settle`, fill `Closeout note` `Returned during closeout.`, choose `Record settlement`. A `settled` badge shows. `db "SELECT status,settled_minor FROM security_deposits ORDER BY created_at DESC LIMIT 1"` reads `settled`.
- **Proof.** Save `control-billing screenshot /contracts contracts/list.png` and `snapshot /renewals`, plus the `db` rows with `--out`. They show the contract name, frequency and end date.

## Gotchas

- Contract value and deposit fields take rupees in the form and minor units in the API.
- A contract's end date and review date follow the start date until you type your own. Reordering the steps changes the outcome, so follow the order above.
- `Renew` only appears usefully on an expired or upcoming contract, and `Renewal state` depends on the machine clock. The seeded contract ends 2026-12-31.
- The `Security Deposits` ledger heading must be absent on the Renewal Tracker page and present on its own route.
- The `Customer` select needs a customer to exist. The recipes use option index 1, which is the first listed customer, not a named one.
- Settling a deposit is one way. Restart for a fresh seed before repeating it.
