import { expect, test } from '@playwright/test';

test('a failed tenant operation appears in the downloadable Logs screen', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.waitForURL('**/dashboard');

  const failed = await page.request.post('/api/customers', { data: { companyName: '' } });
  expect(failed.status()).toBe(400);
  const response = await page.request.get('/api/logs');
  expect(response.ok()).toBe(true);
  const { logs } = await response.json() as { logs: Array<{ kind: string; message: string }> };
  expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'error', message: expect.stringContaining('/api/customers') })]));

  await page.goto('/logs');
  await expect(page.getByRole('heading', { name: 'Error logs' })).toBeVisible();
  await expect(page.getByText('/api/customers', { exact: false }).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all logs' }).click();
  await expect((await download).suggestedFilename()).toBe('operational-logs.txt');
});
