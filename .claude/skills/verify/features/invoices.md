# Invoices

Invoices let a tenant admin or user list issued invoices, create one for a customer or contract, correct or void an unpaid one, open its detail page, download the PDF, and issue a month of contract invoices in bulk.

## Sub-features

- `invoice-list` filters the register by search text, month and status.
- `invoice-create` issues an invoice from the `Create invoice` dialog with line items, GST and an optional contract.
- `invoice-create-new-customer` creates a customer from the dialog's `Customer Source` selector.
- `invoice-detail` shows the billing snapshot, line items and summary for one invoice.
- `invoice-download` returns `<number>.pdf`.
- `invoice-correct` voids the original and issues a replacement with a reason.
- `invoice-void` voids an unpaid invoice with a reason.
- `invoice-bulk` previews, downloads and issues one billing period of contract invoices, once per period.

## How to get to it (user POV)

- Open `Billing` then `Invoices` in the sidebar, route `/invoices`.
- Choose `Add invoice` on the register, or `Correct` or `Void` on a row, or `View` on a row (route `/invoices/<id>`).
- Choose `Bulk invoice run` on the register (route `/invoices/bulk`).
- API used by the pages: `GET` and `POST /api/invoices`, `GET` and `PATCH /api/invoices/<id>` (void and correct), `GET /api/invoices/<id>/download`, `GET` and `POST /api/invoices/bulk`, `GET /api/invoices/bulk/download`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true` and you ran `control-billing login nexio-admin`.
- Customer `Nexio Hyper Customer` exists. No customer is named `Orbit Labs 1`.
- Invoice `NEX-2026-001` is issued and unpaid, `NEX-2026-000` is paid.

- **List.** Run `control-billing snapshot /invoices --out invoices/list.aria.txt`. The heading `Invoices` and `Invoice register` show, with rows `NEX-2026-001` and `NEX-2026-000` and `1–2 of 2`.
- **Filter.** In a `run` script fill the textbox `Search invoices` with `NEX-2026-001`, select `issued` in the combobox `Filter by invoice status`, and select `2026-10` in `Invoice month`. Only `NEX-2026-001` remains.
- **Create through the UI.** Run `control-billing run .claude/skills/verify/journeys/customer-then-invoice.mjs --as nexio-admin`. It creates a customer, opens `Add invoice`, selects the customer in the combobox named `Customer *`, fills `Description 1` and `Rate 1`, unchecks `GST Applicable`, chooses `Create Invoice`, and the dialog `Create invoice` closes. The result holds the `customers` and `invoices` rows read back with `db`: status `issued`, `taxable_minor` 25000, `gst_minor` 0, number `NEX-0003` or the next free one.
- **Create through the API.** Run `control-billing api POST /api/invoices '{"customerId":"nexio-customer","invoiceDate":"2026-10-17","dueDate":"2026-10-31","taxableMinor":10000,"gstRate":18}'`. The status is `201`; `invoice.totalMinor` is 11800. Confirm with `control-billing db "SELECT invoice_number,total_minor,status FROM invoices WHERE tenant_id='nexio' ORDER BY invoice_number"`.
- **Line items with GST.** In the dialog fill `Description 1`, `Quantity 1`, `Rate 1`, set `Tax type 1` to `igst` and `GST percent 1` to `18`, choose `Add Line`, and check the totals in `.invoice-totals`. Two lines of 2 x 100.00 at 18 percent and 50.00 at 0 percent total 286.00. A seller without GSTIN issues a `Bill of Supply`; after saving a seller GSTIN (see settings) an invoice with lines requires `HSN/SAC 1`.
- **Detail.** Run `control-billing snapshot /invoices/nexio-invoice-001 --wait-text "Line items"`. The page shows `Billing snapshot`, `Invoice record` and the sentence `Commercial and branding details are preserved at issue.`
- **Download.** Run `control-billing api GET /api/invoices/nexio-invoice-001/download`. The result has `contentType: application/pdf`, `contentDisposition` naming `NEX-2026-001.pdf`, and a `savedTo` file with its sha256. In the UI the link is `Download invoice`.
- **Correct.** On the row choose `Correct`; in the dialog `Correct invoice` change `Rate 1`, fill `Correction reason`, choose `Issue corrected invoice`. `GET /api/invoices?search=<customer>` lists the original as `void` and a replacement as `issued`. Confirm with `db "SELECT invoice_number,status,taxable_minor FROM invoices WHERE customer_id = ?" --param <customer id>`.
- **Void.** On an unpaid invoice choose `Void`, enter a reason, confirm. The status becomes `void` and `operational_logs` gains `Invoice <number> voided: <reason>`.
- **Bulk run.** After creating an active contract and an additional service dated in the period (see contracts), choose `Bulk invoice run`, select `Billing period` `2026-10`, choose `Preview invoices`, `Download preview` (`bulk-invoice-preview-2026-10.pdf`), `Issue reviewed invoices`, then `Issue invoices` in the alert dialog. The text `Issued N invoices.` shows. A second issue shows `This billing period was already issued.` and `bulk_invoice_runs` holds one row for the period.
- **Proof.** Save `control-billing screenshot /invoices/<id> invoices/detail.png`, `control-billing snapshot /invoices --out invoices/list-after.aria.txt`, and the `db` rows with `--out invoices/rows.json`. They show the invoice number, customer, total and status.

## Gotchas

- Invoice numbers are `<prefix>-<count + 1>` per tenant, so the number depends on how many invoices already exist. Assert the pattern or read it back, not a fixed value.
- A seller with no GSTIN issues a `Bill of Supply` and the GST report puts such rows in `NIL_EXEMPT_NON_GST` even when a GST rate was typed. Set the seller GSTIN first (settings) when the proof needs a `Tax Invoice`.
- Money is in minor units over the API (`taxableMinor: 10000` is 100.00) and in rupees in the dialog fields (`Rate 1` is rupees).
- The `Venue` field is intentionally absent from the dialog. Do not report its absence.
- An invoice with recorded payments cannot be corrected or voided. Expect the error text, not a dialog close.
- Dates and aging use the machine clock. `NEX-2026-001` shows overdue-style aging only when today is after 2026-10-15.
- `Correct` and `Void` change the database. Restart the instance instead of repairing rows when a recipe needs the seeded state back.
