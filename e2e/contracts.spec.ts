import { expect, test } from '@playwright/test';

async function enterNexio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Contracts' }).click();
}

test('a tenant creates a quarterly contract and its schedule is visible', async ({ page }) => {
  await enterNexio(page);
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill('Quarterly reporting');
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2026-04-01');
  await page.getByLabel('End date').fill('2027-03-31');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await page.getByText('Jan', { exact: true }).click();
  await page.getByText('Apr', { exact: true }).click();
  await page.getByText('Jul', { exact: true }).click();
  await page.getByLabel('Security deposit').fill('2500');
  await page.getByRole('checkbox', { name: /Seeded service|Analytics|Service/ }).first().check();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByText('Quarterly reporting', { exact: true })).toBeVisible();
  await expect(page.getByText(/months 1, 4, 7/)).toBeVisible();
});

test('quarterly contracts require exactly three invoice months', async ({ page }) => {
  await enterNexio(page);
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill('Invalid quarterly contract');
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2026-04-01');
  await page.getByLabel('End date').fill('2027-03-31');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await page.getByText('Jan', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Seeded service|Analytics|Service/ }).first().check();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByText('Quarterly contracts require 3 invoice months.')).toBeVisible();
});
