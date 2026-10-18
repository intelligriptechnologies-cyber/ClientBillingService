import { describe, expect, it } from 'vitest';
import { parseFormatDefinition, snapshotFormat, type FormatDefinition } from './invoice-format';
import { renderInvoiceHtml } from './invoice-html';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const line = { description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst' as const, gstRate: 18, amountMinor: 100_000, gstMinor: 18_000, totalMinor: 118_000, hsnSac: '998311' };
const base: InvoiceSnapshot = { companyName: 'Nexio', gstin: '29AAGCB7383J1Z4', address: 'Bengaluru', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG, customerName: 'Buyer', customerEmail: 'b@example.com', customerAddress: 'Mumbai', gstRate: 18, footer: 'Thanks', documentType: 'Tax Invoice', sellerStateCode: '29', placeOfSupplyStateCode: '29', taxSplit: 'intra', lines: [line] };
const invoice = (snapshot: InvoiceSnapshot): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18, gstMinor: 18_000, totalMinor: 118_000, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't' });

/** A definition exactly as stored before the panel layout: no accentSecondary, no upiId, no upiId block. */
const storedBeforePanel = (layout: 'classic' | 'compact'): string => JSON.stringify({ layout, blocks: { hsnSac: true, bankDetails: true, upiQr: true, signature: true, stamp: true, terms: true, amountInWords: true }, accent: '#1f3a5f', logo: 'show', bankDetails: 'Test Bank\nA/C 0000000000', terms: 'Payable within 14 days.' });
const snapshotFor = (layout: 'classic' | 'compact') => invoice({ ...base, format: { id: 'old', name: 'Old', definition: JSON.parse(storedBeforePanel(layout)) as FormatDefinition } });

describe('a format snapshotted before the panel layout still prints byte for byte', () => {
  it('classic', async () => { await expect(renderInvoiceHtml(snapshotFor('classic'))).toMatchFileSnapshot('./__legacy__/formatted-classic.html'); });
  it('compact', async () => { await expect(renderInvoiceHtml(snapshotFor('compact'))).toMatchFileSnapshot('./__legacy__/formatted-compact.html'); });

  it('the stored row parses without gaining fields, so it saves back as it was', () => {
    for (const layout of ['classic', 'compact'] as const) {
      const parsed = parseFormatDefinition(JSON.parse(storedBeforePanel(layout)));
      expect(JSON.stringify(parsed)).toBe(storedBeforePanel(layout));
      expect(renderInvoiceHtml(invoice({ ...base, format: snapshotFormat({ id: 'old', name: 'Old', definition: parsed }) }))).toBe(renderInvoiceHtml(snapshotFor(layout)));
    }
  });
});
