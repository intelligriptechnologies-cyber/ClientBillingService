import { clickMenuLink } from './navigation';
import { expect, test } from '@playwright/test';

test('a tenant can filter, inspect, and download its issued invoice', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await clickMenuLink(page, 'Billing', 'Invoices');

  await expect(page.getByRole('heading', { name: 'Invoice register' })).toBeVisible();
  await page.getByLabel('Invoice month').selectOption('2026-10');
  await expect(page.getByText('NEX-2026-001')).toBeVisible();
  await page.getByRole('row', { name: /NEX-2026-001/ }).getByRole('link', { name: 'View' }).click();
  await expect(page.getByText('Commercial and branding details are preserved at issue.')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download invoice' }).click();
  await expect((await download).suggestedFilename()).toBe('NEX-2026-001.pdf');
});
