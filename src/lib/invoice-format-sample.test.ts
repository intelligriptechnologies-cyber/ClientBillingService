import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION, snapshotFormat } from './invoice-format';
import { sampleInvoice } from './invoice-format-sample';
import { renderInvoiceHtml } from './invoice-html';

const branding = { companyName: 'Nexio Hyper', legalName: '', gstin: '', address: '', footer: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '' };
const preview = (patch: Partial<typeof BUILTIN_DEFINITION> = {}, blocks: Partial<typeof BUILTIN_DEFINITION.blocks> = {}) =>
  renderInvoiceHtml(sampleInvoice(branding, snapshotFormat({ id: 'p', name: 'Preview', definition: { ...BUILTIN_DEFINITION, ...patch, blocks: { ...BUILTIN_DEFINITION.blocks, ...blocks } } })));

describe('the format preview invoice', () => {
  it('is a script-free Tax Invoice with HSN codes, totals and placeholder branding for a tenant with none', () => {
    const html = preview();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<h1>Tax Invoice</h1>');
    expect(html).toContain('HSN/SAC');
    expect(html).toContain('Nexio Hyper');
    expect(html.match(/<img /g)).toHaveLength(3);
  });

  it('shows each switch changing the preview, except the HSN/SAC column that a Tax Invoice always prints', () => {
    expect(preview({}, { hsnSac: false })).toContain('HSN/SAC');
    expect(preview({}, { amountInWords: false })).not.toContain('Indian Rupees');
    expect(preview({ logo: 'hide' })).not.toContain('alt="Logo"');
    expect(preview({ accent: '#1f3a5f' })).toContain('#1f3a5f');
  });
});
