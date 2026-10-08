import { clickMenuLink } from './navigation';
import { expect, test } from '@playwright/test';

test('a tenant records a partial payment and an auditable demo-only reminder', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await clickMenuLink(page, 'Billing', 'Payments');
  await expect(page.getByRole('heading', { name: 'Pending payments' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Payment register' })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment', exact: true }).first().click();
  await page.getByLabel('Payment amount').fill('100');
  await page.getByLabel('TDS amount').fill('10');
  await page.getByLabel('Payment reference').fill('UTR-2042');
  await page.getByRole('button', { name: 'Record allocation' }).click();
  await expect(page.getByText(/Payment allocation of/)).toBeVisible();
  await clickMenuLink(page, 'Reports', 'Pending Payments');
  await expect(page.getByRole('heading', { name: 'Pending payments' })).toBeVisible();
  await page.getByRole('button', { name: 'Email reminder' }).first().click();
  await expect(page.getByText(/no external message was sent/)).toBeVisible();
  await page.getByRole('button', { name: 'Close invoice' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close invoice' }).click();
  await expect(page.getByText(/Invoice closed and write-off recorded/)).toBeVisible();
  await clickMenuLink(page, 'Billing', 'Payments');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download register' }).click();
  await expect((await download).suggestedFilename()).toBe('payment-register.csv');
});
