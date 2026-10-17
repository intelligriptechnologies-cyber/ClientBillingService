import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfUnavailableError, pdfResponse, renderHtmlToPdf } from './pdf-renderer';

afterEach(() => vi.unstubAllEnvs());

describe('pdf renderer without Chromium', () => {
  it('names the problem and the fix instead of failing opaquely', async () => {
    vi.stubEnv('CLIENT_BILLING_CHROMIUM_PATH', 'C:\\does-not-exist\\chrome.exe');
    const failure = await renderHtmlToPdf('<p>x</p>').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(PdfUnavailableError);
    expect((failure as Error).message).toMatch(/Chromium could not start/);
    expect((failure as Error).message).toMatch(/playwright install chromium/);
  });

  it('answers 503 so a download never looks like an empty file', async () => {
    vi.stubEnv('CLIENT_BILLING_CHROMIUM_PATH', 'C:\\does-not-exist\\chrome.exe');
    const response = await pdfResponse('x.pdf', '<p>x</p>');
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/PDF rendering is unavailable/);
  });
});
