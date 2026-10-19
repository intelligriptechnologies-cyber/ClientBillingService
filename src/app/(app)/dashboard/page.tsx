import { memberPage, signedInPage } from '@/lib/auth/page-principal';

export default async function DashboardPage() {
  const principal = await signedInPage();
  if (principal.kind === 'platform') return <section className="page"><p className="eyebrow">Multi-tenant billing demo</p><h1>Platform dashboard</h1><p className="subtle">Signed in as {principal.viewer.email}. Manage the tenant portfolio from this isolated platform view.</p><div className="panel foundation-panel"><h2>Tenant portfolio</h2><p>Create, rename, suspend and reactivate tenant workspaces from Tenants in the sidebar.</p></div></section>;
  const member = await memberPage();
  return <section className="page"><p className="eyebrow">{`${member.role} access`}</p><h1>{`${member.tenantName} dashboard`}</h1><p className="subtle">Signed in as {member.viewer.email}. Your workspace is scoped to this tenant.</p><div className="panel foundation-panel"><h2>Your billing workspace</h2><p>Use the menu to work with customers, contracts, invoices and payments.</p></div></section>;
}
