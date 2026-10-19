import { describe, expect, it } from 'vitest';
import { amountOnlyLine, gstinMessage, legacyTaxType, gstSnapshotFields, invoiceDocumentType, lineTaxability, overridesSplit, resolveSupply, UNREGISTERED_SELLER_TAX_MESSAGE } from './invoice-gst';

const KARNATAKA_GSTIN = '29AAGCB7383J1Z4';
const MAHARASHTRA_GSTIN = '27AAPFU0939F1ZV';

describe('resolveSupply', () => {
  it('preselects CGST + SGST when the client is in the seller state', () => {
    expect(resolveSupply('29', { gstin: KARNATAKA_GSTIN, stateCode: '29' })).toMatchObject({ sellerRegistered: true, placeOfSupplyStateCode: '29', taxSplit: 'intra', expectedTaxType: 'cgst_sgst' });
  });

  it('preselects IGST when a registered client is in another state', () => {
    expect(resolveSupply('29', { gstin: MAHARASHTRA_GSTIN, stateCode: '27' })).toMatchObject({ placeOfSupplyStateCode: '27', placeOfSupplyState: 'Maharashtra', taxSplit: 'inter', expectedTaxType: 'igst' });
  });

  it('uses the billing state of an unregistered client and falls back to the seller state when it is blank', () => {
    expect(resolveSupply('29', { gstin: '', stateCode: '27' })).toMatchObject({ placeOfSupplyStateCode: '27', taxSplit: 'inter' });
    expect(resolveSupply('29', { gstin: '', stateCode: '' })).toMatchObject({ placeOfSupplyStateCode: '29', taxSplit: 'intra' });
  });

  it('gives an unregistered seller no tax split to preselect', () => {
    expect(resolveSupply('', { gstin: MAHARASHTRA_GSTIN, stateCode: '27' })).toEqual({ sellerRegistered: false, sellerStateCode: '', placeOfSupplyStateCode: '27', placeOfSupplyState: 'Maharashtra', taxSplit: null, expectedTaxType: null });
  });

  it('treats a stored legacy GSTIN that fails validation as an unregistered client with the stored state', () => {
    expect(resolveSupply('29', { gstin: 'NA', stateCode: '' })).toMatchObject({ placeOfSupplyStateCode: '29', taxSplit: 'intra' });
  });
});

describe('document and line classification', () => {
  it('derives line taxability from the tax type and rate', () => {
    expect(lineTaxability({ taxType: 'igst', gstRate: 18 })).toBe('taxable');
    expect(lineTaxability({ taxType: 'cgst_sgst', gstRate: 5 })).toBe('taxable');
    expect(lineTaxability({ taxType: 'none', gstRate: 0 })).toBe('nil');
    expect(lineTaxability({ taxType: 'igst', gstRate: 0 })).toBe('nil');
  });

  it('issues a Tax Invoice only for a registered seller with a taxable line', () => {
    const taxed = [{ taxType: 'igst' as const, gstRate: 18 }];
    const untaxed = [{ taxType: 'none' as const, gstRate: 0 }];
    expect(invoiceDocumentType(true, taxed)).toBe('Tax Invoice');
    expect(invoiceDocumentType(true, untaxed)).toBe('Bill of Supply');
    expect(invoiceDocumentType(false, taxed)).toBe('Bill of Supply');
  });

  it('detects an override only for taxed lines that differ from the expected split', () => {
    const intra = resolveSupply('29', { gstin: '', stateCode: '29' });
    expect(overridesSplit([{ taxType: 'cgst_sgst', gstRate: 18 }], intra)).toBe(false);
    expect(overridesSplit([{ taxType: 'none', gstRate: 0 }], intra)).toBe(false);
    expect(overridesSplit([{ taxType: 'igst', gstRate: 18 }], intra)).toBe(true);
    expect(overridesSplit([{ taxType: 'igst', gstRate: 18 }], resolveSupply('', { gstin: '', stateCode: '29' }))).toBe(false);
  });

  it('lets an unregistered seller issue only no-tax lines, whatever the tax type or rate says', () => {
    const unregistered = resolveSupply('', { gstin: MAHARASHTRA_GSTIN, stateCode: '27' });
    const issue = (lines: Array<{ taxType: 'none' | 'igst' | 'cgst_sgst'; gstRate: number }>) => gstSnapshotFields({ seller: { legalName: '' }, supply: unregistered, lines });
    expect(issue([{ taxType: 'none', gstRate: 0 }])).toMatchObject({ documentType: 'Bill of Supply', sellerStateCode: '', placeOfSupplyStateCode: '27' });
    for (const taxType of ['igst', 'cgst_sgst'] as const) {
      expect(() => issue([{ taxType, gstRate: 18 }])).toThrow(UNREGISTERED_SELLER_TAX_MESSAGE);
      expect(() => issue([{ taxType: 'none', gstRate: 0 }, { taxType, gstRate: 0 }])).toThrow(UNREGISTERED_SELLER_TAX_MESSAGE);
    }
    expect(UNREGISTERED_SELLER_TAX_MESSAGE).toBe('Add your GSTIN in Settings to charge GST, or set the lines to no tax.');
  });

  it('taxes an amount-only invoice by the expected split and refuses a rate without one', () => {
    expect(amountOnlyLine(resolveSupply('29', { gstin: '', stateCode: '29' }), 18, '998311')).toEqual({ taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' });
    expect(amountOnlyLine(resolveSupply('29', { gstin: MAHARASHTRA_GSTIN, stateCode: '27' }), 18, '998311')).toEqual({ taxType: 'igst', gstRate: 18, hsnSac: '998311' });
    expect(amountOnlyLine(resolveSupply('', { gstin: '', stateCode: '29' }), 0)).toEqual({ taxType: 'none', gstRate: 0 });
    expect(() => amountOnlyLine(resolveSupply('', { gstin: '', stateCode: '29' }), 18, '998311')).toThrow(UNREGISTERED_SELLER_TAX_MESSAGE);
  });

  it('starts correcting an invoice without line items on the split it was issued with, never a hard-coded one', () => {
    expect(legacyTaxType({ taxSplit: 'intra' })).toBe('cgst_sgst');
    expect(legacyTaxType({ taxSplit: 'inter' })).toBe('igst');
    expect(legacyTaxType({})).toBe('cgst_sgst');
  });

  it('lets a registered seller issue taxed and no-tax lines', () => {
    const registered = resolveSupply('29', { gstin: '', stateCode: '29' });
    expect(gstSnapshotFields({ seller: { legalName: '' }, supply: registered, lines: [{ taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] })).toMatchObject({ documentType: 'Tax Invoice', taxSplit: 'intra' });
    expect(gstSnapshotFields({ seller: { legalName: '' }, supply: registered, lines: [{ taxType: 'none', gstRate: 0 }] })).toMatchObject({ documentType: 'Bill of Supply', taxSplit: 'intra' });
  });

  it('explains each GSTIN failure in plain words', () => {
    expect(gstinMessage('length')).toMatch(/15 characters/);
    expect(gstinMessage('format')).toMatch(/format/);
    expect(gstinMessage('state')).toMatch(/state code/);
    expect(gstinMessage('checksum')).toMatch(/check digit/);
  });
});

describe('HSN/SAC on a Tax Invoice', () => {
  const registered = resolveSupply('29', { gstin: '', stateCode: '29' });
  const interstate = resolveSupply('29', { gstin: MAHARASHTRA_GSTIN, stateCode: '27' });
  const issue = (lines: Array<{ taxType: 'none' | 'igst' | 'cgst_sgst'; gstRate: number; hsnSac?: string }>, supply = registered) => gstSnapshotFields({ seller: { legalName: '' }, supply, lines });

  it('refuses a GST line with no HSN/SAC code, blank or missing', () => {
    expect(() => issue([{ taxType: 'cgst_sgst', gstRate: 18 }])).toThrow('Line 1 needs an HSN/SAC code because a Tax Invoice taxes it.');
    expect(() => issue([{ taxType: 'none', gstRate: 0, hsnSac: '' }, { taxType: 'cgst_sgst', gstRate: 18, hsnSac: '  ' }])).toThrow('Line 2 needs an HSN/SAC code');
  });

  it('refuses a malformed code on a GST line', () => {
    for (const hsnSac of ['12', '12345', '1234567', '123456789', '99831', '9983', 'ABCD12']) {
      expect(() => issue([{ taxType: 'cgst_sgst', gstRate: 18, hsnSac }]), hsnSac).toThrow('Enter a valid HSN/SAC code for line 1');
    }
  });

  it('accepts a 4, 6 or 8 digit code and marks the invoice as one that must print it', () => {
    for (const hsnSac of ['8517', '998311', '84713010']) expect(issue([{ taxType: 'cgst_sgst', gstRate: 18, hsnSac }]), hsnSac).toMatchObject({ documentType: 'Tax Invoice', hsnRequired: true });
  });

  it('treats an igst line at 0% inside a Tax Invoice as a GST line, but not inside a Bill of Supply', () => {
    expect(() => issue([{ taxType: 'igst', gstRate: 18, hsnSac: '998311' }, { taxType: 'igst', gstRate: 0 }], interstate)).toThrow('Line 2 needs an HSN/SAC code');
    expect(issue([{ taxType: 'igst', gstRate: 0 }, { taxType: 'none', gstRate: 0 }], interstate)).not.toHaveProperty('hsnRequired');
  });

  it('needs no code on a no-tax line of a Tax Invoice or on a Bill of Supply', () => {
    expect(issue([{ taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }, { taxType: 'none', gstRate: 0 }])).toMatchObject({ documentType: 'Tax Invoice' });
    expect(issue([{ taxType: 'none', gstRate: 0 }])).toMatchObject({ documentType: 'Bill of Supply' });
    expect(issue([{ taxType: 'none', gstRate: 0 }])).not.toHaveProperty('hsnRequired');
  });
});
