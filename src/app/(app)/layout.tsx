import { AppShell, type ShellIdentity } from '@/components/app-shell';
import { currentTenants, signedInPage } from '@/lib/auth/page-principal';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await signedInPage();
  const identity: ShellIdentity = principal.kind === 'platform'
    ? { kind: 'platform', email: principal.viewer.email }
    : { kind: 'member', email: principal.viewer.email, role: principal.role, tenantId: principal.context.tenantId, tenants: await currentTenants() };
  return <AppShell identity={identity}>{children}</AppShell>;
}
