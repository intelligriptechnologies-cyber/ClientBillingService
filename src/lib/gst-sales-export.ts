import type { GstSalesReport } from './tenant-store';

const gstSalesHeader = ['Invoice number', 'Invoice date', 'Customer', 'Customer GSTIN', 'Taxable value', 'GST', 'Invoice total', 'IGST', 'CGST', 'SGST', 'Net GST', 'Section'];

const amount = (minor: number) => (minor / 100).toFixed(2);
const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
const escapeHtml = (value: string | number) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function gstSalesCsv(report: GstSalesReport) {
  const header = gstSalesHeader;
  const rows = report.items.map((item) => [item.invoiceNumber, item.invoiceDate, item.customerName, item.customerGstin, amount(item.taxableMinor), amount(item.gstMinor), amount(item.totalMinor), amount(item.igstMinor), amount(item.cgstMinor), amount(item.sgstMinor), amount(item.netGstMinor), item.section]);
  const total = ['Total', '', '', '', amount(report.totals.taxableMinor), amount(report.totals.gstMinor), amount(report.totals.totalMinor), amount(report.totals.igstMinor), amount(report.totals.cgstMinor), amount(report.totals.sgstMinor), amount(report.totals.netGstMinor), ''];
  return [['GST Sales Report', report.companyName, report.month], ['GSTIN', report.gstin], [], header, ...rows, total].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

const hsnSummaryHeader = ['HSN/SAC', 'Description', 'Quantity', 'Taxable value', 'Tax'];

export function hsnSummaryCsv(report: GstSalesReport) {
  const rows = report.hsnSummary.map((row) => [row.hsn, row.description, String(row.quantity), amount(row.taxableMinor), amount(row.taxMinor)]);
  const total = ['Total', '', '', amount(report.hsnSummary.reduce((sum, row) => sum + row.taxableMinor, 0)), amount(report.hsnSummary.reduce((sum, row) => sum + row.taxMinor, 0))];
  return [['GSTR-1 HSN/SAC summary', report.companyName, report.month], ['GSTIN', report.gstin], [], hsnSummaryHeader, ...rows, total].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function gstSalesPrintDocument(report: GstSalesReport) {
  const cells = (values: Array<string | number>, tag = 'td') => values.map((value) => `<${tag}>${escapeHtml(value)}</${tag}>`).join('');
  const rows = report.items.map((item) => `<tr>${cells([item.invoiceNumber, item.invoiceDate, item.customerName, item.customerGstin, amount(item.taxableMinor), amount(item.gstMinor), amount(item.totalMinor), amount(item.igstMinor), amount(item.cgstMinor), amount(item.sgstMinor), amount(item.netGstMinor), item.section])}</tr>`).join('');
  const total = `<tr class="total">${cells(['Total', '', '', '', amount(report.totals.taxableMinor), amount(report.totals.gstMinor), amount(report.totals.totalMinor), amount(report.totals.igstMinor), amount(report.totals.cgstMinor), amount(report.totals.sgstMinor), amount(report.totals.netGstMinor), ''])}</tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>GST Sales ${escapeHtml(report.month)}</title><style>body{font:12px Arial;color:#152238;padding:24px}h1{margin:0 0 6px}p{margin:4px 0 18px;color:#526071}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#eaf0f7}.total{font-weight:700;background:#f8fafc}@media print{body{padding:0}}</style></head><body><h1>GST Sales Report</h1><p>${escapeHtml(report.companyName)} · GSTIN: ${escapeHtml(report.gstin || 'Not configured')} · Period: ${escapeHtml(report.month)}</p><table><thead><tr>${cells(['Invoice number', 'Invoice date', 'Customer', 'Customer GSTIN', 'Taxable value', 'GST', 'Invoice total', 'IGST', 'CGST', 'SGST', 'Net GST', 'Section'], 'th')}</tr></thead><tbody>${rows}${total}</tbody></table></body></html>`;
}
