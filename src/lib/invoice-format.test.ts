import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION, BUILTIN_FORMAT, LEGACY_FORMAT, parseFormatDefinition, parseFormatName, printedFormat, resolveInvoiceFormat, snapshotFormat, type InvoiceFormat } from './invoice-format';

const stored = (id: string, name: string, patch: Partial<InvoiceFormat['definition']> = {}, isDefault = false): InvoiceFormat => ({ id, name, isDefault, definition: { ...BUILTIN_DEFINITION, blocks: { ...BUILTIN_DEFINITION.blocks }, ...patch } });

describe('parseFormatDefinition', () => {
  it('accepts a complete definition and returns it unchanged', () => {
    const input = { layout: 'compact', blocks: { hsnSac: false, bankDetails: true, upiQr: true, signature: true, stamp: false, terms: true, amountInWords: true }, accent: '#1F3A5F', logo: 'hide', bankDetails: 'HDFC 0001', terms: 'Net 14' };
    expect(parseFormatDefinition(input)).toEqual({ ...input, accent: '#1f3a5f' });
  });

  it('fills a block that is missing from the builtin so a stored format survives a new block being added', () => {
    const blocks: Record<string, boolean> = { ...BUILTIN_DEFINITION.blocks };
    delete blocks.upiQr;
    expect(parseFormatDefinition({ ...BUILTIN_DEFINITION, blocks }).blocks.upiQr).toBe(BUILTIN_DEFINITION.blocks.upiQr);
  });

  it('accepts the panel layout with a second accent and a UPI ID, lower-casing the colour', () => {
    const input = { ...BUILTIN_DEFINITION, layout: 'panel', accent: '#092A50', accentSecondary: '#079C9D', upiId: ' test@upi.example ', blocks: { ...BUILTIN_DEFINITION.blocks, upiId: true } };
    expect(parseFormatDefinition(input)).toEqual({ ...input, accent: '#092a50', accentSecondary: '#079c9d', upiId: 'test@upi.example' });
  });

  it('adds nothing for a definition without the new fields, and drops an empty UPI ID', () => {
    expect(Object.keys(parseFormatDefinition(BUILTIN_DEFINITION))).toEqual(Object.keys(BUILTIN_DEFINITION));
    expect(parseFormatDefinition({ ...BUILTIN_DEFINITION, upiId: '  ' })).not.toHaveProperty('upiId');
  });

  it.each([
    ['a second accent that is not six hex digits', { ...BUILTIN_DEFINITION, accentSecondary: 'teal' }, /colour/i],
    ['a second accent that could close the style element', { ...BUILTIN_DEFINITION, accentSecondary: '#fff}</style><script>' }, /colour/i],
    ['a second accent too light for white headings', { ...BUILTIN_DEFINITION, accentSecondary: '#f5f5a0' }, /darker/i],
    ['a UPI ID that is not text', { ...BUILTIN_DEFINITION, upiId: 7 }, /UPI/],
    ['a UPI ID over the limit', { ...BUILTIN_DEFINITION, upiId: 'x'.repeat(101) }, /UPI/],
    ['a UPI ID on two lines', { ...BUILTIN_DEFINITION, upiId: 'a@b\nc@d' }, /UPI/],
  ])('rejects %s', (_label, input, message) => {
    expect(() => parseFormatDefinition(input)).toThrow(message);
  });

  it('keeps the teal of a real client template, which is lighter than the primary accent rule allows', () => {
    expect(parseFormatDefinition({ ...BUILTIN_DEFINITION, accentSecondary: '#079c9d' }).accentSecondary).toBe('#079c9d');
    expect(() => parseFormatDefinition({ ...BUILTIN_DEFINITION, accent: '#079c9d' })).toThrow(/darker/i);
  });

  it.each([
    ['null', null, /format/i],
    ['an unknown layout', { ...BUILTIN_DEFINITION, layout: 'fancy' }, /layout/i],
    ['an unknown block', { ...BUILTIN_DEFINITION, blocks: { ...BUILTIN_DEFINITION.blocks, watermark: true } }, /watermark/],
    ['a block that is not a boolean', { ...BUILTIN_DEFINITION, blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: 'yes' } }, /HSN/],
    ['a colour that is not six hex digits', { ...BUILTIN_DEFINITION, accent: 'red' }, /colour/i],
    ['a colour that could close the style element', { ...BUILTIN_DEFINITION, accent: '#fff}</style><script>' }, /colour/i],
    ['a colour too light for white table headings', { ...BUILTIN_DEFINITION, accent: '#f5f5a0' }, /darker/i],
    ['an unknown logo choice', { ...BUILTIN_DEFINITION, logo: 'big' }, /logo/i],
    ['bank details that are not text', { ...BUILTIN_DEFINITION, bankDetails: 7 }, /bank/i],
    ['bank details that run too long', { ...BUILTIN_DEFINITION, bankDetails: 'x'.repeat(501) }, /bank/i],
    ['terms that run too long', { ...BUILTIN_DEFINITION, terms: 'x'.repeat(1001) }, /terms/i],
    ['a field nobody defined', { ...BUILTIN_DEFINITION, font: 'Comic Sans' }, /font/],
  ])('rejects %s', (_label, input, message) => {
    expect(() => parseFormatDefinition(input)).toThrow(message);
  });
});

describe('parseFormatName', () => {
  it('trims and keeps a normal name', () => { expect(parseFormatName('  Retainer clients ')).toBe('Retainer clients'); });
  it.each([[''], ['   '], [42], [null], ['x'.repeat(41)]])('rejects %j', (input) => { expect(() => parseFormatName(input)).toThrow(/name/i); });
});

describe('resolveInvoiceFormat', () => {
  const standard = stored('f-standard', 'Standard', {}, true);
  const lean = stored('f-lean', 'Lean', { layout: 'compact' });
  const clients = stored('f-client', 'Client');
  const formats = [standard, lean, clients];

  it('uses the tenant default when nothing else is chosen', () => { expect(resolveInvoiceFormat(formats, {}).id).toBe('f-standard'); });
  it('prefers the customer default over the tenant default', () => { expect(resolveInvoiceFormat(formats, { customerDefaultId: 'f-client' }).id).toBe('f-client'); });
  it('prefers a format chosen for this invoice over the customer default', () => { expect(resolveInvoiceFormat(formats, { requestedId: 'f-lean', customerDefaultId: 'f-client' }).id).toBe('f-lean'); });
  it('ignores a customer default that no longer exists', () => { expect(resolveInvoiceFormat(formats, { customerDefaultId: 'gone' }).id).toBe('f-standard'); });
  it('refuses a chosen format that is not in the tenant list, without echoing the id', () => {
    expect(() => resolveInvoiceFormat(formats, { requestedId: 'someone-elses-format' })).toThrow('The selected invoice format was not found.');
  });
  it('falls back to the builtin when the tenant has no formats yet', () => { expect(resolveInvoiceFormat([], {})).toEqual(BUILTIN_FORMAT); });
  it('treats a blank chosen id as no choice', () => { expect(resolveInvoiceFormat(formats, { requestedId: '', customerDefaultId: null }).id).toBe('f-standard'); });
});

describe('snapshotting', () => {
  it('copies the definition so later edits to the stored format cannot reach it', () => {
    const format = stored('f1', 'Lean', { accent: '#112233' });
    const snapshot = snapshotFormat(format);
    format.definition.accent = '#445566';
    format.definition.blocks.hsnSac = false;
    expect(snapshot.definition.accent).toBe('#112233');
    expect(snapshot.definition.blocks.hsnSac).toBe(true);
    expect(snapshot).toEqual({ id: 'f1', name: 'Lean', definition: expect.any(Object) });
    expect(snapshot).not.toHaveProperty('isDefault');
  });

  it('prints an invoice that predates formats with the legacy format', () => {
    expect(printedFormat({ })).toBe(LEGACY_FORMAT);
    const own = snapshotFormat(stored('f1', 'Lean'));
    expect(printedFormat({ format: own })).toBe(own);
  });

  it('keeps the legacy format identical to what every invoice printed before formats', () => {
    expect(LEGACY_FORMAT.definition).toEqual({ layout: 'classic', blocks: { hsnSac: true, bankDetails: true, upiQr: false, signature: true, stamp: true, terms: true, amountInWords: true }, accent: '#11756c', logo: 'show', bankDetails: '', terms: '' });
  });
});
