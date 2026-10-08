import { expect, test } from '@playwright/test';

test('lets a reviewer enter a tenant-scoped session through soft login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a demo identity' })).toBeVisible();
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Enter demo' }).click()]);

  await expect(page.getByRole('heading', { name: 'Nexio Hyper dashboard' })).toBeVisible();
  await expect(page.getByText('Admin@nexio.com', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin Console' })).toBeVisible();
});

test('keeps superadmin navigation separate from tenant navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('superadmin');
  await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Enter demo' }).click()]);

  await expect(page.getByRole('heading', { name: 'Platform dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
});
