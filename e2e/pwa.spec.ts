import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const css = readFileSync('src/app/globals.css', 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1].toLowerCase();

test('manifest describes an installable standalone app', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = await response.json();

  expect(manifest).toMatchObject({
    name: expect.any(String),
    short_name: expect.any(String),
    start_url: '/',
    display: 'standalone',
    theme_color: token('accent'),
    background_color: token('canvas'),
  });
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);

  const icons: { src: string; sizes: string; type: string; purpose?: string }[] = manifest.icons;
  expect(icons.map((icon) => `${icon.sizes}:${icon.purpose ?? 'any'}`).sort()).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
  for (const icon of icons) {
    expect(icon.type).toBe('image/png');
    const image = await request.get(icon.src);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()['content-type'], icon.src).toContain('image/png');
  }
});

test('root layout links the theme color and apple touch icon', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', token('accent')!);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(href).toBeTruthy();
  const icon = await request.get(href!);
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/png');
});
