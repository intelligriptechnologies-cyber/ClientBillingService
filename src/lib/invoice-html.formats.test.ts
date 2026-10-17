import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION, snapshotFormat, type FormatDefinition } from './invoice-format';
import { renderInvoiceHtml } from './invoice-html';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const base: InvoiceSnapshot = { companyName: 'Nexio', gstin: '29AAGCB7383J1Z4', address: 'Bengaluru', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG, customerName: 'Buyer', customerEmail: 'b@example.com', customerAddress: 'Mumbai', gstRate: 18, footer: 'Thanks', documentType: 'Tax Invoice', sellerStateCode: '29', placeOfSupplyStateCode: '27', taxSplit: 'inter', customerGstin: '27AAGCB7383J1ZE', lines: [{ description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'igst', gstRate: 18, amountMinor: 100_000, gstMinor: 18_000, totalMinor: 118_000, hsnSac: '998311' }] };
const invoice = (snapshot: InvoiceSnapshot): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18, gstMinor: 18_000, totalMinor: 118_000, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't' });
const render = (patch: Omit<Partial<FormatDefinition>, 'blocks'> & { blocks?: Partial<FormatDefinition['blocks']> } = {}, snapshot: Partial<InvoiceSnapshot> = {}) => {
  const definition = { ...BUILTIN_DEFINITION, ...patch, blocks: { ...BUILTIN_DEFINITION.blocks, ...patch.blocks } };
  return renderInvoiceHtml(invoice({ ...base, ...snapshot, format: snapshotFormat({ id: 'f1', name: 'Test', definition }) }));
};

describe('renderInvoiceHtml prints from the snapshotted format', () => {
  it('HSN/SAC off removes the column and the code even though the lines still carry it', () => {
    const invoiceWithCode = invoice({ ...base, format: snapshotFormat({ id: 'f1', name: 'Test', definition: { ...BUILTIN_DEFINITION, blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: false } } }) });
    const html = renderInvoiceHtml(invoiceWithCode);
    expect(html).not.toContain('HSN/SAC');
    expect(html).not.toContain('998311');
    expect(invoiceWithCode.snapshot.lines?.[0].hsnSac).toBe('998311');
    expect(render()).toContain('<th>HSN/SAC</th>');
  });

  it('amount in words off removes the words and keeps the totals on the right', () => {
    expect(render()).toContain('Indian Rupees One Thousand One Hundred Eighty Only');
    const html = render({ blocks: { amountInWords: false } });
    expect(html).not.toContain('Indian Rupees');
    expect(html).not.toContain('Amount in words');
    expect(html).toContain('<div class="words"></div>');
    expect(html).toContain('₹1,180.00');
  });

  it('signature and stamp switch their own image, and the signatory line goes only when both are off', () => {
    const both = render();
    expect(both).toContain('alt="Authorised signature"');
    expect(both).toContain('alt="Company stamp"');
    const noSignature = render({ blocks: { signature: false } });
    expect(noSignature).not.toContain('alt="Authorised signature"');
    expect(noSignature).toContain('alt="Company stamp"');
    expect(noSignature).toContain('Authorised signatory');
    const neither = render({ blocks: { signature: false, stamp: false } });
    expect(neither).not.toContain('alt="Company stamp"');
    expect(neither).not.toContain('Authorised signatory');
  });

  it('logo hide drops the logo only', () => {
    expect(render()).toContain('alt="Logo"');
    const html = render({ logo: 'hide' });
    expect(html).not.toContain('alt="Logo"');
    expect(html).toContain('alt="Company stamp"');
  });

  it('bank details print their text with its line breaks when on, and nothing when off or empty', () => {
    const on = render({ bankDetails: 'HDFC Bank\nA/C 5020000123' });
    expect(on).toContain('<h3>Bank details</h3>');
    expect(on).toContain('HDFC Bank\nA/C 5020000123');
    expect(render({ bankDetails: 'HDFC Bank', blocks: { bankDetails: false } })).not.toContain('HDFC Bank');
    expect(render({ bankDetails: '' })).not.toContain('Bank details');
  });

  it('terms print when on and have text, and nothing otherwise', () => {
    expect(render({ terms: 'Payable within 14 days.' })).toContain('Payable within 14 days.');
    expect(render({ terms: 'Payable within 14 days.', blocks: { terms: false } })).not.toContain('Payable within 14 days.');
    expect(render({ terms: '' })).not.toContain('<h3>Terms</h3>');
  });

  it('the UPI slot is a labelled empty box with no image and no link, and is off by default', () => {
    expect(render()).not.toContain('upi-slot');
    const html = render({ blocks: { upiQr: true } });
    expect(html).toContain('class="upi-slot"');
    expect(html).toContain('UPI QR');
    expect(html.match(/<img /g)?.length).toBe(3);
    expect(html).not.toMatch(/https?:\/\/|upi:\/\//);
  });

  it('the accent colour reaches the rule and the table headings, and only then', () => {
    const html = render({ accent: '#1f3a5f' });
    expect(html).toContain('border-bottom: 2px solid #1f3a5f');
    expect(html).toContain('background: #1f3a5f');
    expect(html).not.toContain('#11756c');
    expect(render()).toContain('#11756c');
  });

  it('compact is a denser layout than classic, not just a different name', () => {
    const classic = render();
    const compact = render({ layout: 'compact' });
    expect(classic).not.toContain('compact');
    expect(compact).toContain('<main class="sheet compact">');
    expect(compact).toMatch(/\.compact \.lines td \{ padding: 3px 5px;/);
    expect(compact.length).toBeGreaterThan(classic.length);
  });

  it('a format whose text is hostile cannot add markup', () => {
    const html = render({ bankDetails: '<script>alert(1)</script>', terms: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('prints the format name nowhere on the invoice', () => {
    expect(render()).not.toContain('Test');
  });
});
