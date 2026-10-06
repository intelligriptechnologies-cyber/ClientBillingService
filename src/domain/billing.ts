import type { CalendarDate, Invoice, InvoiceLine, InvoiceStatus, OutstandingRow, Payment } from './types';

export const sumLines = (lines: InvoiceLine[]) => lines.reduce((total, line) => total + line.lineTotalMinor, 0);
export const paidForInvoice = (payments: Payment[], invoiceId: string) => payments.filter((payment) => payment.invoiceId === invoiceId).reduce((total, payment) => total + payment.amountMinor, 0);
export const outstandingForInvoice = (invoice: Invoice, payments: Payment[]) => invoice.status === 'void' ? 0 : Math.max(0, invoice.totalMinor - paidForInvoice(payments, invoice.id));
export const todayDate = (): CalendarDate => new Date().toLocaleDateString('en-CA') as CalendarDate;
export const isBefore = (left: string, right: string) => left < right;
export function deriveInvoiceStatus(invoice: Invoice, payments: Payment[], today = todayDate()): InvoiceStatus {
  if (invoice.status === 'draft' || invoice.status === 'void') return invoice.status;
  const outstanding = outstandingForInvoice(invoice, payments);
  if (outstanding === 0) return 'paid';
  if (isBefore(invoice.dueDate, today)) return 'overdue';
  return paidForInvoice(payments, invoice.id) > 0 ? 'partial' : 'issued';
}
export function daysOverdue(dueDate: string, today = todayDate()): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const due = toUtc(dueDate);
  const now = toUtc(today);
  return Math.max(0, Math.floor((now - due) / 86_400_000));
}
export function agingBucket(days: number): OutstandingRow['agingBucket'] { if (days === 0) return 'Current'; if (days <= 30) return '1–30'; if (days <= 60) return '31–60'; if (days <= 90) return '61–90'; return '90+'; }
export function validateInvoiceLines(lines: InvoiceLine[]) { if (!lines.length) return 'Add at least one line item.'; for (const line of lines) { if (!line.description.trim()) return 'Each line requires a description.'; if (!Number.isFinite(line.quantity) || line.quantity <= 0) return 'Line quantity must be greater than zero.'; if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) return 'Line price must be zero or greater.'; } return null; }
