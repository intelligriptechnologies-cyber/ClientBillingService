import { stateName } from './gst';
import type { InvoiceSnapshot, TenantInvoice } from './tenant-store';

const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const TAX_LABELS = { igst: 'IGST', cgst_sgst: 'CGST + SGST' } as const;

/** Invoices issued before document types existed keep the plain title they always had. */
export function documentTitle(snapshot: InvoiceSnapshot): string { return snapshot.documentType ?? 'Invoice'; }

/** A Bill of Supply has no GST columns. Older invoices keep theirs. */
export function printsGstColumns(snapshot: InvoiceSnapshot): boolean { return snapshot.documentType !== 'Bill of Supply'; }

export function lineTaxLabel(line: { taxType: 'none' | 'igst' | 'cgst_sgst'; gstRate: number }): string {
  return line.taxType === 'none' ? 'No GST' : `${TAX_LABELS[line.taxType]} ${line.gstRate}%`;
}

/** Text for the downloadable PDF. A separate task rebuilds the PDF layout, so this stays plain lines. */
export function invoicePdfContent(invoice: TenantInvoice): { title: string; lines: string[] } {
  const snapshot = invoice.snapshot;
  const tax = printsGstColumns(snapshot);
  const seller = tax ? [snapshot.companyName, snapshot.sellerLegalName && snapshot.sellerLegalName !== snapshot.companyName ? `Legal name: ${snapshot.sellerLegalName}` : '', snapshot.address, `GSTIN: ${snapshot.gstin}`] : [snapshot.companyName, snapshot.address, snapshot.gstin ? `GSTIN: ${snapshot.gstin}` : ''];
  const supply = snapshot.placeOfSupplyStateCode ? [`Place of supply: ${stateName(snapshot.placeOfSupplyStateCode) ?? snapshot.placeOfSupplyStateCode}`, snapshot.taxSplitOverrideReason ? `Tax split override: ${snapshot.taxSplitOverrideReason}` : ''] : [];
  const lines = [
    ...seller, '',
    `Bill to: ${snapshot.customerName}`, snapshot.customerAddress, snapshot.customerEmail,
    snapshot.customerPan ? `Customer PAN: ${snapshot.customerPan}` : '', snapshot.customerGstin ? `Customer GSTIN: ${snapshot.customerGstin}` : '', '',
    `Issued: ${invoice.invoiceDate}    Due: ${invoice.dueDate}`, snapshot.venue ? `Venue: ${snapshot.venue}` : '', ...supply, '',
    ...(snapshot.lines ?? []).map((line) => [line.description, line.hsnSac ? `HSN/SAC ${line.hsnSac}` : '', `${line.quantity} x ${money(line.rateMinor)}`, tax ? lineTaxLabel(line) : '', money(line.totalMinor)].filter(Boolean).join('  |  ')),
    '', `${tax ? 'Taxable value' : 'Value of supply'}: ${money(invoice.taxableMinor)}`, tax || invoice.gstMinor ? `GST: ${money(invoice.gstMinor)}` : '', `Total: ${money(invoice.totalMinor)}`,
    snapshot.notes ? `Notes: ${snapshot.notes}` : '', '', snapshot.footer,
  ];
  return { title: `${documentTitle(snapshot).toUpperCase()} ${invoice.invoiceNumber}`, lines };
}
