import { getCurrentSession } from '@/lib/session';

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null;
  const isSuperadmin = session.role === 'superadmin';
  return <section className="page"><p className="eyebrow">{isSuperadmin ? 'Multi-tenant billing demo' : `${session.role} access`}</p><h1>{isSuperadmin ? 'Platform dashboard' : `${session.tenantName} dashboard`}</h1><p className="subtle">Signed in as {session.email}. {isSuperadmin ? 'Manage the tenant portfolio from this isolated platform view.' : 'Your workspace is scoped to this tenant.'}</p><div className="panel foundation-panel"><h2>{isSuperadmin ? 'Tenant portfolio' : 'Your billing workspace'}</h2><p>{isSuperadmin ? 'Create, rename, suspend and reactivate tenant workspaces from Tenants in the sidebar.' : 'Use the menu to work with customers, contracts, invoices and payments.'}</p></div></section>;
}
