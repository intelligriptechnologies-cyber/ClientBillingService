import { describe, expect, it } from 'vitest';
import { gstinMessage, gstSnapshotFields, invoiceDocumentType, lineTaxability, overridesSplit, resolveSupply, UNREGISTERED_SELLER_TAX_MESSAGE } from './invoice-gst';

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
    const issue = (lines: Array<{ taxType: 'none' | 'igst' | 'cgst_sgst'; gstRate: number }>) => gstSnapshotFields({ seller: { legalName: '' }, supply: unregistered, lines, requireHsn: false });
    expect(issue([{ taxType: 'none', gstRate: 0 }])).toMatchObject({ documentType: 'Bill of Supply', sellerStateCode: '', placeOfSupplyStateCode: '27' });
    for (const taxType of ['igst', 'cgst_sgst'] as const) {
      expect(() => issue([{ taxType, gstRate: 18 }])).toThrow(UNREGISTERED_SELLER_TAX_MESSAGE);
      expect(() => issue([{ taxType: 'none', gstRate: 0 }, { taxType, gstRate: 0 }])).toThrow(UNREGISTERED_SELLER_TAX_MESSAGE);
    }
    expect(UNREGISTERED_SELLER_TAX_MESSAGE).toBe('Add your GSTIN in Settings to charge GST, or set the lines to no tax.');
  });

  it('lets a registered seller issue taxed and no-tax lines', () => {
    const registered = resolveSupply('29', { gstin: '', stateCode: '29' });
    expect(gstSnapshotFields({ seller: { legalName: '' }, supply: registered, lines: [{ taxType: 'cgst_sgst', gstRate: 18 }], requireHsn: false })).toMatchObject({ documentType: 'Tax Invoice', taxSplit: 'intra' });
    expect(gstSnapshotFields({ seller: { legalName: '' }, supply: registered, lines: [{ taxType: 'none', gstRate: 0 }], requireHsn: false })).toMatchObject({ documentType: 'Bill of Supply', taxSplit: 'intra' });
  });

  it('explains each GSTIN failure in plain words', () => {
    expect(gstinMessage('length')).toMatch(/15 characters/);
    expect(gstinMessage('format')).toMatch(/format/);
    expect(gstinMessage('state')).toMatch(/state code/);
    expect(gstinMessage('checksum')).toMatch(/check digit/);
  });
});
