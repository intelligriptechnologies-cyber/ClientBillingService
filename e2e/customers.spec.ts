import { expect, test } from '@playwright/test';

async function enterNexio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Customers' }).click();
}

test('a tenant can create, filter, edit, and deactivate its customer', async ({ page }) => {
  await enterNexio(page);
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Company name').fill('Orbit Labs');
  await page.getByLabel('Contact name').fill('Riya Rao');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('riya@orbit.example');
  await page.getByLabel('Phone').fill('+91 98765 00000');
  await page.getByLabel('Billing address').fill('42 Orbit Road, Bengaluru');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByText('Orbit Labs', { exact: true })).toBeVisible();
  await page.getByLabel('Search customers').fill('Orbit');
  await expect(page.getByText('Orbit Labs', { exact: true })).toBeVisible();
  await page.getByRole('row', { name: /Orbit Labs/ }).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('GSTIN').fill('29ABCDE1234F1Z5');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByLabel('Set Orbit Labs inactive')).toBeVisible();
  await page.getByLabel('Set Orbit Labs inactive').click();
  await expect(page.getByText('Orbit Labs is now inactive.')).toBeVisible();
});

test('customers cannot leak across tenant sessions', async ({ page }) => {
  await enterNexio(page);
  await expect(page.getByText('Nexio Hyper Customer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Demo identity').selectOption('evo-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page.getByText('Nexio Hyper Customer', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Evo Fitness Customer', { exact: true })).toBeVisible();
});
