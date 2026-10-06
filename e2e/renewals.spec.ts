import { expect, test } from '@playwright/test';

test('a tenant renews an expired contract and settles its security deposit', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Contracts' }).click();
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill('Closeout renewal demonstration');
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2025-01-01');
  await page.getByLabel('End date').fill('2026-01-01');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByLabel('Security deposit').fill('2500');
  await page.getByRole('checkbox', { name: /Managed billing service|Analytics|Service/ }).first().check();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await page.getByRole('link', { name: 'Renewals & deposits' }).click();
  await expect(page.getByText('Closeout renewal demonstration', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Renew' }).first().click();
  await page.getByLabel('New end date').fill('2027-01-01');
  await page.getByLabel('Renewal note').fill('Customer confirmed the renewal.');
  await page.getByRole('button', { name: 'Record renewal' }).click();
  await expect(page.getByText('2027-01-01', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settle' }).last().click();
  await page.getByLabel('Closeout note').fill('Returned during closeout.');
  await page.getByRole('button', { name: 'Record settlement' }).click();
  await expect(page.getByText('settled', { exact: true }).last()).toBeVisible();
});
