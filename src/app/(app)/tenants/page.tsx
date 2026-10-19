import { TenantManager } from '@/components/tenant-manager';
import { PageTitle } from '@/components/ui';
import { platformPage } from '@/lib/auth/page-principal';
import { getTenantStore } from '@/lib/tenant-store';

export default async function TenantsPage() {
  const tenants = await getTenantStore().listTenants(await platformPage(), { page: 1, pageSize: 10 });
  return <section className="page"><PageTitle eyebrow="Platform administration" title="Tenants"><span className="subtle">Manage isolated billing workspaces</span></PageTitle><TenantManager initial={tenants}/></section>;
}
