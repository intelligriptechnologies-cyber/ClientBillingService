import { cookies } from 'next/headers';
import { isDemoMode } from './auth/demo-mode';
import { getTenantStore, type AppSession } from './tenant-store';

export const sessionCookie = 'client-billing-demo-session';

// Outside demo mode the cookie must carry no authority: its value is a raw user id.
// Authelia mode resolves memberships in ADR 0002 unit A7, so until then it has no tenant session.
export async function getCurrentSession(): Promise<AppSession | null> {
  if (!isDemoMode()) return null;
  const userId = (await cookies()).get(sessionCookie)?.value;
  return userId ? await getTenantStore().authenticate(userId) : null;
}
