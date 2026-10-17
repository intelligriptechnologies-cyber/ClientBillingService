import { describe, expect, it } from 'vitest';
import { gstinMessage, invoiceDocumentType, lineTaxability, overridesSplit, resolveSupply } from './invoice-gst';

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

  it('explains each GSTIN failure in plain words', () => {
    expect(gstinMessage('length')).toMatch(/15 characters/);
    expect(gstinMessage('format')).toMatch(/format/);
    expect(gstinMessage('state')).toMatch(/state code/);
    expect(gstinMessage('checksum')).toMatch(/check digit/);
  });
});
