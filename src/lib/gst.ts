declare const stateCodeBrand: unique symbol;
declare const gstinBrand: unique symbol;

export type StateCode = string & { readonly [stateCodeBrand]: true };
export type Gstin = string & { readonly [gstinBrand]: true };

const STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

export const B2CL_THRESHOLD_MINOR = 100_000_00;

export type GstinFailure = 'length' | 'format' | 'state' | 'checksum';
export type GstinCheck =
  | { ok: true; registered: false }
  | { ok: true; registered: true; gstin: Gstin; stateCode: StateCode; stateName: string }
  | { ok: false; reason: GstinFailure };

export type TaxSplit = 'intra' | 'inter';
export type Taxability = 'taxable' | 'nil' | 'exempt' | 'non_gst';
export type DocumentType = 'Tax Invoice' | 'Bill of Supply';
export type Gstr1Section = 'B2B' | 'B2CL' | 'B2CS' | 'NIL_EXEMPT_NON_GST';

export type PlaceOfSupply =
  | { ok: true; stateCode: StateCode; source: 'gstin' | 'billing-address' | 'seller-default' }
  | { ok: false; reason: GstinFailure };

export type HsnSacCheck =
  | { ok: true; kind: 'HSN' | 'SAC'; code: string }
  | { ok: false; reason: 'format' };

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function stateName(code: string): string | undefined {
  return Object.hasOwn(STATE_NAMES, code) ? STATE_NAMES[code] : undefined;
}

function asStateCode(code: string | undefined): StateCode | undefined {
  return code !== undefined && stateName(code) !== undefined ? (code as StateCode) : undefined;
}

function checksumChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = CHARSET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function validateGstin(input: string | null | undefined): GstinCheck {
  const value = (input ?? '').trim().toUpperCase();
  if (value === '') return { ok: true, registered: false };
  if (value.length !== 15) return { ok: false, reason: 'length' };
  if (!GSTIN_SHAPE.test(value)) return { ok: false, reason: 'format' };
  const stateCode = asStateCode(value.slice(0, 2));
  if (!stateCode) return { ok: false, reason: 'state' };
  if (checksumChar(value) !== value[14]) return { ok: false, reason: 'checksum' };
  return { ok: true, registered: true, gstin: value as Gstin, stateCode, stateName: STATE_NAMES[stateCode] };
}

export function stateFromGstin(input: string | null | undefined): { stateCode: StateCode; stateName: string } | undefined {
  const check = validateGstin(input);
  return check.ok && check.registered ? { stateCode: check.stateCode, stateName: check.stateName } : undefined;
}

export function placeOfSupply(
  sellerState: StateCode | string,
  client: { gstin?: string | null; billingStateCode?: string | null },
): PlaceOfSupply {
  const check = validateGstin(client.gstin);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (check.registered) return { ok: true, stateCode: check.stateCode, source: 'gstin' };
  const billing = client.billingStateCode?.trim();
  if (!billing) {
    const seller = asStateCode(sellerState);
    return seller ? { ok: true, stateCode: seller, source: 'seller-default' } : { ok: false, reason: 'state' };
  }
  const stateCode = asStateCode(billing);
  return stateCode ? { ok: true, stateCode, source: 'billing-address' } : { ok: false, reason: 'state' };
}

export function taxSplit(sellerStateCode: string, posStateCode: string): TaxSplit {
  return sellerStateCode === posStateCode ? 'intra' : 'inter';
}

export function documentType(input: { sellerRegistered: boolean; lines: ReadonlyArray<{ taxability: Taxability }> }): DocumentType {
  const anyTaxable = input.lines.some((line) => line.taxability === 'taxable');
  return input.sellerRegistered && anyTaxable ? 'Tax Invoice' : 'Bill of Supply';
}

export function gstr1Section(
  input: { taxability: Taxability; clientRegistered: boolean; split: TaxSplit; invoiceTotalMinor: number },
  options: { b2clThresholdMinor?: number } = {},
): Gstr1Section {
  if (input.taxability !== 'taxable') return 'NIL_EXEMPT_NON_GST';
  if (input.clientRegistered) return 'B2B';
  const threshold = options.b2clThresholdMinor ?? B2CL_THRESHOLD_MINOR;
  return input.split === 'inter' && input.invoiceTotalMinor > threshold ? 'B2CL' : 'B2CS';
}

export function validateHsnSac(input: string): HsnSacCheck {
  const code = input.trim();
  if (!/^\d+$/.test(code)) return { ok: false, reason: 'format' };
  if (code.startsWith('99')) return code.length === 6 ? { ok: true, kind: 'SAC', code } : { ok: false, reason: 'format' };
  return [4, 6, 8].includes(code.length) ? { ok: true, kind: 'HSN', code } : { ok: false, reason: 'format' };
}
