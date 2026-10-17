# Payments and pending payments

Payments let a tenant record money received against an invoice (with TDS and write-off), edit a payment's details, export the register, and work the pending-payments report with demo-only reminders and invoice closure.

## Sub-features

- `payment-register` lists payments with search, customer filter and month filter.
- `payment-record` records an allocation against an outstanding invoice.
- `payment-edit` changes a payment's method, reference and notes without changing the amount.
- `payment-export` downloads `payment-register.csv`.
- `pending-list` lists outstanding invoices with aging.
- `pending-reminder` records an email or WhatsApp reminder that sends nothing externally.
- `pending-close` closes an outstanding invoice with a write-off.

## How to get to it (user POV)

- Open `Billing` then `Payments` in the sidebar, route `/payments`, heading `Payments`, table `Payment register`.
- Choose `Record payment` on `/payments`, or on a row of the pending-payments report.
- Open `Reports` then `Pending Payments`, route `/reports/pending-payments`, heading `Pending Payments`.
- Choose `Download register` on `/payments`.
- API used by the pages: `GET` and `POST /api/payments`, `PATCH /api/payments/<id>`, `GET /api/payments/download`, `GET /api/pending-payments`, `POST /api/pending-payments/<invoice id>/reminders`, `POST /api/pending-payments/<invoice id>/close`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true` and you ran `control-billing login nexio-admin`.
- Invoice `NEX-2026-001` (id `nexio-invoice-001`, 1,180.00) is issued with no payment. `NEX-2026-000` has the seeded payment `SEED-PAID`.

- **Register.** Run `control-billing snapshot /payments --out payments/register.aria.txt`. The register lists `NEX-2026-000`, `SEED-PAID`, and `1 entries`. The text `Pending payments` is not a heading on this page.
- **Record payment in the UI.** In a `run` script choose the first button named `Record payment` (exact), fill `Payment amount` `100`, `TDS amount` `10`, `Payment reference` `UTR-2042`, choose `Record allocation`. The text `Payment allocation of` appears. With several outstanding invoices choose one in `Outstanding invoice` first.
- **Record payment through the API.** Run `control-billing api POST /api/payments '{"invoiceId":"nexio-invoice-001","paymentDate":"2026-10-17","amountMinor":10000,"tdsMinor":1000,"writeOffMinor":0,"method":"bank_transfer","reference":"UTR-2042"}'`. The status is `201` and `appliedMinor` is 11000. Confirm with `control-billing db "SELECT amount_minor,tds_minor,reference FROM payments WHERE invoice_id='nexio-invoice-001'" --out payments/row.json` and `db "SELECT status,paid_minor FROM invoices WHERE id='nexio-invoice-001'"`, which reads `partial` and `11000`.
- **Edit details.** On the payment row choose `Edit`; in the dialog `Edit payment details` set `Method` to `card`, fill `Reference` and `Notes`, choose `Save details`. The row shows `card` and the new reference, and `amount_minor` is unchanged.
- **Pending list.** Run `control-billing snapshot /reports/pending-payments --out payments/pending.aria.txt`. Rows show invoice, customer, outstanding amount, aging such as `1–30 (2d)`, and the buttons `Record payment`, `Email reminder`, `WhatsApp reminder`, `Close invoice`.
- **Reminder.** Choose `Email reminder` on a row. The page text contains `no external message was sent`. `control-billing db "SELECT channel,invoice_id FROM payment_reminders"` holds one `email` row. The API equivalent is `control-billing api POST /api/pending-payments/nexio-invoice-001/reminders '{"channel":"email"}'` (on PowerShell use `--body-file`), which returns `{ id, invoiceId, channel, note, createdAt }` and no delivery claim.
- **Close invoice.** Choose `Close invoice` on a row, then `Close invoice` in the `alertdialog`. The text `Invoice closed and write-off recorded` appears and the invoice leaves the pending list.
- **Export.** Run `control-billing api GET /api/payments/download`. The result has `contentType: text/csv`, and the body header is `Payment date,Invoice,Customer,Payment,TDS,Write-off,Applied,Method,Reference,Notes` with the new payment first. In the UI the link is `Download register` and the filename is `payment-register.csv`.
- **Proof.** Save `control-billing screenshot /payments payments/register.png`, the pending snapshot, and the `db` rows. They show the reference, applied amount and invoice status.

## Gotchas

- `Payment amount` and `TDS amount` in the form are rupees. The API takes minor units. The register shows `Payment` and `TDS` separately and the CSV adds `Applied`, which is their sum plus any write-off.
- The pending report and the register both have a `Record payment` button. Use `exact: true` and scope to the page you are on.
- Reminders and the closure note are demo-only. A reminder that claims delivery is a defect. Verify with `payment_reminders` and the confirmation text.
- Closing writes off the outstanding balance, so it is not repeatable on the same invoice. Restart for a fresh seed.
- Pending aging buckets depend on the machine clock against the invoice due date.
- Tenant isolation: `control-billing api GET /api/payments --as evo-admin` must not list Nexio references.
