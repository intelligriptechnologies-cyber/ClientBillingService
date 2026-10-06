export type Role = 'admin' | 'billing' | 'viewer';
export type ClientStatus = 'active' | 'archived';
export type InvoiceStatus = 'draft' | 'issued' | 'partial' | 'paid' | 'overdue' | 'void';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
export type CalendarDate = `${number}-${number}-${number}`;

export interface Actor { id: string; name: string; role: Role; }
export interface Client { id: string; displayName: string; companyName?: string; email?: string; phone?: string; billingAddress?: string; note?: string; status: ClientStatus; createdAt: string; updatedAt: string; }
export interface InvoiceLine { id: string; description: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; }
export interface Invoice { id: string; clientId: string; invoiceNumber?: string; invoiceDate: string; dueDate: string; status: InvoiceStatus; lines: InvoiceLine[]; note?: string; totalMinor: number; issuedAt?: string; voidedAt?: string; voidedBy?: string; voidReason?: string; createdAt: string; updatedAt: string; }
export interface Payment { id: string; invoiceId: string; paymentDate: string; amountMinor: number; method: PaymentMethod; reference?: string; note?: string; recordedBy: string; createdAt: string; }
export interface Settings { businessName: string; currencyCode: string; invoiceNumberPrefix: string; defaultPaymentTermsDays: number; updatedAt: string; }

export interface InvoiceView extends Invoice { client: Client; paidMinor: number; outstandingMinor: number; displayStatus: InvoiceStatus; }
export interface PaymentView extends Payment { invoice: InvoiceView; client: Client; }
export interface ClientBalance extends Client { lifetimeInvoicedMinor: number; outstandingMinor: number; }
export interface DashboardSummary { totalInvoicedMinor: number; totalCollectedMinor: number; totalOutstandingMinor: number; overdueMinor: number; overdueInvoices: InvoiceView[]; }
export interface OutstandingRow extends InvoiceView { daysOverdue: number; agingBucket: 'Current' | '1–30' | '31–60' | '61–90' | '90+'; }
export interface OutstandingReport { items: OutstandingRow[]; totalOutstandingMinor: number; buckets: Record<OutstandingRow['agingBucket'], number>; }
export class DomainError extends Error { constructor(public readonly code: 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT', message: string) { super(message); this.name = 'DomainError'; } }
