import type { InvoiceSnapshot } from './tenant-store';

const TAX_LABELS = { igst: 'IGST', cgst_sgst: 'CGST + SGST' } as const;

/** Invoices issued before document types existed keep the plain title they always had. */
export function documentTitle(snapshot: InvoiceSnapshot): string { return snapshot.documentType ?? 'Invoice'; }

/** A Bill of Supply has no GST columns. Older invoices keep theirs. */
export function printsGstColumns(snapshot: InvoiceSnapshot): boolean { return snapshot.documentType !== 'Bill of Supply'; }

/** A Tax Invoice issued under the HSN rule always prints the HSN/SAC column. Earlier invoices and every Bill of Supply follow the format. */
export function printsHsnColumn(snapshot: InvoiceSnapshot, formatShowsHsn: boolean): boolean { return snapshot.hsnRequired === true || formatShowsHsn; }

export function lineTaxLabel(line: { taxType: 'none' | 'igst' | 'cgst_sgst'; gstRate: number }): string {
  return line.taxType === 'none' ? 'No GST' : `${TAX_LABELS[line.taxType]} ${line.gstRate}%`;
}
