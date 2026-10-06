import { expect, test } from '@playwright/test';

test('requires a demo identity before an operational route can be viewed', async ({ page }) => {
  await page.goto('/invoices/new');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Choose a demo identity' })).toBeVisible();
});

test('keeps the soft-login screen usable at a 360px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a demo identity' })).toBeVisible();
  await expect(page.getByLabel('Demo identity')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
