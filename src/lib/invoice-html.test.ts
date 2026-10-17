import { describe, expect, it } from 'vitest';
import { renderInvoiceHtml } from './invoice-html';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SELLER_GSTIN = '29AAGCB7383J1Z4';
const CLIENT_GSTIN = '27AAGCB7383J1ZE';

const base: InvoiceSnapshot = { companyName: 'Nexio', gstin: '', address: 'Bengaluru', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', customerName: 'Buyer', customerEmail: 'b@example.com', customerAddress: 'Mumbai', gstRate: 0, footer: 'Thanks' };
const taxedLine = { description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst' as const, gstRate: 18, amountMinor: 100_000, gstMinor: 18_000, totalMinor: 118_000, hsnSac: '998311' };
const invoice = (snapshot: InvoiceSnapshot, overrides: Partial<TenantInvoice> = {}): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18, gstMinor: 18_000, totalMinor: 118_000, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't', ...overrides });
const taxInvoice = (extra: Partial<InvoiceSnapshot> = {}, overrides: Partial<TenantInvoice> = {}) => invoice({ ...base, documentType: 'Tax Invoice', gstin: SELLER_GSTIN, sellerLegalName: 'Nexio Private Limited', sellerStateCode: '29', placeOfSupplyStateCode: '27', taxSplit: 'inter', customerGstin: CLIENT_GSTIN, lines: [{ ...taxedLine, taxType: 'igst' }], ...extra }, overrides);
const billOfSupply = () => invoice({ ...base, documentType: 'Bill of Supply', lines: [{ ...taxedLine, taxType: 'none', gstRate: 0, gstMinor: 0, totalMinor: 100_000, hsnSac: '' }] }, { gstMinor: 0, totalMinor: 100_000, gstRate: 0 });
const render = renderInvoiceHtml;

describe('renderInvoiceHtml', () => {
  it('is a complete standalone document with no scripts and nothing fetched from the network', () => {
    const html = render(taxInvoice());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('prints the rupee symbol and the invoice identity', () => {
    const html = render(taxInvoice());
    expect(html).toContain('₹1,000.00');
    expect(html).toContain('₹1,180.00');
    expect(html).not.toContain('INR');
    expect(html).toContain('NX-0001');
    expect(html).toContain('02 Nov 2026');
    expect(html).toContain('16 Nov 2026');
  });

  it('titles a Tax Invoice with seller and client GSTIN and states, and the place of supply', () => {
    const html = render(taxInvoice());
    expect(html).toContain('<h1>Tax Invoice</h1>');
    expect(html).toContain('Nexio Private Limited');
    expect(html).toContain(SELLER_GSTIN);
    expect(html).toContain('Karnataka');
    expect(html).toContain(CLIENT_GSTIN);
    expect(html).toContain('Place of supply');
    expect(html.match(/Maharashtra/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the HSN/SAC column and each line with its tax label and per-line values', () => {
    const html = render(taxInvoice());
    expect(html).toContain('<th>HSN/SAC</th>');
    expect(html).toContain('998311');
    expect(html).toContain('IGST 18%');
    expect(html).toContain('₹180.00');
  });

  it('drops the HSN/SAC column when no line carries a code', () => {
    const html = render(taxInvoice({ lines: [{ ...taxedLine, hsnSac: undefined, taxType: 'igst' }] }));
    expect(html).not.toContain('HSN/SAC');
  });

  it('splits intra-state tax into CGST and SGST and inter-state tax into IGST', () => {
    const intra = render(taxInvoice({ taxSplit: 'intra', lines: [taxedLine] }));
    expect(intra).toContain('CGST');
    expect(intra).toContain('SGST');
    expect(intra).not.toMatch(/>IGST</);
    const inter = render(taxInvoice());
    expect(inter).toMatch(/>IGST</);
    expect(inter).not.toMatch(/>CGST</);
  });

  it('titles a Bill of Supply and hides every GST column and total', () => {
    const html = render(billOfSupply());
    expect(html).toContain('<h1>Bill of Supply</h1>');
    expect(html).not.toContain('Tax Invoice');
    expect(html).not.toMatch(/GSTIN|CGST|SGST|IGST|GST|HSN/);
    expect(html).toContain('Value of supply');
    expect(html).toContain('₹1,000.00');
  });

  it('keeps the plain title and the GST columns of invoices issued before document types existed', () => {
    const html = render(invoice({ ...base, lines: [{ ...taxedLine, hsnSac: undefined }] }));
    expect(html).toContain('<h1>Invoice</h1>');
    expect(html).toContain('CGST + SGST 18%');
  });

  it('gives an invoice without line items one row built from its totals', () => {
    const html = render(invoice({ ...base, gstRate: 18, taxSplit: 'intra' }));
    expect(html).toContain('₹1,000.00');
    expect(html).toContain('CGST + SGST 18%');
  });

  it('rounds the amount payable to the rupee, shows the round-off, and writes the amount in Indian words', () => {
    const whole = render(taxInvoice());
    expect(whole).toContain('Round off');
    expect(whole).toContain('Indian Rupees One Thousand One Hundred Eighty Only');
    const up = render(taxInvoice({}, { totalMinor: 118_058 }));
    expect(up).toContain('₹1,180.58');
    expect(up).toContain('+₹0.42');
    expect(up).toContain('₹1,181.00');
    expect(up).toContain('Indian Rupees One Thousand One Hundred Eighty One Only');
    const down = render(taxInvoice({}, { totalMinor: 118_049 }));
    expect(down).toContain('-₹0.49');
    expect(down).toContain('Indian Rupees One Thousand One Hundred Eighty Only');
  });

  it('embeds the logo, stamp and signature from their stored data URLs', () => {
    const html = render(taxInvoice({ logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG }));
    expect(html.match(new RegExp(`<img [^>]*src="${PNG}"`, 'g'))).toHaveLength(3);
    expect(html).toMatch(/alt="Logo"/);
    expect(html).toMatch(/alt="Company stamp"/);
    expect(html).toMatch(/alt="Authorised signature"/);
  });

  it('draws no image for branding that was never uploaded or is not an inline image', () => {
    expect(render(taxInvoice())).not.toContain('<img');
    const html = render(taxInvoice({ logoDataUrl: 'https://evil.example/logo.png', stampDataUrl: 'javascript:alert(1)', signatureDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }));
    expect(html).not.toContain('<img');
  });

  it('substitutes the template placeholders in a heading line', () => {
    const html = render(taxInvoice({ invoiceTemplate: 'Invoice {{invoiceNumber}} for {{customerName}}' }));
    expect(html).toContain('Invoice NX-0001 for Buyer');
  });

  it('escapes every user supplied string', () => {
    const hostile = '<script>alert(1)</script>"\'&';
    const html = render(taxInvoice({
      companyName: `Co ${hostile}`, sellerLegalName: `Legal ${hostile}`, address: `Addr ${hostile}`, customerName: `Cust ${hostile}`, customerEmail: `mail ${hostile}`, customerAddress: `CAddr ${hostile}`,
      customerPan: `PAN ${hostile}`, venue: `Venue ${hostile}`, notes: `Notes ${hostile}`, footer: `Foot ${hostile}`, lines: [{ ...taxedLine, description: `Line ${hostile}`, taxType: 'igst' }],
      invoiceTemplate: `Tpl ${hostile} {{customerName}}`,
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)</script>');
    expect(html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;/g)?.length).toBeGreaterThanOrEqual(10);
  });
});
