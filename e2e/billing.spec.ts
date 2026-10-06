import { expect, test } from '@playwright/test';

test('creates, edits, reviews, and issues a draft invoice', async ({ page }) => {
  await page.goto('/invoices/new');
  await page.getByLabel('Client').selectOption('c1');
  await page.getByLabel('Line description').fill('E2E design review');
  await page.getByLabel('Line unit price').fill('125.00');
  await expect(page.getByText('₹125.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.getByRole('link', { name: 'Draft' }).last().click();
  await page.getByRole('link', { name: 'Edit draft' }).click();
  await page.getByLabel('Line description').fill('Edited E2E design review');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Edited E2E design review')).toBeVisible();
  await page.getByRole('link', { name: 'Review & issue' }).click();
  await expect(page.getByRole('heading', { name: 'Issue invoice' })).toBeVisible();
  await expect(page.getByText('Line-item total')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and issue' }).click();
  await expect(page.getByText('Draft invoice')).not.toBeVisible();
});

test('shows client payment history and keyboard-labelled filters', async ({ page }) => {
  await page.goto('/clients/c2');
  await expect(page.getByRole('heading', { name: 'Payment history' })).toBeVisible();
  await expect(page.getByText('bank transfer')).toBeVisible();
  await page.goto('/invoices');
  await expect(page.getByLabel('Search invoices')).toBeVisible();
});

test('keeps the draft form within a 360px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/invoices/new');
  await expect(page.getByRole('heading', { name: 'Create draft' })).toBeVisible();
  await expect(page.getByLabel('Client')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
