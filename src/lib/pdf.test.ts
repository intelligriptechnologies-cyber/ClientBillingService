import { describe, expect, it } from 'vitest';
import { pdfDocument } from './pdf';

describe('pdfDocument', () => {
  it('returns a real PDF payload instead of HTML disguised as a download', () => {
    const payload = new TextDecoder().decode(pdfDocument('Invoice', ['Customer: Acme']));
    expect(payload.startsWith('%PDF-1.4')).toBe(true);
    expect(payload).toContain('%%EOF');
  });
});
