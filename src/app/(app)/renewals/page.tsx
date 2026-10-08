import { redirect } from 'next/navigation';
import { RenewalDepositRegister } from '@/components/renewal-deposit-register';
import { getCurrentSession } from '@/lib/session';

export default async function RenewalsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role === 'superadmin') redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Contract follow-up</p><h1>Renewal Tracker</h1><p className="subtle">Track expiring contracts and renewals for {session.tenantName}.</p></div></header><RenewalDepositRegister /></section>;
}
