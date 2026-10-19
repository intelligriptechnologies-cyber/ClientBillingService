import { redirect } from 'next/navigation';
import { TenantChooser } from '@/components/tenant-chooser';
import { currentPrincipal, currentTenants } from '@/lib/auth/page-principal';

/** Outside the (app) layout, which sends a person who has not chosen a tenant here. */
export default async function SelectTenantPage() {
  const principal = await currentPrincipal();
  if (!principal || principal.kind === 'noAccess') redirect('/');
  if (principal.kind === 'platform') redirect('/dashboard');
  return <main className="login-page"><section className="login-card"><p className="eyebrow">Client Billing Service</p><h1>Choose a tenant</h1><p className="subtle">Signed in as {principal.viewer.email}. Your account works in more than one tenant. Pick the one to open.</p><TenantChooser tenants={await currentTenants()} /></section></main>;
}
