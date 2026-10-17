export type InvoiceTaxType = 'none' | 'igst' | 'cgst_sgst';
export type InvoiceLineInput = { description: string; quantity: number; rateMinor: number; taxType: InvoiceTaxType; gstRate: number; hsnSac?: string };
export type InvoiceLine = InvoiceLineInput & { amountMinor: number; gstMinor: number; totalMinor: number };

export function calculateInvoiceLines(lines: InvoiceLineInput[]): { lines: InvoiceLine[]; taxableMinor: number; gstMinor: number; totalMinor: number } {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Add at least one line item.');
  const calculated = lines.map((line) => {
    if (typeof line.description !== 'string' || !line.description.trim()) throw new Error('Each line item needs a description.');
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || Math.round(line.quantity * 1000) !== line.quantity * 1000) throw new Error('Line quantity must be positive with up to three decimal places.');
    if (!Number.isSafeInteger(line.rateMinor) || line.rateMinor < 0) throw new Error('Line rate must be a non-negative amount.');
    if (!['none', 'igst', 'cgst_sgst'].includes(line.taxType)) throw new Error('Choose a valid tax type.');
    if (!Number.isFinite(line.gstRate) || line.gstRate < 0 || line.gstRate > 100 || (line.taxType === 'none' && line.gstRate !== 0)) throw new Error('Enter a valid GST rate for each line.');
    const amountMinor = Math.round(line.quantity * line.rateMinor);
    if (!Number.isSafeInteger(amountMinor)) throw new Error('Line amount is too large.');
    const gstMinor = line.taxType === 'none' ? 0 : Math.round(amountMinor * line.gstRate / 100);
    return { ...line, description: line.description.trim(), ...(line.hsnSac === undefined ? {} : { hsnSac: line.hsnSac.trim() }), amountMinor, gstMinor, totalMinor: amountMinor + gstMinor };
  });
  const taxableMinor = calculated.reduce((sum, line) => sum + line.amountMinor, 0);
  const gstMinor = calculated.reduce((sum, line) => sum + line.gstMinor, 0);
  if (!Number.isSafeInteger(taxableMinor + gstMinor) || taxableMinor <= 0) throw new Error('Line items must total a positive amount.');
  return { lines: calculated, taxableMinor, gstMinor, totalMinor: taxableMinor + gstMinor };
}
