import { cookies } from 'next/headers';
import { getTenantStore, type AppSession } from './tenant-store';

export const sessionCookie = 'client-billing-demo-session';

export async function getCurrentSession(): Promise<AppSession | null> {
  const userId = (await cookies()).get(sessionCookie)?.value;
  return userId ? getTenantStore().authenticate(userId) : null;
}
