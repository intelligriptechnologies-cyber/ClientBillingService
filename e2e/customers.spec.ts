import { clickMenuLink } from './navigation';
import { expect, test } from '@playwright/test';

async function enterNexio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await clickMenuLink(page, 'Master Data', 'Customers');
}

test('a tenant can create, filter, edit, and deactivate its customer', async ({ page }) => {
  const shortAddress = '42 Orbit Road, Bengaluru';
  const longAddress = '42 Orbit Road, Bengaluru, Karnataka';
  await enterNexio(page);
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Company name').fill('Orbit Labs');
  await page.getByLabel('Contact name').fill('Riya Rao');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('riya@orbit.example');
  await page.getByLabel('Phone').fill('+91 98765 00000');
  await page.getByLabel('Billing address').fill(shortAddress);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByText('Orbit Labs', { exact: true })).toBeVisible();
  let customerRow = page.getByRole('row', { name: /Orbit Labs/ });
  await expect(customerRow.getByRole('cell').nth(0).locator('.subtle')).toHaveText(shortAddress);
  await expect(customerRow.getByRole('cell').nth(1).getByRole('link', { name: '+91 98765 00000' })).toHaveAttribute('href', 'tel:+91 98765 00000');
  await expect(customerRow.getByRole('cell').nth(1)).not.toContainText('riya@orbit.example');
  await page.getByLabel('Search customers').fill('Orbit');
  await expect(page.getByText('Orbit Labs', { exact: true })).toBeVisible();
  customerRow = page.getByRole('row', { name: /Orbit Labs/ });
  await customerRow.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('GSTIN').fill('29AAGCB7383J1Z4');
  await page.getByLabel('Billing address').fill(longAddress);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(customerRow.getByRole('cell').nth(0).locator('.subtle')).toHaveText(`${longAddress.slice(0, 30)}...`);
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
  await clickMenuLink(page, 'Master Data', 'Customers');
  await expect(page.getByText('Nexio Hyper Customer', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Evo Fitness Customer', { exact: true })).toBeVisible();
});
