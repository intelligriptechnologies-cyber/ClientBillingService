import { describe, expect, it } from 'vitest';
import { documentTitle, invoicePdfContent, printsGstColumns } from './invoice-document';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const base: InvoiceSnapshot = { companyName: 'Nexio', gstin: '', address: 'Bengaluru', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', customerName: 'Buyer', customerEmail: 'b@example.com', customerAddress: 'Mumbai', gstRate: 0, footer: 'Thanks' };
const line = { description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst' as const, gstRate: 18, amountMinor: 100_000, gstMinor: 18_000, totalMinor: 118_000, hsnSac: '998311' };
const invoice = (snapshot: InvoiceSnapshot, gstMinor = 18_000): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18, gstMinor, totalMinor: 100_000 + gstMinor, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't' });

describe('invoice document', () => {
  it('titles a Tax Invoice with its legal name, GSTIN, place of supply and per-line tax', () => {
    const { title, lines } = invoicePdfContent(invoice({ ...base, documentType: 'Tax Invoice', gstin: '29AAGCB7383J1Z4', sellerLegalName: 'Nexio Private Limited', placeOfSupplyStateCode: '27', lines: [line] }));
    expect(title).toBe('TAX INVOICE NX-0001');
    expect(lines).toEqual(expect.arrayContaining(['Legal name: Nexio Private Limited', 'GSTIN: 29AAGCB7383J1Z4', 'Place of supply: Maharashtra', 'GST: ₹180.00']));
    expect(lines.find((text) => text.startsWith('Consulting'))).toBe('Consulting  |  HSN/SAC 998311  |  1 x ₹1,000.00  |  CGST + SGST 18%  |  ₹1,180.00');
  });

  it('prints a Bill of Supply without GST columns or a GSTIN line when the seller has none', () => {
    const snapshot = { ...base, documentType: 'Bill of Supply' as const, lines: [{ ...line, taxType: 'none' as const, gstRate: 0, gstMinor: 0, totalMinor: 100_000 }] };
    const { title, lines } = invoicePdfContent(invoice(snapshot, 0));
    expect(title).toBe('BILL OF SUPPLY NX-0001');
    expect(lines.join('\n')).not.toMatch(/GSTIN:|GST:|No GST/);
    expect(printsGstColumns(snapshot)).toBe(false);
  });

  it('keeps the plain title and columns of invoices issued before document types existed', () => {
    expect(documentTitle(base)).toBe('Invoice');
    expect(printsGstColumns(base)).toBe(true);
    const { title, lines } = invoicePdfContent(invoice({ ...base, lines: [{ ...line, hsnSac: undefined }] }));
    expect(title).toBe('INVOICE NX-0001');
    expect(lines).toEqual(expect.arrayContaining(['GSTIN: ', 'GST: ₹180.00']));
  });
});
