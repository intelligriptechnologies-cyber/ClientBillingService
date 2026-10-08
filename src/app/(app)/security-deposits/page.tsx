import { redirect } from 'next/navigation';
import { RenewalDepositRegister } from '@/components/renewal-deposit-register';
import { getCurrentSession } from '@/lib/session';

export default async function SecurityDepositsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (!session.tenantId) redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Billing</p><h1>Security Deposits</h1><p className="subtle">Review and settle contract deposits for {session.tenantName}.</p></div></header><RenewalDepositRegister depositsOnly /></section>;
}
