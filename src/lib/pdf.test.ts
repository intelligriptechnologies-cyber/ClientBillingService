import { describe, expect, it } from 'vitest';
import { pdfDocument } from './pdf';

describe('pdfDocument', () => {
  it('returns a real PDF payload instead of HTML disguised as a download', () => {
    const payload = new TextDecoder().decode(pdfDocument('Invoice', ['Customer: Acme']));
    expect(payload.startsWith('%PDF-1.4')).toBe(true);
    expect(payload).toContain('%%EOF');
  });

  it('carries the persisted document branding with the generated artifact', () => {
    const payload = new TextDecoder().decode(pdfDocument('Invoice', ['Customer: Acme'], {
      logoDataUrl: 'data:image/png;base64,bG9nbw==',
      stampDataUrl: 'data:image/png;base64,c3RhbXA=',
      signatureDataUrl: 'data:image/png;base64,c2lnbmF0dXJl',
    }));
    expect(payload).toContain('ClientBillingAssets');
    expect(payload).toContain('data:image/png;base64,bG9nbw==');
  });
});
