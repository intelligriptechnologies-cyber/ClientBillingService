# Client Billing Service — Business Requirements Document

## 1. Purpose

Client Billing Service is a focused internal application for maintaining client billing records, creating and tracking invoices, recording payments, and reviewing outstanding receivables. The first release is a browser-based, single-organization product backed by typed mock data so that its workflows and interface can be approved before a production backend is introduced.

## 2. Business Problem

Billing information is often spread across spreadsheets, documents, and payment messages. That makes it difficult to answer basic operational questions: which client was billed, what is still owed, which payment settled which invoice, and what follow-up is required. The service must provide one understandable operational record without importing unrelated ERP or coworking operations.

## 3. Business Objectives

1. Maintain an accurate, searchable list of billable clients.
2. Let authorized users issue clear, line-item invoices and preserve their financial history.
3. Record payments against invoices without allowing an invoice to be overpaid.
4. Make current receivables and overdue balances visible at a glance.
5. Make key financial lifecycle changes explainable through visible status, timestamps, and notes.

## 4. In Scope (Release 1)

- Dashboard with billing and receivables summaries.
- Client directory and client profile maintenance.
- Invoice list, invoice detail, and manual invoice creation with one or more line items.
- Invoice states: `draft`, `issued`, `partial`, `paid`, `overdue`, `void`.
- Payment recording against one issued, partial, or overdue invoice.
- Payment methods, reference, date, amount, and optional note.
- Outstanding/overdue reporting with filters and CSV export of the currently displayed result.
- Basic application settings for business name, currency, default payment terms, and invoice-number prefix.
- Role-aware interaction for `admin`, `billing`, and `viewer` users in the frontend prototype.
- Deterministic mock seed data and in-session state updates.

## 5. Out of Scope (Release 1)

- Coworking-specific concepts: venues, agreements, seats, usage, service allowances, security deposits, and occupancy.
- Tax filing, GST/TDS calculations, accounting ledgers, bank reconciliation, expenses, quotations, and payroll.
- Recurring/bulk invoice generation, credit notes, refunds, partial allocation of one payment across several invoices, and payment gateways.
- Email/WhatsApp delivery, PDF generation, document storage, notifications, approval workflows, and external integrations.
- Authentication implementation, password management, SSO, and production authorization enforcement.
- Production persistence, SQLite schema/migrations, API endpoints, multi-organization tenancy, and audit-log storage.

## 6. Users and Needs

| User | Primary need | Release-1 capability |
| --- | --- | --- |
| Admin | Configure the billing workspace and correct records safely. | Full create/edit/void access and settings access. |
| Billing user | Create invoices, enter payments, and follow up on balances. | Client, invoice, payment, and report access; no settings or void action. |
| Viewer | Inspect billing progress without changing records. | Read-only dashboard, clients, invoices, payments, and reports. |

## 7. Business Rules

1. Every invoice belongs to one active client and contains at least one line item with a positive quantity and non-negative unit price.
2. Monetary values are stored and displayed in the configured currency; Release 1 has no tax calculation engine. Invoice total is the sum of line totals.
3. An invoice number is assigned when a draft is issued. It is unique within the organization and not reused.
4. A draft can be edited or deleted. Once issued, its commercial fields are immutable in Release 1.
5. A payment may only be recorded against an issued, partial, or overdue invoice, for an amount greater than zero and no greater than the current outstanding balance.
6. Total paid is the sum of non-voided payments. Outstanding is `invoice total − total paid`.
7. Issued invoices with a positive outstanding balance become `overdue` when their due date is before the current date; they remain `partial` when payment has been recorded but the due date has not passed.
8. An invoice becomes `paid` only when its outstanding balance is zero. Payments cannot be added to a paid or void invoice.
9. A void is an explicit terminal action requiring a reason. A void is blocked after any payment has been recorded; a correction then requires a future, explicitly scoped workflow.
10. Client archival prevents new invoices for that client but preserves historic invoices and payments.
11. Role restrictions are reflected in navigation and controls. They are a prototype interaction boundary, not a security control until the future API enforces them.

## 8. Success Measures

- A billing user can create an invoice and record a valid payment without leaving the product.
- The dashboard and outstanding report reconcile with the invoice and payment records shown in the product.
- An invalid lifecycle action (overpayment, payment on void invoice, or void after payment) is blocked with a clear explanation.
- A viewer cannot reach a mutation control through normal UI flows.
- The prototype can be replaced by a repository/API implementation without rewriting screen business rules.

## 9. Constraints and Assumptions

- Release 1 is a Next.js frontend prototype using typed mock repositories.
- The prototype represents one organization; any selected organization/tenant identifier is an architectural seam only.
- Amounts should use decimal-safe representations in the future persistence layer. The mock layer must avoid floating-point comparison errors by operating in minor units or a documented equivalent.
- Dates are calendar dates in the organization’s locale. The UI must not shift invoice or payment dates because of browser timezone conversion.
