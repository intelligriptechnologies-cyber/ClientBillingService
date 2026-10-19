import { ServiceCatalogue } from '@/components/service-catalogue';
import { memberPage } from '@/lib/auth/page-principal';

export default async function ServicesPage() {
  const member = await memberPage();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Tenant billing</p><h1>Services</h1><p className="subtle">Maintain billable services for {member.tenantName}.</p></div></header><ServiceCatalogue /></section>;
}
