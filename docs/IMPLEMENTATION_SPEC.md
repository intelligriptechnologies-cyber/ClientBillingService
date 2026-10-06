# Client Billing Service — Implementation Specification

## 1. Scope and Constraints

This is a build specification for the approved [BRD](./BRD.md) and [PRD](./PRD.md). It is intentionally a frontend-first Next.js implementation with typed mock repositories. It must not add tax, automated billing, payment allocation, delivery, coworking, or accounting features.

## 2. Technical Shape

- Next.js App Router, TypeScript, and a responsive CSS approach selected by the project bootstrap (CSS Modules or Tailwind are both acceptable; use one consistently).
- React Server Components for static route shells and data-independent layout; Client Components only for forms, filters, dialogs, and interactive tables.
- No direct mock-array imports from route components. All reads and writes go through repository interfaces.
- Domain calculation functions are framework-independent and use integer minor currency units (`amountMinor`) in code. Formatting occurs at the UI edge.
- Mock repositories are asynchronous to match the future API shape.

## 3. Proposed Folder Structure

```text
src/
  app/
    (app)/
      layout.tsx
      dashboard/page.tsx
      clients/page.tsx
      clients/[clientId]/page.tsx
      invoices/page.tsx
      invoices/new/page.tsx
      invoices/[invoiceId]/page.tsx
      payments/page.tsx
      reports/outstanding/page.tsx
      settings/page.tsx
    page.tsx                         # redirects to /dashboard
    globals.css
  components/
    layout/                          # app shell, sidebar, page header
    ui/                              # button, input, select, dialog, badge, table, empty/error states
    clients/                         # client form, client summary
    invoices/                        # invoice form, lines editor, totals, status, issue/void dialogs
    payments/                        # payment form, payment table
    reports/                         # filters, aging summary, CSV action
  features/
    dashboard/
    clients/
    invoices/
    payments/
    reports/
    settings/
  domain/
    client.ts
    invoice.ts
    payment.ts
    settings.ts
    money.ts
    invoice-status.ts
    aging.ts
    validation.ts
  repositories/
    contracts.ts
    mock/
      mock-data.ts
      mock-client-repository.ts
      mock-invoice-repository.ts
      mock-payment-repository.ts
      mock-settings-repository.ts
      mock-dashboard-repository.ts
      index.ts
  state/
    billing-store.ts                 # app/session state and repository provider
    selectors.ts
  lib/
    dates.ts
    format.ts
    csv.ts
    ids.ts
  test/
    fixtures.ts
```

Feature components may import domain utilities and repository contracts. They must not import concrete mock storage. The composition root (`state/billing-store.ts` or a dedicated provider) selects mock implementations.

## 4. Domain Types and Repository Contracts

Use opaque string IDs and ISO `YYYY-MM-DD` calendar-date strings. Persisted monetary amounts are integers in the smallest currency unit.

```ts
export type Role = 'admin' | 'billing' | 'viewer';
export type ClientStatus = 'active' | 'archived';
export type InvoiceStatus = 'draft' | 'issued' | 'partial' | 'paid' | 'overdue' | 'void';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';

export interface Client {
  id: string;
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
  note?: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface Invoice {
  id: string;
  clientId: string;
  invoiceNumber?: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  note?: string;
  totalMinor: number;
  issuedAt?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  paymentDate: string;
  amountMinor: number;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  recordedBy: string;
  createdAt: string;
}

export interface Settings {
  businessName: string;
  currencyCode: string;
  invoiceNumberPrefix: string;
  defaultPaymentTermsDays: number;
  updatedAt: string;
}
```

The contracts should expose list query/result types (search, status/client/date filters, pagination) rather than page-specific methods. Minimum interfaces:

```ts
export interface ClientRepository {
  list(query?: ClientListQuery): Promise<Page<ClientWithBalances>>;
  get(id: string): Promise<Client | null>;
  create(input: CreateClientInput): Promise<Client>;
  update(id: string, input: UpdateClientInput): Promise<Client>;
  setStatus(id: string, status: ClientStatus): Promise<Client>;
}

export interface InvoiceRepository {
  list(query?: InvoiceListQuery): Promise<Page<InvoiceListItem>>;
  get(id: string): Promise<InvoiceDetail | null>;
  createDraft(input: CreateDraftInvoiceInput): Promise<Invoice>;
  updateDraft(id: string, input: UpdateDraftInvoiceInput): Promise<Invoice>;
  deleteDraft(id: string): Promise<void>;
  issue(id: string, actor: Actor): Promise<Invoice>;
  void(id: string, input: VoidInvoiceInput, actor: Actor): Promise<Invoice>;
}

export interface PaymentRepository {
  list(query?: PaymentListQuery): Promise<Page<PaymentListItem>>;
  record(input: RecordPaymentInput, actor: Actor): Promise<Payment>;
}

export interface SettingsRepository {
  get(): Promise<Settings>;
  update(input: UpdateSettingsInput, actor: Actor): Promise<Settings>;
}

export interface DashboardRepository {
  getSummary(query: SummaryQuery): Promise<DashboardSummary>;
  getOutstandingReport(query: OutstandingQuery): Promise<OutstandingReport>;
}
```

Repository methods enforce the PRD lifecycle and role policy and return a typed `DomainError` (for example `VALIDATION`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`) that forms can map to accessible messages.

## 5. Mock Data and State Design

`mock-data.ts` holds immutable initial seed fixtures: settings; users/active role; at least six clients including one archived client; draft, issued, partial, paid, overdue, and void invoices; and payments that make the partial/paid examples reconcile. Use predictable identifiers and dates relative to a fixed fixture date or inject a clock in tests.

The app-level billing store creates a deep-cloned in-memory working copy from seed data once per browser session. It exposes the repository instances plus a monotonic revision number. A successful mutation replaces state immutably and increments the revision, which invalidates memoized queries/selectors. Resetting the browser session restores the seed state; no `localStorage` persistence is required unless deliberately added as a non-product development convenience.

Derived selectors are the sole source for:

- invoice paid and outstanding amounts;
- displayed status based on balance, void state, and clock date;
- dashboard metrics;
- client lifetime totals/current outstanding;
- aging buckets and outstanding report totals.

Do not store these values independently in mock state. This prevents summary/detail drift.

## 6. Route Map

| Route | Screen | Roles |
| --- | --- | --- |
| `/dashboard` | Period summary and overdue list | All |
| `/clients` | Client directory | All; mutations per role |
| `/clients/[clientId]` | Client profile, invoices, payments | All |
| `/invoices` | Invoice list/filtering | All |
| `/invoices/new` | Draft invoice form | Admin, billing |
| `/invoices/[invoiceId]` | Invoice detail, lifecycle actions, payments | All; actions per role |
| `/payments` | Payment register | All; record per role |
| `/reports/outstanding` | Outstanding/aging report and CSV export | All |
| `/settings` | Organization settings | Admin only |

The app layout resolves the active prototype role through one isolated `CurrentUserProvider`. It hides inaccessible routes from the sidebar and redirects a user visiting `/settings` without admin access to `/dashboard`. This is UX only; the identical check belongs at the future API boundary.

## 7. Component System

Build small, accessible primitives: `Button`, `TextField`, `Select`, `DateField`, `MoneyInput`, `DataTable`, `StatusBadge`, `Dialog`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `LoadingState`, and `PageHeader`.

Domain components compose them: `ClientForm`, `InvoiceLineEditor`, `InvoiceTotals`, `InvoiceStatusBadge`, `IssueInvoiceDialog`, `VoidInvoiceDialog`, `RecordPaymentDialog`, `OutstandingFilters`, `AgingSummary`, and `CsvExportButton`.

Rules:

- A dialog receives action intent and calls a feature action; it must not mutate arrays itself.
- All destructive/terminal actions use `ConfirmDialog` and show the affected invoice number/amount.
- Status badges include text, not color alone.
- `MoneyInput` converts user text only at the form boundary and never exposes floating-point values to domain logic.

## 8. Implementation Order

1. Bootstrap Next.js, lint/typecheck/test tooling, root layout, responsive shell, and role switcher/provider for prototype review.
2. Implement domain types, minor-unit money utilities, date utilities, validation, status derivation, payment aggregation, and aging calculations with unit tests.
3. Define repository contracts, fixtures, in-memory store, mock repositories, and repository/provider wiring. Test lifecycle guards at this layer.
4. Build shared UI primitives and formatters, then the app navigation and route guards.
5. Build Clients list, client form, archive confirmation, and client profile. Verify archived clients cannot be invoiced.
6. Build Invoices list, draft form/line editor, invoice detail, issue flow, and void flow.
7. Build Record Payment dialog and payment register; wire refresh through shared store revision/selectors.
8. Build dashboard summaries and Outstanding report, including CSV export of exactly the filtered results.
9. Build Settings, then run the acceptance checklist, responsive checks, and accessibility pass.

## 9. Future SQLite/API Seams

The UI imports repository interfaces from `repositories/contracts.ts` only. A future API client can implement the same interfaces; a SQLite-backed server then owns transactional validation.

Future relational tables should be organization-scoped from their first production migration: `organizations`, `users`, `clients`, `invoices`, `invoice_lines`, `payments`, and `settings`. Every billing-owned table except `organizations` includes `organization_id`, and every read/write query filters it from authenticated server context—not a client-supplied value. Invoice number uniqueness should be constrained by `(organization_id, invoice_number)`.

The transaction for payment creation must lock/read the invoice and current payment total, reject overpayment/void invoice conflicts, insert the payment, and return the refreshed invoice projection atomically. Issue and void transitions receive comparable transactional enforcement. The database/API is authoritative for role enforcement, audit metadata, current user identity, and clock/date behavior.

Suggested future API resource mapping:

- `GET/POST /api/clients`, `GET/PATCH /api/clients/:id`, `POST /api/clients/:id/archive`
- `GET/POST /api/invoices`, `GET /api/invoices/:id`, `PATCH /api/invoices/:id/draft`, `POST /api/invoices/:id/issue`, `POST /api/invoices/:id/void`
- `GET/POST /api/payments`
- `GET /api/dashboard`, `GET /api/reports/outstanding`
- `GET/PATCH /api/settings`

## 10. Test Strategy and Acceptance Checklist

### Automated tests

- Unit-test money calculations, invoice totals, status derivation, aging buckets, date boundaries, and all input validation.
- Repository tests cover role checks; inactive-client prevention; draft-only edit/delete; numbering on issue; overpayment rejection; payment-derived partial/paid state; overdue derivation; and unpaid-only void guard.
- Component tests cover required field errors, invoice line editing, confirmation wording, and disabled/hidden actions by role.
- End-to-end tests cover the happy path (client → draft → issue → partial payment → final payment), invalid overpayment, void guard, archive guard, report totals/CSV, and viewer restriction.

### Manual acceptance checklist

- [ ] All routes in the route map render with loading, empty, and error handling.
- [ ] Dashboard, invoice detail, client profile, and report reconcile after each mutation.
- [ ] All currency output uses settings currency and all dates remain the entered calendar date.
- [ ] An archived client cannot be chosen for a new invoice.
- [ ] Only a valid draft can be issued and its number is shown afterward.
- [ ] Payment entry never allows an amount above outstanding and reaches Paid at zero balance.
- [ ] Void is admin-only, reasoned, blocked after a payment, and leaves a read-only record.
- [ ] Settings affect new work only and do not mutate history.
- [ ] Keyboard navigation, focus management in dialogs, labels, contrast, and a 360px layout pass review.
- [ ] `npm run lint`, `npm run typecheck`, and the selected test suite pass before handoff.
