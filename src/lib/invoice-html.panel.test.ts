import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION, snapshotFormat, type FormatDefinition } from './invoice-format';
import { sampleInvoice } from './invoice-format-sample';
import { renderInvoiceHtml } from './invoice-html';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const taxedLine = { description: 'Hall rental', quantity: 2, rateMinor: 150_050, taxType: 'cgst_sgst' as const, gstRate: 18, amountMinor: 300_100, gstMinor: 54_018, totalMinor: 354_118, hsnSac: '998311' };
const plainLine = { description: 'Stock app subscription', quantity: 2, rateMinor: 250_000, taxType: 'none' as const, gstRate: 0, amountMinor: 500_000, gstMinor: 0, totalMinor: 500_000, hsnSac: '' };
const base: InvoiceSnapshot = { companyName: 'Seller Co', gstin: '29AAGCB7383J1Z4', address: '1 Test Street\nTestville', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG, customerName: 'Buyer Shop', customerEmail: '', customerAddress: '9 Sample Road\nNowhere', gstRate: 18, footer: 'Thanks', documentType: 'Tax Invoice', sellerStateCode: '29', placeOfSupplyStateCode: '29', taxSplit: 'intra', lines: [taxedLine], notes: 'Pay by NEFT within 7 days.' };
const taxedInvoice = (snapshot: InvoiceSnapshot): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer Shop', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 300_100, gstRate: 18, gstMinor: 54_018, totalMinor: 354_118, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't' });
const supplyInvoice = (snapshot: InvoiceSnapshot): TenantInvoice => ({ ...taxedInvoice(snapshot), taxableMinor: 500_000, gstRate: 0, gstMinor: 0, totalMinor: 500_000 });

const panel: FormatDefinition = { ...BUILTIN_DEFINITION, layout: 'panel', accent: '#092a50', accentSecondary: '#079c9d', bankDetails: 'Account Name: Test Holder\nBank Name: Test Bank\nAccount Number: 000000000000\nIFSC Code: TEST0000000', upiId: 'test@upi.example', blocks: { ...BUILTIN_DEFINITION.blocks, upiId: true } };
const withFormat = (snapshot: InvoiceSnapshot, definition: FormatDefinition = panel): InvoiceSnapshot => ({ ...snapshot, format: snapshotFormat({ id: 'panel', name: 'Panel', definition }) });
const gstHtml = (definition?: FormatDefinition) => renderInvoiceHtml(taxedInvoice(withFormat(base, definition)));
const supplyHtml = (definition?: FormatDefinition) => renderInvoiceHtml(supplyInvoice(withFormat({ ...base, documentType: 'Bill of Supply', gstin: '', lines: [plainLine], taxSplit: undefined }, definition)));
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

describe('the Panel layout', () => {
  it('prints the sections of the sample in order, for a non-GST bill of supply', () => {
    const html = supplyHtml();
    const labels = ['Bill of Supply', 'Invoice No:', 'BILL TO', 'Buyer Shop', 'ISSUED BY', 'Seller Co', 'DESCRIPTION', 'RATE', 'QTY', 'AMOUNT', 'Stock app subscription', 'BANK DETAILS', 'UPI ID: test@upi.example', 'Subtotal', 'GST (if applicable)', 'TOTAL PAYABLE', 'Amount in words: Indian Rupees Five Thousand Only', 'Notes', 'Pay by NEFT within 7 days.', 'Authorized Signatory'];
    let at = -1;
    for (const label of labels) {
      const found = html.indexOf(label);
      expect(found, label).toBeGreaterThan(at);
      at = found;
    }
    expect(html).toContain('<main class="sheet">');
  });

  it('a bill of supply has no HSN or tax columns, a GST row of zero and the payable total', () => {
    const html = supplyHtml();
    expect(html).not.toContain('HSN/SAC');
    expect(html).not.toContain('TAXABLE VALUE');
    expect(html).not.toMatch(/CGST|SGST|IGST/);
    expect(html).toMatch(/GST \(if applicable\)<\/th><td>₹0\.00<\/td>/);
    expect(html).toMatch(/Subtotal<\/th><td>₹5,000\.00<\/td>/);
    expect(html).toMatch(/TOTAL PAYABLE<\/th><td>₹5,000\.00<\/td>/);
    expect(html).not.toContain('Round off');
  });

  it('pads the items table with empty ruled rows to a minimum of four', () => {
    const rows = supplyHtml().match(/<tr class="pn-filler">/g) ?? [];
    expect(rows).toHaveLength(3);
    const many = renderInvoiceHtml(supplyInvoice(withFormat({ ...base, documentType: 'Bill of Supply', lines: Array.from({ length: 5 }, () => plainLine) })));
    expect(many).not.toContain('<tr class="pn-filler">');
  });

  it('a GST invoice keeps the HSN column, the tax columns and the CGST and SGST rows', () => {
    const html = gstHtml();
    expect(html).toContain('>HSN/SAC</th>');
    expect(html).toContain('998311');
    expect(html).toContain('TAXABLE VALUE');
    expect(html).toContain('GSTIN: 29AAGCB7383J1Z4');
    expect(html).toMatch(/Subtotal<\/th><td>₹3,001\.00<\/td>/);
    expect(html).toMatch(/CGST<\/th><td>₹270\.09<\/td>/);
    expect(html).toMatch(/SGST<\/th><td>₹270\.09<\/td>/);
    expect(html).not.toContain('GST (if applicable)');
    expect(html).toMatch(/Round off<\/th><td>-₹0\.18<\/td>/);
    expect(html).toMatch(/TOTAL PAYABLE<\/th><td>₹3,541\.00<\/td>/);
    expect(text(html)).toContain('Amount in words: Indian Rupees Three Thousand Five Hundred Forty One Only');
  });

  it('an interstate GST invoice prints IGST once', () => {
    const interstate = { ...taxedLine, taxType: 'igst' as const };
    const html = renderInvoiceHtml(taxedInvoice(withFormat({ ...base, taxSplit: 'inter', placeOfSupplyStateCode: '27', lines: [interstate] })));
    expect(html).toMatch(/IGST<\/th><td>₹540\.18<\/td>/);
    expect(html).not.toMatch(/CGST|SGST/);
  });

  it('HSN off removes the column on a GST invoice, as in the other layouts', () => {
    const html = gstHtml({ ...panel, blocks: { ...panel.blocks, hsnSac: false } });
    expect(html).not.toContain('HSN/SAC');
    expect(html).not.toContain('998311');
    expect(html).toContain('CGST');
  });

  it('the primary accent heads the first columns and the secondary accent heads the figures', () => {
    const html = supplyHtml();
    expect(html).toMatch(/\.pn-lines th\.pn-a \{ background: #092a50;/);
    expect(html).toMatch(/\.pn-lines th\.pn-b \{ background: #079c9d;/);
    expect(html).toMatch(/<th class="pn-a">#<\/th><th class="pn-a">DESCRIPTION<\/th><th class="pn-b num">RATE<\/th>/);
  });

  it('a panel format without a secondary accent derives it from the accent', () => {
    const { accentSecondary: _unused, ...single } = panel;
    void _unused;
    const html = supplyHtml(single);
    expect(html).toMatch(/\.pn-lines th\.pn-b \{ background: #092a50;/);
  });

  it('the UPI ID is plain text from its own block, apart from the QR slot, and is never a link', () => {
    const only = supplyHtml();
    expect(only).toContain('UPI ID: test@upi.example');
    expect(only).not.toContain('class="upi-slot"');
    expect(only).not.toMatch(/https?:\/\/|upi:\/\//);
    expect(supplyHtml({ ...panel, blocks: { ...panel.blocks, upiId: false } })).not.toContain('test@upi.example');
    expect(supplyHtml({ ...panel, upiId: '' })).not.toContain('UPI ID');
    const qr = supplyHtml({ ...panel, blocks: { ...panel.blocks, upiQr: true } });
    expect(qr).toContain('class="upi-slot"');
    expect(qr).toContain('UPI ID: test@upi.example');
  });

  it('the bank panel, notes and signatory follow their switches and the empty panel disappears', () => {
    const none = supplyHtml({ ...panel, bankDetails: '', upiId: '' });
    expect(none).not.toContain('BANK DETAILS');
    expect(none).not.toContain('class="pn-bank"');
    const noMarks = supplyHtml({ ...panel, blocks: { ...panel.blocks, signature: false, stamp: false, amountInWords: false } });
    expect(noMarks).not.toContain('Authorized Signatory');
    expect(noMarks).not.toContain('Amount in words');
    expect(supplyHtml()).toContain('alt="Authorised signature"');
    expect(supplyHtml()).toContain('alt="Company stamp"');
    expect(supplyHtml({ ...panel, logo: 'hide' })).not.toContain('alt="Logo"');
  });

  it('hostile text in the UPI ID and bank details cannot add markup', () => {
    const html = supplyHtml({ ...panel, upiId: '<script>alert(1)</script>', bankDetails: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });

  it('prints from the sample invoice used by the settings preview, with a tinted panel and no network reference', () => {
    const branding = { companyName: 'Nexio Hyper', legalName: '', gstin: '', address: '', footer: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '' };
    const html = renderInvoiceHtml(sampleInvoice(branding, snapshotFormat({ id: 'p', name: 'Preview', definition: panel })));
    expect(html).toContain('BILL TO');
    expect(html).toContain('HSN/SAC');
    expect(html).not.toMatch(/<script|https?:\/\//);
  });
});
