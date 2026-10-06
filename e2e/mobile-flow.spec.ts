import { expect, test } from '@playwright/test';

test('a tenant can complete an essential billing flow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice register' })).toBeVisible();
  await page.getByRole('link', { name: 'Payments' }).click();
  await expect(page.getByRole('heading', { name: 'Pending payments' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close invoice' }).first()).toBeVisible();
});
