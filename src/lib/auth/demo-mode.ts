import { readAuthConfig } from './config';

/** False in authelia mode, and also when the config is refused, so a bad config never falls back to demo. */
export function isDemoMode(): boolean {
  const result = readAuthConfig();
  return result.ok && result.config.mode === 'demo';
}

/** Demo-only handlers return this instead of running, so the raw-user-id sign-in never exists outside demo mode. */
export function notFoundUnlessDemo(): Response | null {
  return isDemoMode() ? null : Response.json({ message: 'Not found.' }, { status: 404 });
}
