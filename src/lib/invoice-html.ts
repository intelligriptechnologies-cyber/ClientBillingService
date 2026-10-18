import { amountInWords, roundToRupee } from './amount-words';
import { documentShell, escapeHtml, imageHtml } from './document-html';
import { formatDate, formatMoney } from './format';
import { printedFormat, type FormatDefinition } from './invoice-format';
import { stateName } from './gst';
import { documentTitle, lineTaxLabel, printsGstColumns } from './invoice-document';
import type { InvoiceLine } from './invoice-lines';
import type { TenantInvoice } from './tenant-store';

type PrintedLine = { description: string; hsnSac: string; quantity: number; rateMinor: number; taxLabel: string; amountMinor: number; gstMinor: number; totalMinor: number };

const e = escapeHtml;
const SPLIT_NAMES = { intra: 'CGST + SGST', inter: 'IGST' } as const;

function signed(minor: number): string { return `${minor < 0 ? '-' : '+'}${formatMoney(Math.abs(minor))}`; }

function lineRows(invoice: TenantInvoice): PrintedLine[] {
  const { snapshot } = invoice;
  if (snapshot.lines?.length) return snapshot.lines.map((line: InvoiceLine) => ({ description: line.description, hsnSac: line.hsnSac ?? '', quantity: line.quantity, rateMinor: line.rateMinor, taxLabel: lineTaxLabel(line), amountMinor: line.amountMinor, gstMinor: line.gstMinor, totalMinor: line.totalMinor }));
  const taxName = snapshot.taxSplit ? SPLIT_NAMES[snapshot.taxSplit] : 'GST';
  return [{ description: 'Services billed', hsnSac: '', quantity: 1, rateMinor: invoice.taxableMinor, taxLabel: invoice.gstMinor > 0 ? `${taxName} ${invoice.gstRate}%` : 'No GST', amountMinor: invoice.taxableMinor, gstMinor: invoice.gstMinor, totalMinor: invoice.taxableMinor + invoice.gstMinor }];
}

/** The tax rows under the line items, split the way the issued lines were taxed. */
function taxRows(invoice: TenantInvoice): Array<[string, number]> {
  const { snapshot } = invoice;
  const lines = snapshot.lines;
  const igst = lines?.length ? lines.filter((line) => line.taxType === 'igst').reduce((sum, line) => sum + line.gstMinor, 0) : snapshot.taxSplit === 'inter' ? invoice.gstMinor : 0;
  const domestic = invoice.gstMinor - igst;
  if (!lines?.length && !snapshot.taxSplit) return [['GST', invoice.gstMinor]];
  const cgst = Math.floor(domestic / 2);
  return ([['CGST', cgst], ['SGST', domestic - cgst], ['IGST', igst]] as Array<[string, number]>).filter(([, minor]) => minor !== 0);
}

function row(label: string, value: string, className = ''): string {
  return `<tr${className ? ` class="${className}"` : ''}><th scope="row">${e(label)}</th><td>${e(value)}</td></tr>`;
}

function sellerHtml(invoice: TenantInvoice, taxed: boolean): string {
  const { snapshot } = invoice;
  const legalName = snapshot.sellerLegalName && snapshot.sellerLegalName !== snapshot.companyName ? snapshot.sellerLegalName : '';
  const sellerState = snapshot.sellerStateCode ? `${stateName(snapshot.sellerStateCode) ?? snapshot.sellerStateCode} (${snapshot.sellerStateCode})` : '';
  const gstin = snapshot.gstin || taxed ? `GSTIN: ${snapshot.gstin || 'Not registered'}` : '';
  return [
    `<h2 class="company">${e(snapshot.companyName)}</h2>`,
    legalName ? `<p>${e(legalName)}</p>` : '',
    snapshot.address ? `<p class="multiline">${e(snapshot.address)}</p>` : '',
    gstin ? `<p>${e(gstin)}</p>` : '',
    sellerState ? `<p>State: ${e(sellerState)}</p>` : '',
  ].filter(Boolean).join('\n');
}

function billToLines(snapshot: TenantInvoice['snapshot']): string[] {
  const clientStateCode = snapshot.customerGstin ? snapshot.customerGstin.slice(0, 2) : '';
  const clientState = clientStateCode && stateName(clientStateCode) ? `${stateName(clientStateCode)} (${clientStateCode})` : '';
  return [
    `<p class="company">${e(snapshot.customerName)}</p>`,
    snapshot.customerAddress ? `<p class="multiline">${e(snapshot.customerAddress)}</p>` : '',
    snapshot.customerEmail ? `<p>${e(snapshot.customerEmail)}</p>` : '',
    snapshot.customerPan ? `<p>PAN: ${e(snapshot.customerPan)}</p>` : '',
    snapshot.customerGstin ? `<p>GSTIN: ${e(snapshot.customerGstin)}</p>` : '',
    clientState ? `<p>State: ${e(clientState)}</p>` : '',
  ].filter(Boolean);
}

function supplyDetailLines(snapshot: TenantInvoice['snapshot']): string[] {
  const supply = snapshot.placeOfSupplyStateCode ? `${stateName(snapshot.placeOfSupplyStateCode) ?? snapshot.placeOfSupplyStateCode} (${snapshot.placeOfSupplyStateCode})` : '';
  return [supply ? `<p>Place of supply: ${e(supply)}</p>` : '', snapshot.venue ? `<p>Venue: ${e(snapshot.venue)}</p>` : ''].filter(Boolean);
}

function partiesHtml(invoice: TenantInvoice): string {
  const billTo = ['<h3>Bill to</h3>', ...billToLines(invoice.snapshot)].join('\n');
  return `<section class="parties"><div>\n${billTo}\n</div><div>\n${supplyDetailLines(invoice.snapshot).join('\n')}\n</div></section>`;
}

function linesHtml(rows: PrintedLine[], taxed: boolean, showHsn: boolean): string {
  const hasHsn = showHsn && rows.some((line) => line.hsnSac);
  const head = ['<th>#</th>', '<th>Description</th>', hasHsn ? '<th>HSN/SAC</th>' : '', '<th class="num">Qty</th>', '<th class="num">Rate</th>', taxed ? '<th class="num">Taxable value</th><th class="num">Tax</th>' : '', '<th class="num">Amount</th>'].filter(Boolean).join('');
  const body = rows.map((line, index) => `<tr><td>${index + 1}</td><td class="multiline">${e(line.description)}</td>${hasHsn ? `<td>${e(line.hsnSac)}</td>` : ''}<td class="num">${line.quantity}</td><td class="num">${e(formatMoney(line.rateMinor))}</td>${taxed ? `<td class="num">${e(formatMoney(line.amountMinor))}</td><td class="num">${e(line.taxLabel)}<span class="tax-amount">${e(formatMoney(line.gstMinor))}</span></td>` : ''}<td class="num">${e(formatMoney(line.totalMinor))}</td></tr>`).join('\n');
  return `<table class="lines"><thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody></table>`;
}

function summaryHtml(invoice: TenantInvoice, taxed: boolean, showWords: boolean): string {
  const { roundedMinor, roundOffMinor } = roundToRupee(invoice.totalMinor);
  const rows = [
    row(taxed ? 'Taxable value' : 'Value of supply', formatMoney(invoice.taxableMinor)),
    ...(taxed ? [...taxRows(invoice).map(([label, minor]) => row(label, formatMoney(minor))), row('Total', formatMoney(invoice.totalMinor))] : []),
    row('Round off', signed(roundOffMinor)),
    row('Amount payable', formatMoney(roundedMinor), 'payable'),
  ].join('\n');
  return `<section class="summary"><div class="words">${showWords ? `<h3>Amount in words</h3><p>${e(amountInWords(invoice.totalMinor))}</p>` : ''}</div><table class="totals">\n${rows}\n</table></section>`;
}

const UPI_SLOT_STYLE = '.upi-slot { width: 84px; height: 84px; margin-left: auto; border: 1px dashed #66757f; display: flex; align-items: center; justify-content: center; text-align: center; color: #66757f; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }';
const UPI_SLOT_HTML = '<div class="upi-slot"><span>UPI QR</span></div>';
const PAYMENT_STYLES = `
.payment { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 12px; break-inside: avoid; }
.payment .bank { flex: 1; min-width: 0; }
${UPI_SLOT_STYLE}
`;
const TERMS_STYLES = `
.terms { margin-top: 12px; break-inside: avoid; }
`;

function upiIdLine(format: FormatDefinition): string {
  return format.blocks.upiId && format.upiId ? `<p>UPI ID: ${e(format.upiId)}</p>` : '';
}

function paymentHtml(format: FormatDefinition): string {
  const bankText = format.blocks.bankDetails && format.bankDetails ? `<h3>Bank details</h3><p class="multiline">${e(format.bankDetails)}</p>` : '';
  const upiText = upiIdLine(format);
  const bank = bankText || upiText ? `<div class="bank">${bankText}${upiText}</div>` : '';
  const upi = format.blocks.upiQr ? UPI_SLOT_HTML : '';
  return bank || upi ? `<section class="payment">${bank}${upi}</section>` : '';
}

function termsHtml(format: FormatDefinition): string {
  return format.blocks.terms && format.terms ? `<section class="terms"><h3>Terms</h3><p class="multiline">${e(format.terms)}</p></section>` : '';
}

function closingHtml(snapshot: TenantInvoice['snapshot'], format: FormatDefinition): string {
  const marks = [format.blocks.stamp ? imageHtml(snapshot.stampDataUrl, 'Company stamp', 'stamp') : '', format.blocks.signature ? imageHtml(snapshot.signatureDataUrl, 'Authorised signature', 'signature') : ''].filter(Boolean).join('');
  const signatory = format.blocks.stamp || format.blocks.signature ? `<div class="signatory"><div class="marks">${marks}</div><p>Authorised signatory</p></div>` : '';
  return `<section class="closing"><p class="footer multiline">${e(snapshot.footer)}</p>${signatory}</section>`;
}

/** What the preview and the PDF both print: the issued snapshot, nothing read from live settings. */
export function renderInvoiceHtml(invoice: TenantInvoice): string {
  const { snapshot } = invoice;
  const taxed = printsGstColumns(snapshot);
  const title = documentTitle(snapshot);
  const heading = snapshot.invoiceTemplate?.replaceAll('{{invoiceNumber}}', invoice.invoiceNumber).replaceAll('{{customerName}}', snapshot.customerName).trim();
  const { definition } = printedFormat(snapshot);
  if (definition.layout === 'panel') return renderPanelHtml(invoice, definition, taxed, title);
  const payment = paymentHtml(definition);
  const terms = termsHtml(definition);
  const body = [
    `<header class="masthead"><div class="seller">${definition.logo === 'show' ? imageHtml(snapshot.logoDataUrl, 'Logo', 'logo') : ''}<div>\n${sellerHtml(invoice, taxed)}\n</div></div><div class="doc"><h1>${e(title)}</h1><dl><dt>Invoice no.</dt><dd>${e(invoice.invoiceNumber)}</dd><dt>Issue date</dt><dd>${e(formatDate(invoice.invoiceDate))}</dd><dt>Due date</dt><dd>${e(formatDate(invoice.dueDate))}</dd></dl></div></header>`,
    heading ? `<p class="heading">${e(heading)}</p>` : '',
    partiesHtml(invoice),
    linesHtml(lineRows(invoice), taxed, definition.blocks.hsnSac),
    summaryHtml(invoice, taxed, definition.blocks.amountInWords),
    payment,
    snapshot.notes ? `<section class="notes"><h3>Notes</h3><p class="multiline">${e(snapshot.notes)}</p></section>` : '',
    terms,
    closingHtml(snapshot, definition),
  ].filter(Boolean).join('\n');
  return documentShell(`${title} ${invoice.invoiceNumber}`, body, { accent: definition.accent, compact: definition.layout === 'compact', extraStyles: (payment ? PAYMENT_STYLES : '') + (terms ? TERMS_STYLES : '') });
}

const PANEL_MIN_ROWS = 4;

/** `share` of the colour kept, the rest white. A light fill that still reads as the same hue. */
function tint(hex: string, share: number): string {
  return `#${[1, 3, 5].map((start) => Math.round(255 - (255 - parseInt(hex.slice(start, start + 2), 16)) * share).toString(16).padStart(2, '0')).join('')}`;
}

function panelStyles(primary: string, secondary: string): string {
  return `
.pn-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.pn-head .logo { max-width: 340px; max-height: 90px; object-fit: contain; }
.pn-title { flex: none; min-width: 200px; padding: 10px 14px; background: ${tint(primary, 0.06)}; }
.pn-title h1 { font-size: 24px; font-weight: 400; letter-spacing: 0; text-transform: uppercase; color: ${primary}; }
.pn-title p { font-size: 9px; margin-top: 4px; }
.pn-band { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; padding: 14px 12px; background: ${tint(secondary, 0.09)}; overflow-wrap: anywhere; }
.pn-band h3, .pn-bank h3 { color: ${secondary}; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; margin-bottom: 5px; }
.pn-band p, .pn-band h2 { font-size: 12px; font-weight: 400; line-height: 1.6; }
.pn-band .company { font-weight: 400; }
.pn-lines { margin-top: 16px; }
.pn-lines th, .pn-lines td { border: 1px solid #17232d; padding: 5px 7px; vertical-align: top; overflow-wrap: anywhere; }
.pn-lines th { font-size: 10px; font-weight: 700; color: #fff; text-align: left; letter-spacing: 0.03em; white-space: nowrap; }
.pn-lines th.pn-a { background: ${primary}; }
.pn-lines th.pn-b { background: ${secondary}; }
.pn-lines .num { text-align: center !important; }
.pn-lines tr { break-inside: avoid; }
.pn-filler td { height: 22px; }
.pn-lower { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 14px; break-inside: avoid; }
.pn-bank { width: 46%; padding: 14px 12px; background: ${tint(secondary, 0.09)}; }
.pn-bank p { font-size: 10px; line-height: 1.9; }
.pn-bank p + h3 { margin-top: 16px; }
.pn-bank .upi-slot { margin: 8px 0 0; }
.pn-right { width: 46%; margin-left: auto; }
.pn-totals { background: ${tint(primary, 0.06)}; }
.pn-totals th { padding: 8px 10px 4px; font-size: 10px; font-weight: 400; text-align: left; }
.pn-totals td { padding: 8px 10px 4px; font-size: 11px; text-align: right; white-space: nowrap; }
.pn-totals .payable th, .pn-totals .payable td { padding: 9px 10px; font-size: 11px; font-weight: 700; color: ${primary}; background: ${tint(secondary, 0.16)}; }
.pn-words { margin-top: 12px; padding: 8px 10px; min-height: 52px; border: 1px solid #17232d; font-size: 10px; font-weight: 700; }
.pn-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 36px; break-inside: avoid; }
.pn-notes { flex: 1; min-width: 0; font-size: 10px; }
.pn-notes .pn-label { color: ${secondary}; font-weight: 700; margin-top: 8px; }
.pn-notes .pn-label:first-child { margin-top: 0; }
.pn-sign { flex: none; min-width: 180px; text-align: center; }
.pn-sign .signature { max-width: 150px; max-height: 56px; object-fit: contain; }
.pn-sign .stamp { max-width: 150px; max-height: 80px; margin-top: 8px; object-fit: contain; }
.pn-sign p { font-size: 11px; }
${UPI_SLOT_STYLE}
`;
}

function panelLinesHtml(rows: PrintedLine[], taxed: boolean, showHsn: boolean): string {
  const hasHsn = showHsn && rows.some((line) => line.hsnSac);
  const heads = ['<th class="pn-a">#</th>', '<th class="pn-a">DESCRIPTION</th>', hasHsn ? '<th class="pn-a">HSN/SAC</th>' : '', '<th class="pn-b num">RATE</th>', '<th class="pn-b num">QTY</th>', taxed ? '<th class="pn-b num">TAXABLE VALUE</th><th class="pn-b num">TAX</th>' : '', '<th class="pn-b num">AMOUNT (₹)</th>'].filter(Boolean);
  const body = rows.map((line, index) => `<tr><td>${index + 1}</td><td class="multiline">${e(line.description)}</td>${hasHsn ? `<td>${e(line.hsnSac)}</td>` : ''}<td class="num">${e(formatMoney(line.rateMinor))}</td><td class="num">${line.quantity}</td>${taxed ? `<td class="num">${e(formatMoney(line.amountMinor))}</td><td class="num">${e(line.taxLabel)}<span class="tax-amount">${e(formatMoney(line.gstMinor))}</span></td>` : ''}<td class="num">${e(formatMoney(line.totalMinor))}</td></tr>`);
  const columns = heads.join('').match(/<th/g)!.length;
  const filler = `<tr class="pn-filler">${'<td></td>'.repeat(columns)}</tr>`;
  const padded = [...body, ...Array.from({ length: Math.max(0, PANEL_MIN_ROWS - body.length) }, () => filler)];
  return `<table class="pn-lines"><thead><tr>${heads.join('')}</tr></thead>\n<tbody>\n${padded.join('\n')}\n</tbody></table>`;
}

function panelBankHtml(format: FormatDefinition): string {
  const bank = format.blocks.bankDetails && format.bankDetails ? `<h3>BANK DETAILS</h3><p class="multiline">${e(format.bankDetails)}</p>` : '';
  const upiId = upiIdLine(format);
  const upi = upiId || format.blocks.upiQr ? `<h3>UPI</h3>${upiId}${format.blocks.upiQr ? UPI_SLOT_HTML : ''}` : '';
  return bank || upi ? `<div class="pn-bank">${bank}${upi}</div>` : '';
}

function panelTotalsHtml(invoice: TenantInvoice, taxed: boolean): string {
  const { roundedMinor, roundOffMinor } = roundToRupee(invoice.totalMinor);
  const gst = (taxed ? taxRows(invoice) : []).filter(([, minor]) => minor !== 0);
  const rows = [
    row('Subtotal', formatMoney(invoice.taxableMinor)),
    ...(gst.length ? gst.map(([label, minor]) => row(label, formatMoney(minor))) : [row('GST (if applicable)', formatMoney(0))]),
    ...(roundOffMinor ? [row('Round off', signed(roundOffMinor))] : []),
    row('TOTAL PAYABLE', formatMoney(roundedMinor), 'payable'),
  ].join('\n');
  return `<table class="pn-totals">\n${rows}\n</table>`;
}

function panelFootHtml(snapshot: TenantInvoice['snapshot'], format: FormatDefinition): string {
  const notes = [
    snapshot.notes ? `<p class="pn-label">Notes:</p><p class="multiline">${e(snapshot.notes)}</p>` : '',
    format.blocks.terms && format.terms ? `<p class="pn-label">Terms:</p><p class="multiline">${e(format.terms)}</p>` : '',
    snapshot.footer ? `<p class="multiline muted">${e(snapshot.footer)}</p>` : '',
  ].filter(Boolean).join('');
  const sign = format.blocks.stamp || format.blocks.signature
    ? `<div class="pn-sign">${format.blocks.signature ? imageHtml(snapshot.signatureDataUrl, 'Authorised signature', 'signature') : ''}<p>Authorized Signatory</p>${format.blocks.stamp ? imageHtml(snapshot.stampDataUrl, 'Company stamp', 'stamp') : ''}</div>` : '';
  return `<section class="pn-foot"><div class="pn-notes">${notes}</div>${sign}</section>`;
}

/** The Panel layout: tinted title box and parties band, ruled items table, bank and UPI panel beside tinted totals. It prints from the same snapshot as every layout, so GST columns and tax rows follow the invoice. */
function renderPanelHtml(invoice: TenantInvoice, definition: FormatDefinition, taxed: boolean, title: string): string {
  const { snapshot } = invoice;
  const heading = snapshot.invoiceTemplate?.replaceAll('{{invoiceNumber}}', invoice.invoiceNumber).replaceAll('{{customerName}}', snapshot.customerName).trim();
  const secondary = definition.accentSecondary ?? definition.accent;
  const body = [
    `<header class="pn-head"><div>${definition.logo === 'show' ? imageHtml(snapshot.logoDataUrl, 'Logo', 'logo') : ''}</div><div class="pn-title"><h1>${e(title)}</h1><p>Invoice No: ${e(invoice.invoiceNumber)}</p><p>Date: ${e(formatDate(invoice.invoiceDate))}</p><p>Due Date: ${e(formatDate(invoice.dueDate))}</p></div></header>`,
    heading ? `<p class="heading">${e(heading)}</p>` : '',
    `<section class="pn-band"><div>\n<h3>BILL TO</h3>\n${billToLines(snapshot).join('\n')}\n</div><div>\n<h3>ISSUED BY</h3>\n${sellerHtml(invoice, taxed)}\n${supplyDetailLines(snapshot).join('\n')}\n</div></section>`,
    panelLinesHtml(lineRows(invoice), taxed, definition.blocks.hsnSac),
    `<section class="pn-lower">${panelBankHtml(definition)}<div class="pn-right">\n${panelTotalsHtml(invoice, taxed)}\n${definition.blocks.amountInWords ? `<p class="pn-words">Amount in words: ${e(amountInWords(invoice.totalMinor))}</p>` : ''}\n</div></section>`,
    panelFootHtml(snapshot, definition),
  ].filter(Boolean).join('\n');
  return documentShell(`${title} ${invoice.invoiceNumber}`, body, { accent: definition.accent, extraStyles: panelStyles(definition.accent, secondary) });
}
