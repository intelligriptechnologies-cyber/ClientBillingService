import { expect, test } from '@playwright/test';

test('a tenant user can save a frequency-priced service and download its quotation', async ({ page }) => {
  const serviceName = `E2E service ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Services' }).click();

  await page.getByRole('button', { name: 'Add service' }).click();
  await page.getByLabel('Service name').fill(serviceName);
  await page.getByLabel('Monthly price (₹)').fill('1500');
  await page.getByRole('button', { name: 'Save service' }).click();
  await expect(page.getByText(serviceName, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'New quotation' }).click();
  await page.getByLabel('Customer name').fill('E2E customer');
  await page.getByRole('button', { name: 'Save quotation' }).click();
  await expect(page.getByText('E2E customer', { exact: true })).toBeVisible();
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download' }).click()]);
  expect(download[0].suggestedFilename()).toMatch(/^Q-NEXIO-\d+\.html$/);
});
