import { expect, test } from '@playwright/test';

async function enterNexio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Contracts' }).click();
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill('Additional services contract');
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2026-01-01');
  await page.getByLabel('End date').fill('2026-12-31');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByRole('group', { name: 'Services' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await page.getByRole('link', { name: 'Additional services' }).click();
}

test('a tenant user records an additional service against the selected customer contract', async ({ page }) => {
  await enterNexio(page);
  await page.getByRole('button', { name: 'Add additional service' }).click();
  await expect(page.getByLabel('Additional service customer', { exact: true })).toBeVisible();
  await page.getByLabel('Additional service customer', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Additional service contract', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Additional service date').fill('2026-10-15');
  await page.getByLabel('Customized price').fill('2500');
  await page.getByLabel('Service description').fill('October on-site workshop');
  await page.getByRole('button', { name: 'Add additional service' }).last().click();
  await expect(page.getByText('October on-site workshop', { exact: true })).toBeVisible();
  await expect(page.getByText('₹2,500.00', { exact: true })).toBeVisible();
});
