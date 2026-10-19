import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION, snapshotFormat, type FormatDefinition, type LayoutId } from './invoice-format';
import { sampleInvoice } from './invoice-format-sample';
import { renderInvoiceHtml } from './invoice-html';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const taxedLine = { description: 'Hall rental', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst' as const, gstRate: 18, amountMinor: 100_000, gstMinor: 18_000, totalMinor: 118_000, hsnSac: '998311' };
const plainLine = { description: 'Deposit', quantity: 1, rateMinor: 100_000, taxType: 'none' as const, gstRate: 0, amountMinor: 100_000, gstMinor: 0, totalMinor: 100_000, hsnSac: '' };
const taxInvoice: InvoiceSnapshot = { companyName: 'Seller Co', gstin: '29AAGCB7383J1Z4', address: 'Bengaluru', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG, customerName: 'Buyer', customerEmail: '', customerAddress: 'Mumbai', gstRate: 18, footer: 'Thanks', documentType: 'Tax Invoice', sellerStateCode: '29', placeOfSupplyStateCode: '29', taxSplit: 'intra', lines: [taxedLine], hsnRequired: true };
const invoiceOf = (snapshot: InvoiceSnapshot, overrides: Partial<TenantInvoice> = {}): TenantInvoice => ({ id: 'i', tenantId: 't', contractId: null, customerId: 'c', customerName: 'Buyer', invoiceNumber: 'NX-0001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18, gstMinor: 18_000, totalMinor: 118_000, paidMinor: 0, status: 'issued', snapshot, issuedAt: 't', ...overrides });
const withFormat = (layout: LayoutId, hsnSac: boolean, snapshot: InvoiceSnapshot): InvoiceSnapshot => {
  const definition: FormatDefinition = { ...BUILTIN_DEFINITION, layout, blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac } };
  return { ...snapshot, format: snapshotFormat({ id: 'f', name: 'Test', definition }) };
};
const HSN_HEADING = />HSN\/SAC<\/th>/;
const { hsnRequired: _marker, ...issuedBeforeTheRule } = taxInvoice;
void _marker;

describe.each(['classic', 'compact', 'panel'] as const)('HSN/SAC on a Tax Invoice in the %s layout', (layout) => {
  it('prints the column and the code even when the format turns the column off', () => {
    const html = renderInvoiceHtml(invoiceOf(withFormat(layout, false, taxInvoice)));
    expect(html).toMatch(HSN_HEADING);
    expect(html).toContain('998311');
  });

  it('prints the column when the format turns it on', () => {
    expect(renderInvoiceHtml(invoiceOf(withFormat(layout, true, taxInvoice)))).toMatch(HSN_HEADING);
  });

  it('keeps an invoice issued before the rule printing as it was, whatever the format says', () => {
    const off = renderInvoiceHtml(invoiceOf(withFormat(layout, false, issuedBeforeTheRule)));
    expect(off).not.toMatch(HSN_HEADING);
    expect(off).not.toContain('998311');
    expect(renderInvoiceHtml(invoiceOf(withFormat(layout, true, issuedBeforeTheRule)))).toMatch(HSN_HEADING);
  });

  it('lets a Bill of Supply follow the format toggle', () => {
    const billOfSupply: InvoiceSnapshot = { ...issuedBeforeTheRule, documentType: 'Bill of Supply', gstin: '', taxSplit: undefined, lines: [{ ...plainLine, hsnSac: '998311' }] };
    const overrides = { gstMinor: 0, gstRate: 0, totalMinor: 100_000 };
    expect(renderInvoiceHtml(invoiceOf(withFormat(layout, false, billOfSupply), overrides))).not.toMatch(HSN_HEADING);
    expect(renderInvoiceHtml(invoiceOf(withFormat(layout, true, billOfSupply), overrides))).toMatch(HSN_HEADING);
  });

  it('prints a blank cell, not a missing column, for a no-tax line beside a taxed one', () => {
    const html = renderInvoiceHtml(invoiceOf(withFormat(layout, false, { ...taxInvoice, lines: [taxedLine, plainLine] })));
    expect(html).toMatch(HSN_HEADING);
    expect(html).toContain('Deposit');
  });

  it('prints the code of an amount-only Tax Invoice on its one line, and nothing for one issued without a code', () => {
    const amountOnly: InvoiceSnapshot = { ...taxInvoice, lines: undefined, hsnSac: '998311' };
    const html = renderInvoiceHtml(invoiceOf(withFormat(layout, false, amountOnly)));
    expect(html).toMatch(HSN_HEADING);
    expect(html).toContain('Services billed');
    expect(html).toContain('998311');
    const { hsnSac: _code, hsnRequired: _required, ...older } = amountOnly;
    void _code; void _required;
    expect(renderInvoiceHtml(invoiceOf(withFormat(layout, true, older)))).not.toMatch(HSN_HEADING);
  });

  it('shows the column in the Settings preview whatever the format toggle says', () => {
    const branding = { companyName: 'Nexio Hyper', legalName: '', gstin: '', address: '', footer: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '' };
    const definition: FormatDefinition = { ...BUILTIN_DEFINITION, layout, blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: false } };
    expect(renderInvoiceHtml(sampleInvoice(branding, snapshotFormat({ id: 'p', name: 'Preview', definition })))).toMatch(HSN_HEADING);
  });
});
