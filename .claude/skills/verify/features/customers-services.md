# Customers and services

Customers lets a tenant keep the people it bills: add, search, edit and deactivate a customer, with data isolated per tenant. Services is the tenant's catalogue of frequency-priced services and the quotations built from them.

## Sub-features

- `customer-create` saves a customer from the `Add customer` dialog.
- `customer-filter` searches by company, contact or email and filters by month, status and delivery type.
- `customer-edit` changes a customer's contact, GSTIN and billing address.
- `customer-status` sets a customer inactive or active with the row toggle.
- `customer-isolation` hides one tenant's customers from another tenant.
- `service-create` saves a service with monthly, quarterly, half-yearly and annual prices.
- `service-quotation` saves a quotation for a customer name and downloads its PDF.

## How to get to it (user POV)

- Open `Master Data` then `Customers` (route `/customers`) and choose `Add customer`, `Edit` or the row toggle.
- Open `Master Data` then `Services` (route `/services`) and choose `Add service`, then `Edit`, then the `Quotations` tab.
- API used by the pages: `GET` and `POST /api/customers`, `PATCH /api/customers/<id>`, `GET` and `POST /api/services`, `PATCH /api/services/<id>`, `GET` and `POST /api/quotations`, `GET /api/quotations/<id>/download`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true` and you ran `control-billing login nexio-admin`.
- `Nexio Hyper Customer` exists and no customer is named `Orbit Labs`. No service is named `E2E service`.

- **Create customer.** Run `control-billing run .claude/skills/verify/journeys/customer-then-invoice.mjs --as nexio-admin`. Its first half fills `Company name`, `Contact name`, the textbox `Email` (exact), `Phone`, `Billing address`, chooses `Create customer`, and the table shows the new company with the status text `Customer created.` Screenshot `01-customer-form-filled.png` and `02-customer-created.png` land in the evidence dir.
- **Create through the API.** Run `control-billing api POST /api/customers '{"companyName":"Arbor Test","contactName":"Aarav Mehta","email":"aarav@example.com","phone":"9000000123","gstin":"","billingAddress":"Bengaluru","invoiceDelivery":"monthly"}'`. The status is `201` and `status` is `active`. Confirm with `control-billing db "SELECT company_name,tenant_id,status,state_code FROM customers WHERE company_name='Arbor Test'"`.
- **Filter.** Fill the textbox `Search customers` (placeholder `Search company, contact, or email`) with `Orbit`. Only matching rows remain. `control-billing api GET "/api/customers?search=orbit&status=active"` returns the same items.
- **Edit.** On the row choose `Edit`, fill `GSTIN` `29AAGCB7383J1Z4`, change `Billing address`, choose `Save changes`. The row's address cell truncates to 30 characters followed by `...`. A GSTIN with a bad check digit shows an alert with `check digit` and keeps the dialog open.
- **Deactivate.** Click the control labelled `Set Orbit Labs inactive`. The text `Orbit Labs is now inactive.` appears and `db "SELECT status FROM customers WHERE company_name='Orbit Labs'"` reads `inactive`.
- **Isolation.** Run `control-billing api GET "/api/customers?pageSize=100" --as evo-admin`. The names include `Evo Fitness Customer` and none contain `Nexio`. Run the same with `--as nexio-admin` for the reverse. Save both with `--out customers/evo.json` and `customers/nexio.json`.
- **Create service.** Open `/services`, choose `Add service`, fill `Service name` and `Monthly price (₹)` `1500`, choose `Save service`. The service name shows in the catalogue. API: `POST /api/services` with `{"name":..., "prices":{"monthly":10000,"quarterly":30000,"halfYearly":60000,"annual":120000}}`.
- **Quotation.** On the service row choose `Edit`, select the tab `Quotations`, choose `New quotation`, fill `Customer name`, choose `Save quotation`. The customer name shows, and the link `Download` returns a PDF named `Q-NEXIO-<n>.pdf`.
- **Proof.** Save `control-billing screenshot /customers customers/list.png` and the `db` rows with `--out`. They show the company, tenant and status.

## Gotchas

- Customer ids are `customer-<uuid>`. The seeded customer is `<tenant>-customer`. Look up ids through the API instead of guessing.
- A customer with a GSTIN takes its state from the GSTIN. A customer without one keeps the billing state chosen in the form, which drives IGST versus CGST plus SGST on invoices.
- Customer email and phone are required, and the email must contain `@` and a dot. Missing fields show the first failing message only.
- Deactivating is reversible with the same toggle, so a recipe can restore the customer instead of restarting.
- The `Email` label also matches other labels, so use the exact textbox name `Email`.
- Services have unique names per tenant. Reuse of a name returns an error. Add a timestamp.
