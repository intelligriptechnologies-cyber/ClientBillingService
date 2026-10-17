import { describe, expect, it } from 'vitest';
import {
  B2CL_THRESHOLD_MINOR,
  documentType,
  gstr1Section,
  placeOfSupply,
  stateFromGstin,
  stateName,
  taxSplit,
  validateGstin,
  validateHsnSac,
} from './gst';

const MAHARASHTRA = '27AAPFU0939F1ZV';
const KARNATAKA = '29AAGCB7383J1Z4';
const TAMIL_NADU = '33GSPTN0481G1ZA';
const GUJARAT = '24AAACC1206D1ZM';

describe('validateGstin', () => {
  it.each([
    [MAHARASHTRA, '27', 'Maharashtra'],
    [KARNATAKA, '29', 'Karnataka'],
    [TAMIL_NADU, '33', 'Tamil Nadu'],
    [GUJARAT, '24', 'Gujarat'],
  ])('accepts %s and returns its state', (gstin, stateCode, name) => {
    expect(validateGstin(gstin)).toEqual({ ok: true, registered: true, gstin, stateCode, stateName: name });
  });

  it('normalises case and surrounding whitespace', () => {
    const result = validateGstin(`  ${MAHARASHTRA.toLowerCase()} `);
    expect(result).toMatchObject({ ok: true, registered: true, gstin: MAHARASHTRA });
  });

  it.each(['', '   ', undefined, null])('treats %j as unregistered, not as an error', (blank) => {
    expect(validateGstin(blank)).toEqual({ ok: true, registered: false });
  });

  it('rejects a wrong checksum character', () => {
    expect(validateGstin('27AAPFU0939F1ZX')).toEqual({ ok: false, reason: 'checksum' });
  });

  it.each(['27AAPFU0939F1Z', '27AAPFU0939F1ZVV'])('rejects wrong length %s', (input) => {
    expect(validateGstin(input)).toEqual({ ok: false, reason: 'length' });
  });

  it('rejects an unknown state code even with a matching checksum', () => {
    expect(validateGstin('00AAPFU0939F1ZV')).toEqual({ ok: false, reason: 'state' });
    expect(validateGstin('25AAPFU0939F1ZV')).toEqual({ ok: false, reason: 'state' });
    expect(validateGstin('39AAPFU0939F1ZV')).toEqual({ ok: false, reason: 'state' });
  });

  it('rejects a malformed PAN block', () => {
    expect(validateGstin('27AAPFU09391F1ZV')).toEqual({ ok: false, reason: 'length' });
    expect(validateGstin('27AAPFU093AF1ZV')).toEqual({ ok: false, reason: 'format' });
    expect(validateGstin('2711PFU0939F1ZV')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects a missing Z in position 14', () => {
    expect(validateGstin('27AAPFU0939F1AV')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects entity digit 0', () => {
    expect(validateGstin('27AAPFU0939F0ZV')).toEqual({ ok: false, reason: 'format' });
  });
});

describe('state lookup', () => {
  it('reads the state from the first two digits', () => {
    expect(stateFromGstin(MAHARASHTRA)).toEqual({ stateCode: '27', stateName: 'Maharashtra' });
  });

  it('returns undefined for an invalid GSTIN', () => {
    expect(stateFromGstin('27AAPFU0939F1ZX')).toBeUndefined();
    expect(stateFromGstin('')).toBeUndefined();
  });

  it.each([
    ['01', 'Jammu and Kashmir'],
    ['07', 'Delhi'],
    ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['36', 'Telangana'],
    ['37', 'Andhra Pradesh'],
    ['38', 'Ladakh'],
    ['97', 'Other Territory'],
    ['99', 'Centre Jurisdiction'],
  ])('names code %s', (code, name) => {
    expect(stateName(code)).toBe(name);
  });

  it.each(['00', '25', '28', '39', '7', 'AB'])('has no name for %s', (code) => {
    expect(stateName(code)).toBeUndefined();
  });
});

describe('placeOfSupply', () => {
  it('uses the GSTIN state for a registered client, ignoring the billing state', () => {
    expect(placeOfSupply('27', { gstin: KARNATAKA, billingStateCode: '07' })).toEqual({ ok: true, stateCode: '29', source: 'gstin' });
  });

  it('uses the billing address state for an unregistered client', () => {
    expect(placeOfSupply('27', { gstin: '', billingStateCode: '07' })).toEqual({ ok: true, stateCode: '07', source: 'billing-address' });
    expect(placeOfSupply('27', { billingStateCode: '33' })).toEqual({ ok: true, stateCode: '33', source: 'billing-address' });
  });

  it('falls back to the seller state when an unregistered client has no billing state', () => {
    expect(placeOfSupply('27', {})).toEqual({ ok: true, stateCode: '27', source: 'seller-default' });
  });

  it('fails on an invalid GSTIN rather than guessing', () => {
    expect(placeOfSupply('27', { gstin: '27AAPFU0939F1ZX', billingStateCode: '27' })).toEqual({ ok: false, reason: 'checksum' });
  });

  it('fails on an unknown billing state', () => {
    expect(placeOfSupply('27', { billingStateCode: '25' })).toEqual({ ok: false, reason: 'state' });
  });
});

describe('taxSplit', () => {
  it('is intra-state (CGST+SGST) when seller and place of supply match', () => {
    expect(taxSplit('27', '27')).toBe('intra');
  });
  it('is inter-state (IGST) otherwise', () => {
    expect(taxSplit('27', '29')).toBe('inter');
    expect(taxSplit('27', '97')).toBe('inter');
  });
});

describe('documentType', () => {
  const taxable = { taxability: 'taxable' } as const;

  it('is a Tax Invoice for a registered seller with a taxable line', () => {
    expect(documentType({ sellerRegistered: true, lines: [taxable, { taxability: 'nil' }] })).toBe('Tax Invoice');
  });
  it('is a Bill of Supply for an unregistered seller even with taxable lines', () => {
    expect(documentType({ sellerRegistered: false, lines: [taxable] })).toBe('Bill of Supply');
  });
  it.each(['nil', 'exempt', 'non_gst'] as const)('is a Bill of Supply when every line is %s', (taxability) => {
    expect(documentType({ sellerRegistered: true, lines: [{ taxability }, { taxability }] })).toBe('Bill of Supply');
  });
  it('is a Bill of Supply when every line is non-taxable in a mix of kinds', () => {
    expect(documentType({ sellerRegistered: true, lines: [{ taxability: 'nil' }, { taxability: 'exempt' }, { taxability: 'non_gst' }] })).toBe('Bill of Supply');
  });
});

describe('gstr1Section', () => {
  const lakh = B2CL_THRESHOLD_MINOR;

  it('puts a taxable supply to a registered client in B2B, whatever the amount or split', () => {
    expect(gstr1Section({ taxability: 'taxable', clientRegistered: true, split: 'intra', invoiceTotalMinor: 5 * lakh })).toBe('B2B');
    expect(gstr1Section({ taxability: 'taxable', clientRegistered: true, split: 'inter', invoiceTotalMinor: 100 })).toBe('B2B');
  });
  it('puts inter-state unregistered above the threshold in B2CL', () => {
    expect(gstr1Section({ taxability: 'taxable', clientRegistered: false, split: 'inter', invoiceTotalMinor: lakh + 1 })).toBe('B2CL');
  });
  it('keeps inter-state unregistered at exactly the threshold in B2CS', () => {
    expect(gstr1Section({ taxability: 'taxable', clientRegistered: false, split: 'inter', invoiceTotalMinor: lakh })).toBe('B2CS');
  });
  it('keeps intra-state unregistered in B2CS however large', () => {
    expect(gstr1Section({ taxability: 'taxable', clientRegistered: false, split: 'intra', invoiceTotalMinor: 10 * lakh })).toBe('B2CS');
  });
  it('lets the threshold be configured', () => {
    const input = { taxability: 'taxable', clientRegistered: false, split: 'inter', invoiceTotalMinor: 60_000_00 } as const;
    expect(gstr1Section(input)).toBe('B2CS');
    expect(gstr1Section(input, { b2clThresholdMinor: 50_000_00 })).toBe('B2CL');
  });
  it.each(['nil', 'exempt', 'non_gst'] as const)('sends %s supplies to the nil/exempt/non-GST table for any recipient', (taxability) => {
    expect(gstr1Section({ taxability, clientRegistered: true, split: 'inter', invoiceTotalMinor: 5 * lakh })).toBe('NIL_EXEMPT_NON_GST');
    expect(gstr1Section({ taxability, clientRegistered: false, split: 'intra', invoiceTotalMinor: 1 })).toBe('NIL_EXEMPT_NON_GST');
  });
  it('defaults the threshold to one lakh rupees in paise', () => {
    expect(B2CL_THRESHOLD_MINOR).toBe(10_000_000);
  });
});

describe('validateHsnSac', () => {
  it.each(['998314', '84713010', '8471'])('accepts HSN/SAC %s', (code) => {
    expect(validateHsnSac(code)).toMatchObject({ ok: true, code });
  });
  it('classifies 6 digits starting 99 as SAC', () => {
    expect(validateHsnSac('998314')).toEqual({ ok: true, kind: 'SAC', code: '998314' });
  });
  it('classifies other 4, 6 and 8 digit codes as HSN', () => {
    expect(validateHsnSac('8471')).toEqual({ ok: true, kind: 'HSN', code: '8471' });
    expect(validateHsnSac('847130')).toEqual({ ok: true, kind: 'HSN', code: '847130' });
    expect(validateHsnSac('84713010')).toEqual({ ok: true, kind: 'HSN', code: '84713010' });
  });
  it('rejects a 99-prefixed code that is not 6 digits', () => {
    expect(validateHsnSac('9983')).toMatchObject({ ok: false });
    expect(validateHsnSac('99831400')).toMatchObject({ ok: false });
  });
  it.each(['', '123', '12345', '1234567', '123456789', '84A7', '84 71', '8471.3'])('rejects %j', (code) => {
    expect(validateHsnSac(code)).toMatchObject({ ok: false });
  });
  it('trims surrounding whitespace', () => {
    expect(validateHsnSac(' 998314 ')).toMatchObject({ ok: true, code: '998314' });
  });
});
