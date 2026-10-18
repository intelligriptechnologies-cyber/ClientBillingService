// One source for the ports and secrets that playwright.config.ts and the specs both need.
// Never port 3000: a developer's own dev server owns it.
export const demoPort = Number(process.env.CLIENT_BILLING_TEST_PORT) || 3100;
export const autheliaPort = demoPort + 1;
export const bootRefusalPort = demoPort + 2;

export const demoOrigin = `http://localhost:${demoPort}`;
export const autheliaOrigin = `http://localhost:${autheliaPort}`;

export const proxySecret = 'e2e-proxy-secret-e2e-proxy-secret-0123';
export const memberGroup = 'cbs-users';
export const superadminGroup = 'cbs-superadmin';
