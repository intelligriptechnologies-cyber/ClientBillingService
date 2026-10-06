import { expect, test } from '@playwright/test';

test('a tenant records a partial payment and an auditable demo-only reminder', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Payments' }).click();
  await expect(page.getByRole('heading', { name: 'Pending payments' })).toBeVisible();
  await page.getByLabel('Payment amount').fill('100');
  await page.getByLabel('TDS amount').fill('10');
  await page.getByLabel('Payment reference').fill('UTR-2042');
  await page.getByRole('button', { name: 'Record allocation' }).click();
  await expect(page.getByText(/Payment allocation of/)).toBeVisible();
  await page.getByRole('button', { name: 'Email reminder' }).first().click();
  await expect(page.getByText(/no external message was sent/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download register' }).click();
  await expect((await download).suggestedFilename()).toBe('payment-register.csv');
});
