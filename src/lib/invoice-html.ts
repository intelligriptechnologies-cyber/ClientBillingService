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

function partiesHtml(invoice: TenantInvoice): string {
  const { snapshot } = invoice;
  const clientStateCode = snapshot.customerGstin ? snapshot.customerGstin.slice(0, 2) : '';
  const clientState = clientStateCode && stateName(clientStateCode) ? `${stateName(clientStateCode)} (${clientStateCode})` : '';
  const supply = snapshot.placeOfSupplyStateCode ? `${stateName(snapshot.placeOfSupplyStateCode) ?? snapshot.placeOfSupplyStateCode} (${snapshot.placeOfSupplyStateCode})` : '';
  const billTo = [
    `<h3>Bill to</h3>`,
    `<p class="company">${e(snapshot.customerName)}</p>`,
    snapshot.customerAddress ? `<p class="multiline">${e(snapshot.customerAddress)}</p>` : '',
    snapshot.customerEmail ? `<p>${e(snapshot.customerEmail)}</p>` : '',
    snapshot.customerPan ? `<p>PAN: ${e(snapshot.customerPan)}</p>` : '',
    snapshot.customerGstin ? `<p>GSTIN: ${e(snapshot.customerGstin)}</p>` : '',
    clientState ? `<p>State: ${e(clientState)}</p>` : '',
  ].filter(Boolean).join('\n');
  const details = [supply ? `<p>Place of supply: ${e(supply)}</p>` : '', snapshot.venue ? `<p>Venue: ${e(snapshot.venue)}</p>` : ''].filter(Boolean).join('\n');
  return `<section class="parties"><div>\n${billTo}\n</div><div>\n${details}\n</div></section>`;
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

const PAYMENT_STYLES = `
.payment { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 12px; break-inside: avoid; }
.payment .bank { flex: 1; min-width: 0; }
.upi-slot { width: 84px; height: 84px; margin-left: auto; border: 1px dashed #66757f; display: flex; align-items: center; justify-content: center; text-align: center; color: #66757f; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }
`;
const TERMS_STYLES = `
.terms { margin-top: 12px; break-inside: avoid; }
`;

function paymentHtml(format: FormatDefinition): string {
  const bank = format.blocks.bankDetails && format.bankDetails ? `<div class="bank"><h3>Bank details</h3><p class="multiline">${e(format.bankDetails)}</p></div>` : '';
  const upi = format.blocks.upiQr ? `<div class="upi-slot"><span>UPI QR</span></div>` : '';
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
