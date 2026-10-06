import { redirect } from 'next/navigation';
import { AdditionalServicesRegister } from '@/components/additional-services-register';
import { getCurrentSession } from '@/lib/session';

export default async function AdditionalServicesPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role === 'superadmin') redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Contract billing</p><h1>Additional services</h1><p className="subtle">Record dated, contract-scoped charges for inclusion in the correct billing period.</p></div></header><AdditionalServicesRegister /></section>;
}
