import { describe, expect, it } from 'vitest';
import { agingBucket, daysOverdue, deriveInvoiceStatus, outstandingForInvoice, sumLines, validateInvoiceLines } from './billing';
import type { Invoice, Payment } from './types';

const invoice: Invoice = { id:'i1', clientId:'c1', invoiceNumber:'T-1', invoiceDate:'2026-01-01', dueDate:'2026-01-10', status:'issued', lines:[], totalMinor:10000, createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' };
const payment: Payment = { id:'p1', invoiceId:'i1', paymentDate:'2026-01-05', amountMinor:4000, method:'cash', recordedBy:'u1', createdAt:'2026-01-05T00:00:00Z' };
describe('billing lifecycle', () => {
  it('derives partial and overdue status from payments and dates', () => {
    expect(deriveInvoiceStatus(invoice, [payment], '2026-01-08')).toBe('partial');
    expect(deriveInvoiceStatus(invoice, [payment], '2026-01-11')).toBe('overdue');
  });
  it('calculates void and paid balances safely', () => {
    expect(outstandingForInvoice(invoice, [payment])).toBe(6000);
    expect(outstandingForInvoice({...invoice, status:'void'}, [])).toBe(0);
  });
  it('assigns aging buckets at each boundary', () => {
    expect(agingBucket(0)).toBe('Current'); expect(agingBucket(30)).toBe('1–30'); expect(agingBucket(61)).toBe('61–90'); expect(agingBucket(91)).toBe('90+');
  });
  it('uses only non-void invoice value in outstanding calculations', () => {
    expect(outstandingForInvoice({ ...invoice, status: 'void' }, [payment])).toBe(0);
    expect(deriveInvoiceStatus({ ...invoice, status: 'void' }, [payment], '2026-02-01')).toBe('void');
  });
  it('treats an exact settlement as paid and caps outstanding at zero', () => {
    const settled = { ...payment, amountMinor: 10000 };
    expect(outstandingForInvoice(invoice, [settled])).toBe(0);
    expect(deriveInvoiceStatus(invoice, [settled], '2026-01-08')).toBe('paid');
  });
  it('calculates calendar-day aging without local-time drift', () => {
    expect(daysOverdue('2026-01-10', '2026-01-10')).toBe(0);
    expect(daysOverdue('2026-01-10', '2026-01-11')).toBe(1);
    expect(daysOverdue('2026-01-10', '2026-01-09')).toBe(0);
  });
  it('validates line requirements and sums integer minor units', () => {
    expect(validateInvoiceLines([])).toBe('Add at least one line item.');
    expect(validateInvoiceLines([{ id:'l1', description:' ', quantity:1, unitPriceMinor:0, lineTotalMinor:0 }])).toBe('Each line requires a description.');
    expect(validateInvoiceLines([{ id:'l1', description:'Work', quantity:0, unitPriceMinor:0, lineTotalMinor:0 }])).toBe('Line quantity must be greater than zero.');
    const lines = [{ id:'l1', description:'Work', quantity:2, unitPriceMinor:1500, lineTotalMinor:3000 }];
    expect(validateInvoiceLines(lines)).toBeNull();
    expect(sumLines(lines)).toBe(3000);
  });
});
