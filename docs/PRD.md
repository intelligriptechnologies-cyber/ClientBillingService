# Client Billing Service — Product Requirements Document

## 1. Product Definition

The product is a focused billing workspace for a single organization. It enables a team to maintain client records, create invoices, record invoice payments, and act on outstanding balances. This document turns the business scope in [BRD.md](./BRD.md) into product behavior; it does not add accounting, coworking, or delivery features.

## 2. Roles and Permissions

| Capability | Admin | Billing | Viewer |
| --- | ---: | ---: | ---: |
| View dashboard, clients, invoices, payments, reports | Yes | Yes | Yes |
| Create/edit active client | Yes | Yes | No |
| Archive/unarchive client | Yes | No | No |
| Create/edit/delete draft invoice | Yes | Yes | No |
| Issue invoice | Yes | Yes | No |
| Record payment | Yes | Yes | No |
| Void invoice | Yes | No | No |
| Update settings | Yes | No | No |

The frontend uses these permissions to hide unavailable navigation and disable/block unavailable actions. A later API must enforce the same permission policy independently.

## 3. Domain Vocabulary and Data Boundaries

- **Client**: the party being billed. A client has identity and contact details and may be active or archived.
- **Invoice**: a request for payment for one client, with a date, due date, status, notes, and immutable issued snapshot of line items.
- **Invoice line**: description, quantity, unit price, and derived line total. It is part of exactly one invoice.
- **Payment**: a recorded amount applied to exactly one invoice, with a date, method, reference, and optional note.
- **Settings**: organization-level display/configuration values. Settings influence new records only; they must not rewrite existing invoice history.

The product owns only these billing records. It does not model contracts, inventory, services consumed, taxes, bank transactions, or accounting journal entries.

## 4. Functional Workflows

### 4.1 Dashboard

The dashboard is the authenticated landing screen. It shows, for the selected reporting period:

- total invoiced;
- total collected;
- total outstanding;
- overdue amount;
- count of invoices by actionable state; and
- a short list of the most overdue invoices with links to their details.

The default reporting period is the current calendar month. Summary cards and lists must derive from the same repository data as the detail screens. A date/period change updates all dashboard metrics together.

### 4.2 Client Directory and Profile

The Clients screen lists active clients by default, with search by name, company, email, or phone and an option to include archived clients. Each row displays client name/company, primary contact, status, lifetime invoiced, and current outstanding amount.

Create/edit fields: display name, company name (optional), email (optional), phone (optional), billing address (optional), and internal note (optional). Display name is required. If provided, email must have valid email format. Client records cannot be permanently deleted in Release 1.

Archiving requires confirmation. Archived clients remain visible in historical records and cannot be selected for a new invoice. The profile shows client details, invoice history, payment history, and current outstanding amount.

### 4.3 Create and Manage Draft Invoice

A billing user starts a new invoice from the invoice list or an active client. Required fields are client, invoice date, due date, and at least one line. The due date cannot be earlier than the invoice date. New invoices begin as `draft`.

Each line requires a non-empty description, quantity greater than zero, and unit price greater than or equal to zero. The UI recalculates line and invoice totals immediately. An optional note is visible in the invoice detail.

Only a draft may be edited or deleted. Deleting a draft requires confirmation and removes it from the prototype session; a future persistent product should preserve an audit event instead.

### 4.4 Issue Invoice

An admin or billing user may issue a valid draft. The confirmation view shows client, dates, line-item total, and any note. On issue, the system assigns the next invoice number using the configured prefix and records the issue timestamp. The invoice is then immutable for commercial fields.

The derived post-issue state is:

- `issued` when no payment exists and the due date is today or later;
- `overdue` when no payment exists and the due date has passed;
- `partial` when payment exists but an outstanding balance remains and the due date has not passed;
- `overdue` when payment exists but an outstanding balance remains and the due date has passed;
- `paid` when outstanding is zero.

### 4.5 Record Payment

From an eligible invoice, an admin or billing user opens Record payment. The form shows invoice total, total previously paid, and remaining balance. Required fields are payment date, amount, and payment method. Reference and note are optional.

Allowed methods are `cash`, `bank_transfer`, `card`, `cheque`, and `other`. The amount must be positive and cannot exceed the displayed balance. On save, the payment appears in the invoice timeline/payment list, totals refresh, and invoice status is re-derived. Payment editing, voiding, refunds, and cross-invoice allocation are out of scope.

### 4.6 Void Invoice

Only an admin can void an issued, partial, or overdue invoice with no recorded payments. The dialog requires a non-empty reason and explicit confirmation. Void is terminal: it preserves the invoice in lists and reports but sets its operational outstanding contribution to zero. The invoice detail must show void reason, actor (prototype user), and timestamp.

### 4.7 Invoices and Payments Lists

The Invoices screen has search, status, client, and date-range filters. Columns include invoice number, client, issue date, due date, total, paid, outstanding, and status. Row click opens the detail screen; frequent valid actions are available without obscuring status or monetary components.

The Payments screen lists payment date, invoice number, client, method, reference, and amount. Filters include client, method, and date range. It is a record of payments, not a general cashbook.

### 4.8 Outstanding Report

The report shows issued, partial, and overdue invoices with a positive balance as of the chosen date. It includes invoice number, client, due date, total, paid, outstanding, days overdue, and aging bucket: Current, 1–30, 31–60, 61–90, or 90+.

The report supplies total outstanding and bucket totals. CSV export contains the current filtered result and its filter context. Void and paid invoices do not appear in the outstanding result.

### 4.9 Settings

Admin-only settings include business name, currency code, invoice-number prefix, and default payment terms in days. All fields validate before save. Changes affect newly created/issued invoices only. Existing invoice numbers, snapshots, and amounts do not change.

## 5. Lifecycle Rules

| State | Entered by | Allowed next state/action |
| --- | --- | --- |
| Draft | Create invoice | Edit, delete, issue |
| Issued | Issue draft | Record payment, become overdue by date, void if unpaid |
| Partial | Record a non-final payment | Record payment, become overdue by date, void only if no payments (therefore normally unavailable) |
| Overdue | Due date passes with balance > 0 | Record payment, paid when balance is zero; void only if unpaid |
| Paid | Payment settles balance | Read-only |
| Void | Admin confirms unpaid invoice void | Read-only |

Status is derived whenever relevant data changes or a listing/report is read. Time alone may cause `issued` or `partial` to display as `overdue`; no background mutation is required for the prototype.

## 6. Frontend Acceptance Criteria

1. Navigation exposes Dashboard, Clients, Invoices, Payments, Outstanding, and Settings according to role.
2. All lists have loading, empty, and error states, keyboard-accessible controls, and readable mobile layouts.
3. Currency and date formats are consistent across cards, lists, detail pages, dialogs, and CSV output.
4. Client selection excludes archived clients during invoice creation.
5. Invalid form values are blocked inline before submit; repository validation remains the final prototype guard.
6. Creating a draft, issuing it, recording a payment, and returning to dashboard updates all affected summaries in the same session.
7. A payment equal to the outstanding balance changes the invoice to Paid; a larger payment is rejected.
8. An invoice with a payment cannot be voided; a void action requires a reason and makes the invoice read-only.
9. Invoice details always show total, paid, and outstanding, including after state transitions.
10. Settings changes do not alter historic invoice records.

## 7. Non-Functional Requirements

- Use TypeScript throughout and avoid `any` in domain/repository boundaries.
- Keep business calculations in pure domain functions so they can be unit tested and shared by mock and future API repositories.
- Support current evergreen desktop browsers and responsive layouts down to a 360px viewport.
- Use semantic controls, labels, visible focus, sufficient color contrast, and non-color status cues.
- Treat client, invoice, and payment data as sensitive operational data: do not log it to the browser console in production code.
