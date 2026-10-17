import { redirect } from 'next/navigation';
import { TenantManager } from '@/components/tenant-manager';
import { PageTitle } from '@/components/ui';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export default async function TenantsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role !== 'superadmin') redirect('/dashboard');
  const tenants = getTenantStore().listTenants(session, { page: 1, pageSize: 10 });
  return <section className="page"><PageTitle eyebrow="Platform administration" title="Tenants"><span className="subtle">Manage isolated billing workspaces</span></PageTitle><TenantManager initial={tenants}/></section>;
}
