import { describe, expect, it } from 'vitest';
import { documentTitle, lineTaxLabel, printsGstColumns } from './invoice-document';
import type { InvoiceSnapshot } from './tenant-store';

const base: InvoiceSnapshot = { companyName: 'Nexio', gstin: '', address: 'Bengaluru', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', customerName: 'Buyer', customerEmail: 'b@example.com', customerAddress: 'Mumbai', gstRate: 0, footer: 'Thanks' };

describe('invoice document', () => {
  it('titles a Tax Invoice and prints its GST columns', () => {
    const snapshot: InvoiceSnapshot = { ...base, documentType: 'Tax Invoice' };
    expect(documentTitle(snapshot)).toBe('Tax Invoice');
    expect(printsGstColumns(snapshot)).toBe(true);
  });

  it('titles a Bill of Supply and prints no GST columns', () => {
    const snapshot: InvoiceSnapshot = { ...base, documentType: 'Bill of Supply' };
    expect(documentTitle(snapshot)).toBe('Bill of Supply');
    expect(printsGstColumns(snapshot)).toBe(false);
  });

  it('keeps the plain title and columns of invoices issued before document types existed', () => {
    expect(documentTitle(base)).toBe('Invoice');
    expect(printsGstColumns(base)).toBe(true);
  });

  it('labels the tax on a line by its type and rate', () => {
    expect(lineTaxLabel({ taxType: 'cgst_sgst', gstRate: 18 })).toBe('CGST + SGST 18%');
    expect(lineTaxLabel({ taxType: 'igst', gstRate: 5 })).toBe('IGST 5%');
    expect(lineTaxLabel({ taxType: 'none', gstRate: 0 })).toBe('No GST');
  });
});
