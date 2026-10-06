import { expect, test } from '@playwright/test';

test('a tenant can filter GST sales and download tenant-context exports', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByRole('link', { name: 'Open report' }).click();

  await expect(page.getByRole('heading', { name: 'GST invoice register' })).toBeVisible();
  await page.getByLabel('GST report month').fill('2026-10');
  await expect(page.getByText('NEX-2026-001')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Taxable value' }).getByRole('strong')).toHaveText(/₹[\d,]+\.\d{2}/);
  const csv = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download spreadsheet' }).click();
  await expect((await csv).suggestedFilename()).toBe('gst-sales-2026-10.csv');
  const pdf = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF report' }).click();
  await expect((await pdf).suggestedFilename()).toBe('gst-sales-2026-10.pdf');
});
