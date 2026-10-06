import { redirect } from 'next/navigation';
import { TenantUsers } from '@/components/tenant-users';
import { getCurrentSession } from '@/lib/session';

export default async function UsersPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role !== 'admin') redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Tenant administration</p><h1>Users</h1><p className="subtle">Manage access for {session.tenantName}.</p></div></header><TenantUsers /></section>;
}
