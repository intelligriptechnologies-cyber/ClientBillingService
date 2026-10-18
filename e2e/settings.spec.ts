import { clickMenuLink } from './navigation';
import { expect, test } from '@playwright/test';

async function enterNexioAdmin(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await clickMenuLink(page, 'Admin Console', 'Company Settings');
  await page.waitForURL('**/settings');
  await expect(page.getByRole('heading', { name: 'Tenant settings' })).toBeVisible();
}

test('an admin can preview templates, test SMTP locally, and download tenant logs', async ({ page }) => {
  await enterNexioAdmin(page);

  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'Edit settings' }).click();
  await page.getByRole('button', { name: 'Preview template' }).click();
  await expect(page.getByRole('status')).toContainText('Preview');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByRole('button', { name: 'Edit settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit email settings' });
  await dialog.getByRole('button', { name: 'Test SMTP configuration' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Email is not set up');
  await dialog.getByLabel('SMTP host').fill('smtp.nexio.test');
  await dialog.getByLabel('From address').fill('billing@nexio.test');
  await dialog.getByLabel('SMTP password').fill('typed-secret');
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');

  await page.getByRole('button', { name: 'Edit settings' }).click();
  await expect(dialog.getByLabel('SMTP password')).toHaveValue('');
  await expect(dialog.getByLabel('SMTP password')).toHaveAttribute('placeholder', /Saved/);
  await dialog.getByRole('button', { name: 'Test SMTP configuration' }).click();
  await expect(page.getByRole('status')).toContainText('SMTP test passed. The capture transport is active');

  await dialog.getByLabel('SMTP host').fill('');
  await dialog.getByLabel('From address').fill('');
  await dialog.getByLabel('Remove the saved password when I save').check();
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');

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
