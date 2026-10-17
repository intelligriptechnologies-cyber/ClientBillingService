import { describe, expect, it } from 'vitest';
import { renderBulkPreviewHtml } from './bulk-preview-html';
import { renderInvoiceHtml } from './invoice-html';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const base: InvoiceSnapshot = { companyName: 'Nexio', gstin: '29AAGCB7383J1Z4', address: 'Bengaluru', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG, customerName: 'Buyer', customerEmail: 'b@example.com', customerAddress: 'Mumbai', gstRate: 18, footer: 'Thanks', invoiceTemplate: 'Invoice {{invoiceNumber}} for {{customerName}}', notes: 'Pay by bank transfer.' };
const line = { description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst' as const, gstRate: 18, amountMinor: 100_000, gstMinor: 18_000, totalMinor: 118_000, hsnSac: '998311' };
const invoice = (snapshot: InvoiceSnapshot): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18, gstMinor: 18_000, totalMinor: 118_000, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't' });

/** Output captured before invoice formats existed. An invoice with no snapshotted format must keep printing exactly this. */
const expectFile = (html: string, name: string) => expect(html).toMatchFileSnapshot(`./__legacy__/${name}.html`);

describe('legacy invoices without a snapshotted format print byte for byte as they always did', () => {
  it('a Tax Invoice with every branding image and an HSN column', async () => {
    await expectFile(renderInvoiceHtml(invoice({ ...base, documentType: 'Tax Invoice', sellerLegalName: 'Nexio Private Limited', sellerStateCode: '29', placeOfSupplyStateCode: '27', taxSplit: 'inter', customerGstin: '27AAGCB7383J1ZE', lines: [{ ...line, taxType: 'igst' }] })), 'tax-invoice');
  });

  it('a Bill of Supply with no branding', async () => {
    await expectFile(renderInvoiceHtml(invoice({ ...base, gstin: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', documentType: 'Bill of Supply', lines: [{ ...line, taxType: 'none', gstRate: 0, gstMinor: 0, totalMinor: 100_000, hsnSac: '' }] })), 'bill-of-supply');
  });

  it('an invoice from before line items existed', async () => {
    await expectFile(renderInvoiceHtml(invoice({ ...base, taxSplit: 'intra' })), 'pre-line-items');
  });

  it('the bulk preview that shares the document shell', async () => {
    await expectFile(renderBulkPreviewHtml({ billingPeriod: '2026-10', proposed: [], skipped: [{ contractId: 's', contractName: 'Lapsed', customerName: 'Beta', reason: 'Contract ended' }] }, { companyName: 'Nexio', logoDataUrl: PNG }), 'bulk-preview');
  });
});
