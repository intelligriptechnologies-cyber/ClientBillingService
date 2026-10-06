import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default function globalSetup() {
  const databasePath = process.env.CLIENT_BILLING_DATABASE ?? resolve('.data', 'client-billing-e2e.sqlite');
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}
