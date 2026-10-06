# Project1 Reference Findings

## Purpose

This document records what the Client Billing Service may reuse conceptually from `C:\Prem_Dev\Project1`. Project1 is a coworking ERP, not a dependency or a template to copy wholesale. The findings below intentionally separate portable billing behavior from coworking- and ERP-specific behavior that is excluded from this product.

## Reusable Findings

| Project1 finding | Reuse in Client Billing Service |
| --- | --- |
| Invoices present total, paid amount, outstanding balance, status, dates, and client context together. | Preserve these monetary components on invoice lists and details; do not hide financial state behind an action menu. |
| Invoice editing becomes unsafe once payments exist. | Use a stricter Release-1 rule: only drafts are editable; issued invoices are immutable. |
| Payment entry is outstanding-aware and captures method, reference, date, and amount. | Use the same user-facing pattern and validate amount against the invoice’s outstanding balance. |
| Financially consequential actions use a confirmation dialog and capture a reason where needed. | Require an explicit, reasoned void confirmation. |
| Pending-payments reporting uses due date, outstanding amount, days overdue, and aging buckets. | Implement the focused Outstanding report with Current/1–30/31–60/61–90/90+ buckets. |
| Dense billing screens rely on filters, clear state labels, and row actions. | Provide search/filterable lists and an uncluttered detail-first interaction model. |
| Access-aware navigation complements server-side authorization. | Use role-aware frontend visibility now and retain a clean seam for future server enforcement. |
| Common billing operations benefit from shared form, modal, amount-formatting, and status components. | Build reusable primitives rather than page-specific implementations. |

## Behavior Not Carried Forward

The following Project1 behaviors are explicitly excluded because they solve coworking ERP or broader accounting problems outside the approved Client Billing Service scope:

- Venues, seat types, agreements, agreement renewals, seat allocation, service catalogues, daily usage, and usage allowances.
- Automated invoices generated from agreements or usage; bulk invoice preview/generation.
- Security-deposit ledgers and their received/adjusted/refunded/voided lifecycle.
- GST, TDS, taxable value calculation, CGST/SGST/IGST handling, tax reports, input bills, and filing exports.
- Bank reconciliation, income and expense registers, payment-to-income mapping, credit allocation, and accounting reports.
- WhatsApp/email delivery, recipient templates, invoice PDF/receipt generation, delivery history, and reminder automation.
- Invoice revision/superseding, cancellation variants, write-offs, credit notes, refunds, soft/hard deletion, and payment editing/voiding.
- Project1’s SQL Server, Express, JWT, and existing permission-table implementation.

## Reference Files Reviewed

- `docs/ui-specs/06-billing-spec.md`: financial visibility, invoice-edit safety, payment and confirmation patterns.
- `docs/REPORTS_GST_SALES_PENDING_PAYMENTS_SPEC.md`: outstanding/aging report structure; tax and venue portions excluded.
- `docs/CUSTOMER_INVOICING_AND_ADMIN_SETTINGS_{BRD,PRD,TECH_SPEC}.md`: role-aware settings and frontend/server authorization separation; invoice-recipient/template specifics excluded.
- `frontend/src/pages/Invoices.tsx` and `frontend/src/pages/Payments.tsx`: filterable data grids, payment-context display, and lifecycle-oriented UI behavior.

## Implications for This Build

1. Model payments as invoice-scoped in Release 1; do not generalize prematurely into a cash ledger.
2. Make status a derivation of immutable invoice facts, payment totals, and current date rather than a freely editable field.
3. Use a simple, safe lifecycle now. The future backend can add revisions, payment allocation, and audit records without weakening current constraints.
4. Preserve a repository boundary from day one so mock behavior can be replaced by SQLite/API behavior without rewriting pages.
