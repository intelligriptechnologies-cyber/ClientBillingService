import { describe, expect, it } from 'vitest';
import { gstSalesCsv, gstSalesPrintDocument, hsnSummaryCsv } from './gst-sales-export';
import type { GstSalesReport } from './tenant-store';

const report: GstSalesReport = {
  month: '2026-10', companyName: 'Nexio & Co', gstin: '29AAGCB7383J1Z4',
  hsnSummary: [{ hsn: '998311', description: 'Consulting, "monthly"', quantity: 2.5, taxableMinor: 10_000, taxMinor: 1_800 }],
  items: [{ section: 'B2B', invoiceId: 'one', invoiceNumber: 'NEX-001', invoiceDate: '2026-10-01', customerName: 'Buyer, Inc.', customerGstin: '27AAPFU0939F1ZV', taxableMinor: 10_000, gstMinor: 1_800, totalMinor: 11_800, igstMinor: 1_800, cgstMinor: 0, sgstMinor: 0, netGstMinor: 1_800 }],
  totals: { taxableMinor: 10_000, gstMinor: 1_800, totalMinor: 11_800, igstMinor: 1_800, cgstMinor: 0, sgstMinor: 0, netGstMinor: 1_800 },
};

describe('GST sales exports', () => {
  it('creates a spreadsheet-compatible export with tenant context and filtered totals', () => {
    const csv = gstSalesCsv(report);
    expect(csv).toContain('"GST Sales Report","Nexio & Co","2026-10"');
    expect(csv).toContain('"Buyer, Inc."');
    expect(csv).toContain('"100.00","18.00","118.00","18.00","0.00","0.00","18.00"');
  });

  it('keeps the existing columns in place and appends the GSTR-1 section', () => {
    const [, , , header, row, total] = gstSalesCsv(report).split('\r\n');
    expect(header).toBe('"Invoice number","Invoice date","Customer","Customer GSTIN","Taxable value","GST","Invoice total","IGST","CGST","SGST","Net GST","Section"');
    expect(row.endsWith('"18.00","B2B"')).toBe(true);
    expect(total.endsWith('"18.00",""')).toBe(true);
    expect(gstSalesPrintDocument(report)).toContain('<td>B2B</td>');
  });

  it('exports an HSN/SAC summary with quoted descriptions and a total', () => {
    const rows = hsnSummaryCsv(report).split('\r\n');
    expect(rows[3]).toBe('"HSN/SAC","Description","Quantity","Taxable value","Tax"');
    expect(rows[4]).toBe('"998311","Consulting, ""monthly""","2.5","100.00","18.00"');
    expect(rows[5]).toBe('"Total","","","100.00","18.00"');
  });

  it('creates a printable document without allowing report data to become markup', () => {
    const document = gstSalesPrintDocument({ ...report, companyName: '<Unsafe>' });
    expect(document).toContain('&lt;Unsafe&gt;');
    expect(document).toContain('GST Sales Report');
    expect(document).toContain('NEX-001');
  });
});
