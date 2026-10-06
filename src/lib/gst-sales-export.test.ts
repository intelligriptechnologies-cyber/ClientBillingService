import { describe, expect, it } from 'vitest';
import { gstSalesCsv, gstSalesPrintDocument } from './gst-sales-export';
import type { GstSalesReport } from './tenant-store';

const report: GstSalesReport = {
  month: '2026-10', companyName: 'Nexio & Co', gstin: '29ABCDE1234F1Z5',
  items: [{ invoiceId: 'one', invoiceNumber: 'NEX-001', invoiceDate: '2026-10-01', customerName: 'Buyer, Inc.', customerGstin: '27ABCDE1234F1Z5', taxableMinor: 10_000, gstMinor: 1_800, totalMinor: 11_800, igstMinor: 1_800, cgstMinor: 0, sgstMinor: 0, netGstMinor: 1_800 }],
  totals: { taxableMinor: 10_000, gstMinor: 1_800, totalMinor: 11_800, igstMinor: 1_800, cgstMinor: 0, sgstMinor: 0, netGstMinor: 1_800 },
};

describe('GST sales exports', () => {
  it('creates a spreadsheet-compatible export with tenant context and filtered totals', () => {
    const csv = gstSalesCsv(report);
    expect(csv).toContain('"GST Sales Report","Nexio & Co","2026-10"');
    expect(csv).toContain('"Buyer, Inc."');
    expect(csv).toContain('"100.00","18.00","118.00","18.00","0.00","0.00","18.00"');
  });

  it('creates a printable document without allowing report data to become markup', () => {
    const document = gstSalesPrintDocument({ ...report, companyName: '<Unsafe>' });
    expect(document).toContain('&lt;Unsafe&gt;');
    expect(document).toContain('GST Sales Report');
    expect(document).toContain('NEX-001');
  });
});
