/** A named invoice format: the layout, block toggles, accent colour and logo choice a tenant prints invoices with. No store or node imports, so the Settings preview can use it in the browser. */

export const LAYOUTS = { classic: 'Classic', compact: 'Compact', panel: 'Panel' } as const;
export type LayoutId = keyof typeof LAYOUTS;

export const BLOCKS = {
  hsnSac: 'HSN/SAC column',
  bankDetails: 'Bank details',
  upiQr: 'UPI QR slot',
  signature: 'Signature',
  stamp: 'Company stamp',
  terms: 'Terms',
  amountInWords: 'Amount in words',
  upiId: 'UPI ID text',
} as const;
export type BlockId = keyof typeof BLOCKS;
/** Blocks every stored format has. `upiId` came later, so a format saved before it has no value and prints without it. */
export type CoreBlockId = Exclude<BlockId, 'upiId'>;

export const LOGO_CHOICES = { show: 'Show company logo', hide: 'No logo' } as const;
export type LogoChoice = keyof typeof LOGO_CHOICES;

export type FormatDefinition = {
  layout: LayoutId;
  blocks: Record<CoreBlockId, boolean> & { upiId?: boolean };
  accent: string;
  /** The Panel layout's second colour. Absent on formats saved before it existed, where it follows the accent. */
  accentSecondary?: string;
  logo: LogoChoice;
  bankDetails: string;
  terms: string;
  /** Printed as plain text, apart from the QR slot, when the `upiId` block is on. Absent on older formats. */
  upiId?: string;
};
export type InvoiceFormat = { id: string; name: string; isDefault: boolean; definition: FormatDefinition };
/** What an issued invoice keeps. Never only the id, so editing or deleting the format cannot change the invoice. */
export type SnapshotFormat = { id: string; name: string; definition: FormatDefinition };

export const NAME_LIMIT = 40;
export const BANK_DETAILS_LIMIT = 500;
export const TERMS_LIMIT = 1000;
export const UPI_ID_LIMIT = 100;
export const DEFAULT_ACCENT = '#11756c';

/** What every invoice printed before formats existed. Bank details and terms are empty, so those blocks print nothing. */
export const BUILTIN_DEFINITION: FormatDefinition = Object.freeze({
  layout: 'classic',
  blocks: Object.freeze({ hsnSac: true, bankDetails: true, upiQr: false, signature: true, stamp: true, terms: true, amountInWords: true }),
  accent: DEFAULT_ACCENT,
  logo: 'show',
  bankDetails: '',
  terms: '',
});
export const BUILTIN_FORMAT: SnapshotFormat = { id: 'builtin', name: 'Standard', definition: BUILTIN_DEFINITION };
export const LEGACY_FORMAT: SnapshotFormat = { id: 'legacy', name: 'Standard', definition: BUILTIN_DEFINITION };

const KEYS = ['layout', 'blocks', 'accent', 'accentSecondary', 'logo', 'bankDetails', 'terms', 'upiId'] as const;
const MIN_CONTRAST_WITH_WHITE = 4.5;
/** The Panel layout sets its second colour in bold capitals, so the 3:1 bar for large bold text applies. */
const MIN_CONTRAST_SECONDARY = 3;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`The ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string') throw new Error(`The ${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > limit) throw new Error(`The ${label} can be at most ${limit} characters.`);
  return trimmed;
}

function parseAccent(value: unknown, minContrast = MIN_CONTRAST_WITH_WHITE): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error('Choose the accent colour as six hex digits, like #11756c.');
  const accent = value.toLowerCase();
  if (1.05 / (luminance(accent) + 0.05) < minContrast) throw new Error('Choose a darker accent colour so the white table headings stay readable.');
  return accent;
}

function parseUpiId(value: unknown): string {
  const upiId = text(value, 'UPI ID', UPI_ID_LIMIT);
  if (/[\r\n]/.test(upiId)) throw new Error('The UPI ID must be on one line.');
  return upiId;
}

/** The boundary check for a format definition from a request or a stored row. A block missing from older rows takes the builtin value. */
export function parseFormatDefinition(input: unknown): FormatDefinition {
  const source = record(input, 'invoice format');
  for (const key of Object.keys(source)) if (!(KEYS as readonly string[]).includes(key)) throw new Error(`Unknown invoice format field "${key}".`);
  const layout = source.layout;
  if (typeof layout !== 'string' || !Object.hasOwn(LAYOUTS, layout)) throw new Error('Choose a valid layout.');
  const given = record(source.blocks ?? {}, 'blocks');
  for (const key of Object.keys(given)) if (!Object.hasOwn(BLOCKS, key)) throw new Error(`Unknown invoice block "${key}".`);
  const blocks = { ...BUILTIN_DEFINITION.blocks };
  for (const id of Object.keys(BLOCKS) as BlockId[]) {
    if (given[id] === undefined) continue;
    if (typeof given[id] !== 'boolean') throw new Error(`Switch ${BLOCKS[id]} on or off.`);
    blocks[id] = given[id];
  }
  const logo = source.logo;
  if (typeof logo !== 'string' || !Object.hasOwn(LOGO_CHOICES, logo)) throw new Error('Choose a valid logo option.');
  const definition: FormatDefinition = { layout: layout as LayoutId, blocks, accent: parseAccent(source.accent), logo: logo as LogoChoice, bankDetails: text(source.bankDetails ?? '', 'bank details', BANK_DETAILS_LIMIT), terms: text(source.terms ?? '', 'terms', TERMS_LIMIT) };
  if (source.accentSecondary !== undefined) definition.accentSecondary = parseAccent(source.accentSecondary, MIN_CONTRAST_SECONDARY);
  const upiId = source.upiId === undefined ? '' : parseUpiId(source.upiId);
  if (upiId) definition.upiId = upiId;
  return definition;
}

export function parseFormatName(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a name for the invoice format.');
  const name = input.trim();
  if (name.length > NAME_LIMIT) throw new Error(`The invoice format name can be at most ${NAME_LIMIT} characters.`);
  return name;
}

export function snapshotFormat(format: Pick<InvoiceFormat, 'id' | 'name' | 'definition'>): SnapshotFormat {
  return { id: format.id, name: format.name, definition: { ...format.definition, blocks: { ...format.definition.blocks } } };
}

/** Which format an invoice prints with: the one chosen for it, then the customer's, then the tenant default, then the builtin. */
export function resolveInvoiceFormat(formats: InvoiceFormat[], choice: { requestedId?: string | null; customerDefaultId?: string | null }): SnapshotFormat {
  if (choice.requestedId) {
    const requested = formats.find((format) => format.id === choice.requestedId);
    if (!requested) throw new Error('The selected invoice format was not found.');
    return snapshotFormat(requested);
  }
  const chosen = (choice.customerDefaultId && formats.find((format) => format.id === choice.customerDefaultId)) || formats.find((format) => format.isDefault);
  return snapshotFormat(chosen || BUILTIN_FORMAT);
}

export function printedFormat(snapshot: { format?: SnapshotFormat }): SnapshotFormat { return snapshot.format ?? LEGACY_FORMAT; }

/** A create or update request: a name, a definition and whether to make it the tenant default. */
export function parseFormatInput(input: unknown): { name: string; definition: FormatDefinition; isDefault: boolean } {
  const source = record(input, 'request');
  if (source.isDefault !== undefined && typeof source.isDefault !== 'boolean') throw new Error('Say whether this format is the default with true or false.');
  return { name: parseFormatName(source.name), definition: parseFormatDefinition(source.definition), isDefault: source.isDefault === true };
}
