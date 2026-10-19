import { TenantUsers } from '@/components/tenant-users';
import { memberPage } from '@/lib/auth/page-principal';

export default async function UsersPage() {
  const member = await memberPage({ admin: true });
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Tenant administration</p><h1>Users</h1><p className="subtle">Manage access for {member.tenantName}.</p></div></header><TenantUsers /></section>;
}
