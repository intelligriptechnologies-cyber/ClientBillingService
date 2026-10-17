import { documentShell, escapeHtml as e, imageHtml } from './document-html';
import { formatMoney } from './format';
import type { BulkInvoicePreview, TenantSettings } from './tenant-store';

type Branding = Pick<TenantSettings, 'companyName' | 'logoDataUrl'>;

/** The monthly bulk run as the dialog lists it: what would be issued, then what is skipped and why. */
export function renderBulkPreviewHtml(preview: BulkInvoicePreview, branding: Branding): string {
  const proposed = preview.proposed.map((item) => `<tr><td>${e(item.customerName)}</td><td>${e(item.contractName)}</td><td class="num">${e(formatMoney(item.taxableMinor))}</td><td class="num">${e(formatMoney(item.gstMinor))}</td><td class="num">${e(formatMoney(item.totalMinor))}</td></tr>`).join('\n');
  const skipped = preview.skipped.map((item) => `<tr><td>${e(item.customerName)}</td><td>${e(item.contractName)}</td><td>${e(item.reason)}</td></tr>`).join('\n');
  const total = preview.proposed.reduce((sum, item) => sum + item.totalMinor, 0);
  const body = [
    `<header class="masthead"><div class="seller">${imageHtml(branding.logoDataUrl, 'Logo', 'logo')}<h2 class="company">${e(branding.companyName)}</h2></div><div class="doc"><h1>Bulk invoice preview</h1><dl><dt>Billing period</dt><dd>${e(preview.billingPeriod)}</dd></dl></div></header>`,
    `<h3 style="margin-top:14px">Proposed invoices (${preview.proposed.length})</h3>`,
    preview.proposed.length ? `<table class="lines"><thead><tr><th>Customer</th><th>Contract</th><th class="num">Taxable value</th><th class="num">GST</th><th class="num">Total</th></tr></thead>\n<tbody>\n${proposed}\n</tbody></table>\n<p style="margin-top:8px;text-align:right;font-weight:700">Proposed total ${e(formatMoney(total))}</p>` : '<p class="muted">Nothing to issue for this period.</p>',
    `<h3 style="margin-top:14px">Skipped (${preview.skipped.length})</h3>`,
    preview.skipped.length ? `<table class="lines"><thead><tr><th>Customer</th><th>Contract</th><th>Reason</th></tr></thead>\n<tbody>\n${skipped}\n</tbody></table>` : '<p class="muted">No contracts were skipped.</p>',
  ].join('\n');
  return documentShell(`Bulk invoice preview ${preview.billingPeriod}`, body);
}
