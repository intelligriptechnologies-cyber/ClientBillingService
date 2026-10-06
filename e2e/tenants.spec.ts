import { expect, test } from '@playwright/test';

test('superadmin can create, filter, and disable a tenant', async ({ page }) => {
  const tenantName = `Northstar ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('superadmin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Tenants' }).click();

  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await page.getByLabel('Tenant name').fill(tenantName);
  await page.getByRole('button', { name: 'Create tenant' }).last().click();
  await expect(page.getByRole('cell', { name: new RegExp(tenantName) })).toBeVisible();

  await page.getByLabel('Search tenants').fill(tenantName);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('cell', { name: new RegExp(tenantName) })).toBeVisible();
  await page.getByRole('row', { name: new RegExp(tenantName) }).getByRole('button', { name: 'Disable' }).click();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/tenants/') && response.request().method() === 'PATCH'),
    page.getByRole('button', { name: 'Disable tenant' }).click(),
  ]);
  await expect(page.getByRole('row', { name: new RegExp(tenantName) }).getByText('disabled')).toBeVisible();
});

test('tenant admin cannot access platform tenant lifecycle management', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.goto('/tenants');
  await expect(page).toHaveURL(/\/dashboard$/);
});
