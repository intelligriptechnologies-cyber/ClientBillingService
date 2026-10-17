// node control-billing.mjs run journeys/sign-out.mjs --as nexio-admin
// Opens the dashboard, chooses Sign out, then proves the session is gone: / shows the picker and /customers bounces back to /.
export default async function journey({ page, shot }) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  await shot('before-sign-out');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.getByRole('heading', { name: 'Choose a demo identity' }).waitFor();
  await page.goto('/customers');
  const bouncedTo = new URL(page.url()).pathname;
  await shot('after-sign-out');
  if (bouncedTo !== '/') throw new Error(`Signed-out visit to /customers stayed on ${bouncedTo}.`);
  return { signedOut: true, bouncedTo };
}
