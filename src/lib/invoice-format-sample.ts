import type { SnapshotFormat } from './invoice-format';
import { calculateInvoiceLines } from './invoice-lines';
import type { TenantInvoice, TenantSettings } from './tenant-store';

type Branding = Pick<TenantSettings, 'companyName' | 'legalName' | 'gstin' | 'address' | 'footer' | 'logoDataUrl' | 'stampDataUrl' | 'signatureDataUrl'>;

const svg = (markup: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">${markup}</svg>`)}`;
/** Drawn in for any branding the tenant has not uploaded, so each switch in the preview has something to switch. */
const PLACEHOLDERS = {
  logo: svg('<rect x="2" y="2" width="116" height="56" rx="8" fill="#e6eceb" stroke="#9aa9a8"/><text x="60" y="37" font-family="Arial" font-size="18" text-anchor="middle" fill="#66757f">LOGO</text>'),
  stamp: svg('<circle cx="60" cy="30" r="27" fill="none" stroke="#9aa9a8" stroke-width="3"/><text x="60" y="35" font-family="Arial" font-size="13" text-anchor="middle" fill="#66757f">STAMP</text>'),
  signature: svg('<path d="M8 40 C 20 8, 30 8, 34 30 S 52 52, 62 24 S 86 14, 112 34" fill="none" stroke="#66757f" stroke-width="3" stroke-linecap="round"/>'),
};

const SAMPLE_GSTIN = '29AAGCB7383J1Z4';

/** A believable intra-state Tax Invoice built from the tenant's own branding, for previewing a format before any invoice uses it. */
export function sampleInvoice(branding: Branding, format: SnapshotFormat): TenantInvoice {
  const totals = calculateInvoiceLines([
    { description: 'Monthly accounting retainer', quantity: 1, rateMinor: 2_500_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998221' },
    { description: 'GST return filing', quantity: 3, rateMinor: 450_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998231' },
  ]);
  return {
    id: 'preview', tenantId: 'preview', contractId: null, customerId: 'preview', customerName: 'Acme Industries', invoiceNumber: 'INV-2026-0042', invoiceDate: '2026-11-02', dueDate: '2026-11-16',
    taxableMinor: totals.taxableMinor, gstRate: 18, gstMinor: totals.gstMinor, totalMinor: totals.totalMinor, paidMinor: 0, status: 'issued', issuedAt: '2026-11-02T09:00:00.000Z',
    snapshot: {
      companyName: branding.companyName, gstin: branding.gstin || SAMPLE_GSTIN, address: branding.address || 'Your registered address\nBengaluru, Karnataka',
      logoDataUrl: branding.logoDataUrl || PLACEHOLDERS.logo, stampDataUrl: branding.stampDataUrl || PLACEHOLDERS.stamp, signatureDataUrl: branding.signatureDataUrl || PLACEHOLDERS.signature,
      customerName: 'Acme Industries', customerEmail: 'accounts@acme.example', customerAddress: '12 Residency Road\nBengaluru, Karnataka', customerGstin: '29AAPFU0939F1ZV',
      gstRate: 18, footer: branding.footer || 'Thank you for your business.', documentType: 'Tax Invoice', sellerLegalName: branding.legalName || branding.companyName, sellerStateCode: '29', placeOfSupplyStateCode: '29', taxSplit: 'intra', hsnRequired: true,
      lines: totals.lines, notes: 'Sample data. Nothing here is an issued invoice.', format,
    },
  };
}
