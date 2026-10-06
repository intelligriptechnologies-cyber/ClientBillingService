import { expect, test } from '@playwright/test';

async function enterNexioAdmin(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.waitForURL('**/settings');
  await expect(page.getByRole('heading', { name: 'Tenant settings' })).toBeVisible();
}

test('an admin can preview templates, test SMTP locally, and download tenant logs', async ({ page }) => {
  await enterNexioAdmin(page);

  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'Preview template' }).click();
  await expect(page.getByRole('status')).toContainText('Preview');

  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByRole('button', { name: 'Test SMTP configuration' }).click();
  await expect(page.getByRole('status')).toContainText('no external email was sent');

  await page.getByRole('tab', { name: 'Operational logs' }).click();
  await expect(page.getByRole('heading', { name: 'Feature-flow logs' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all logs' }).click();
  await expect((await download).suggestedFilename()).toBe('operational-logs.txt');
});

test('a tenant user cannot enter the settings workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-user');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.goto('/settings');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
});
