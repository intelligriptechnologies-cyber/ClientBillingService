import { documentType, placeOfSupply, stateName, validateGstin, validateHsnSac, type DocumentType, type GstinFailure, type Taxability, type TaxSplit } from './gst';
import type { InvoiceTaxType } from './invoice-lines';

type TaxedLine = { taxType: InvoiceTaxType; gstRate: number };
export type ExpectedTaxType = Exclude<InvoiceTaxType, 'none'>;

/** Where the tax on one invoice lands, decided once from the seller and client states. */
export type SupplyContext = {
  sellerRegistered: boolean;
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyState: string;
  taxSplit: TaxSplit | null;
  expectedTaxType: ExpectedTaxType | null;
};

/** What an issued invoice keeps so later edits to the seller or client never change it. */
export type GstSnapshotFields = {
  documentType: DocumentType;
  sellerLegalName: string;
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  taxSplit?: TaxSplit;
  taxSplitOverrideReason?: string;
};

/** An unregistered seller issues a Bill of Supply, which carries no GST. */
export const UNREGISTERED_SELLER_TAX_MESSAGE = 'Add your GSTIN in Settings to charge GST, or set the lines to no tax.';

const GSTIN_MESSAGES:Record<GstinFailure, string> = {
  length: 'A GSTIN has 15 characters.',
  format: 'The GSTIN format is not valid.',
  state: 'The GSTIN starts with an unknown state code.',
  checksum: 'The GSTIN check digit does not match. Re-check the number.',
};

export function gstinMessage(reason: GstinFailure): string { return GSTIN_MESSAGES[reason]; }

/** Blank means unregistered. A filled value must pass the checksum. */
export function parseGstin(input: string, label = 'GSTIN'): { gstin: string; stateCode: string } {
  const check = validateGstin(input);
  if (!check.ok) throw new Error(`Enter a valid ${label}. ${gstinMessage(check.reason)}`);
  return check.registered ? { gstin: check.gstin, stateCode: check.stateCode } : { gstin: '', stateCode: '' };
}

export function parseBillingState(input: string | undefined): string {
  const code = (input ?? '').trim();
  if (code && !stateName(code)) throw new Error('Choose a valid billing state.');
  return code;
}

export function parseHsnSac(input: string | undefined, label = 'HSN/SAC code'): string {
  const code = (input ?? '').trim();
  if (code && !validateHsnSac(code).ok) throw new Error(`Enter a valid ${label}: 4, 6 or 8 digits for goods, 6 digits starting 99 for services.`);
  return code;
}

export function lineTaxability(line: TaxedLine): Taxability { return line.taxType !== 'none' && line.gstRate > 0 ? 'taxable' : 'nil'; }

export function invoiceDocumentType(sellerRegistered: boolean, lines: ReadonlyArray<TaxedLine>): DocumentType {
  return documentType({ sellerRegistered, lines: lines.map((line) => ({ taxability: lineTaxability(line) })) });
}

/** An unregistered seller has no state of its own, so a seller is registered exactly when its state resolves. */
export function sellerRegisteredIn(sellerStateCode: string): boolean { return stateName(sellerStateCode) !== undefined; }

/** The tax type a line starts with before the place of supply is known, only for invoices issued without line items. */
export function legacyTaxType(snapshot: { taxSplit?: TaxSplit }): ExpectedTaxType { return snapshot.taxSplit === 'inter' ? 'igst' : 'cgst_sgst'; }

export function resolveSupply(sellerStateCode: string, client: { gstin: string; stateCode: string }): SupplyContext {
  const check = validateGstin(client.gstin);
  const clientState = check.ok && check.registered ? check.stateCode : stateName(client.stateCode) ? client.stateCode : '';
  if (!sellerRegisteredIn(sellerStateCode)) {
    return { sellerRegistered: false, sellerStateCode: '', placeOfSupplyStateCode: clientState, placeOfSupplyState: stateName(clientState) ?? '', taxSplit: null, expectedTaxType: null };
  }
  const supply = placeOfSupply(sellerStateCode, { gstin: check.ok && check.registered ? check.gstin : '', billingStateCode: clientState });
  const placeOfSupplyStateCode = supply.ok ? supply.stateCode : sellerStateCode;
  const taxSplit: TaxSplit = placeOfSupplyStateCode === sellerStateCode ? 'intra' : 'inter';
  return { sellerRegistered: true, sellerStateCode, placeOfSupplyStateCode, placeOfSupplyState: stateName(placeOfSupplyStateCode) ?? '', taxSplit, expectedTaxType: taxSplit === 'intra' ? 'cgst_sgst' : 'igst' };
}

/** The one line an amount-only invoice stands for, taxed the way the place of supply says. Only a registered seller has a split to tax it with. */
export function amountOnlyLine(supply: SupplyContext, gstRate: number): TaxedLine {
  if (gstRate <= 0) return { taxType: 'none', gstRate: 0 };
  if (!supply.expectedTaxType) throw new Error(UNREGISTERED_SELLER_TAX_MESSAGE);
  return { taxType: supply.expectedTaxType, gstRate };
}

export function overridesSplit(lines: ReadonlyArray<TaxedLine>, supply: SupplyContext): boolean {
  return supply.expectedTaxType !== null && lines.some((line) => line.taxType !== 'none' && line.taxType !== supply.expectedTaxType);
}

type DraftLine = TaxedLine & { hsnSac?: string };

/** Checks every GST rule that depends on more than one line and returns the fields to snapshot. */
export function gstSnapshotFields(input: { seller: { legalName: string }; supply: SupplyContext; lines: ReadonlyArray<DraftLine>; requireHsn: boolean; overrideReason?: string }): GstSnapshotFields {
  const { supply, lines } = input;
  if (!supply.sellerRegistered && lines.some((line) => line.taxType !== 'none')) throw new Error(UNREGISTERED_SELLER_TAX_MESSAGE);
  const type = invoiceDocumentType(supply.sellerRegistered, lines);
  const overridden = overridesSplit(lines, supply);
  const reason = input.overrideReason?.trim() ?? '';
  if (overridden && !reason) throw new Error('Enter a reason for overriding the tax split that was preselected from the place of supply.');
  lines.forEach((line, index) => {
    const code = parseHsnSac(line.hsnSac, `HSN/SAC code for line ${index + 1}`);
    if (input.requireHsn && type === 'Tax Invoice' && lineTaxability(line) === 'taxable' && !code) throw new Error(`Line ${index + 1} needs an HSN/SAC code because a Tax Invoice taxes it.`);
  });
  return {
    documentType: type,
    sellerLegalName: input.seller.legalName,
    sellerStateCode: supply.sellerStateCode,
    placeOfSupplyStateCode: supply.placeOfSupplyStateCode,
    ...(supply.taxSplit ? { taxSplit: supply.taxSplit } : {}),
    ...(overridden ? { taxSplitOverrideReason: reason } : {}),
  };
}
