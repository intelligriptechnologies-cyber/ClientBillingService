import { redirect } from 'next/navigation';
import { ServiceCatalogue } from '@/components/service-catalogue';
import { getCurrentSession } from '@/lib/session';

export default async function ServicesPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role === 'superadmin') redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Tenant billing</p><h1>Services</h1><p className="subtle">Maintain billable services for {session.tenantName}.</p></div></header><ServiceCatalogue /></section>;
}
