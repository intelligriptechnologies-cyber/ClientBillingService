import { describe, expect, it } from 'vitest';
import { renderBulkPreviewHtml } from './bulk-preview-html';

const proposal = { contractId: 'c', contractName: 'Retainer <b>', customerId: 'u', customerName: 'Acme & Sons', billingPeriod: '2026-10', invoiceDate: '2026-10-01', dueDate: '2026-10-15', taxableMinor: 100_000, gstRate: 18, gstMinor: 18_000, totalMinor: 118_000, additionalLines: [] };

describe('renderBulkPreviewHtml', () => {
  it('lists proposed and skipped contracts with rupee amounts and escaped names', () => {
    const html = renderBulkPreviewHtml({ billingPeriod: '2026-10', proposed: [proposal], skipped: [{ contractId: 's', contractName: 'Lapsed', customerName: 'Beta', reason: 'Contract ended' }] }, { companyName: 'Nexio', logoDataUrl: '' });
    expect(html).toContain('₹1,180.00');
    expect(html).toContain('Acme &amp; Sons');
    expect(html).toContain('Retainer &lt;b&gt;');
    expect(html).toContain('Contract ended');
    expect(html).not.toContain('<b>');
  });
});
