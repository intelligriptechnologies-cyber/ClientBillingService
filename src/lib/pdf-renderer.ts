import { chromium, type Browser } from 'playwright-core';

/** Chromium could not start or did not answer in time. Callers answer 503 with this message. */
export class PdfUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'PdfUnavailableError'; }
}

const LAUNCH_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_PAGES = 2;

type RendererState = { browser: Promise<Browser> | null; active: number; waiting: Array<() => void> };
const globals = globalThis as typeof globalThis & { clientBillingPdfRenderer?: RendererState };
/** One Chromium per server process, kept across requests and across dev-server reloads. */
const state: RendererState = globals.clientBillingPdfRenderer ??= { browser: null, active: 0, waiting: [] };

function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.CLIENT_BILLING_CHROMIUM_PATH || undefined;
  const noSandbox = process.env.CLIENT_BILLING_CHROMIUM_NO_SANDBOX === '1';
  const launched = chromium.launch({ headless: true, executablePath, timeout: LAUNCH_TIMEOUT_MS, args: noSandbox ? ['--no-sandbox'] : [] }).then((browser) => {
    browser.on('disconnected', () => { if (state.browser === launched) state.browser = null; });
    return browser;
  }, (cause: unknown) => {
    state.browser = null;
    const reason = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
    throw new PdfUnavailableError(`PDF rendering is unavailable because Chromium could not start (${reason}). Install it with "npx playwright install chromium", or set CLIENT_BILLING_CHROMIUM_PATH to a Chromium executable.`);
  });
  return launched;
}

function getBrowser(): Promise<Browser> { return state.browser ??= launchBrowser(); }

async function withPageSlot<T>(task: () => Promise<T>): Promise<T> {
  if (state.active >= MAX_CONCURRENT_PAGES) await new Promise<void>((resolve) => state.waiting.push(resolve));
  else state.active += 1;
  try { return await task(); }
  finally { const next = state.waiting.shift(); if (next) next(); else state.active -= 1; }
}

async function resetBrowser(): Promise<void> {
  const stuck = state.browser;
  state.browser = null;
  await stuck?.then((browser) => browser.close(), () => undefined).catch(() => undefined);
}

async function printToPdf(html: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally { await context.close().catch(() => undefined); }
}

/** Prints standalone HTML to an A4 PDF. At most two pages render at once, and a hung Chromium is replaced. */
export function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  return withPageSlot(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PdfUnavailableError('PDF rendering timed out. Try again in a moment.')), RENDER_TIMEOUT_MS + 5_000); });
    try { return await Promise.race([printToPdf(html), deadline]); }
    catch (cause) {
      if (cause instanceof PdfUnavailableError) { await resetBrowser(); throw cause; }
      throw new PdfUnavailableError(`PDF rendering failed (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}).`);
    } finally { clearTimeout(timer); }
  });
}

export async function pdfResponse(filename: string, html: string): Promise<Response> {
  try {
    const pdf = await renderHtmlToPdf(html);
    return new Response(pdf as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof PdfUnavailableError) return new Response(cause.message, { status: 503 });
    throw cause;
  }
}
