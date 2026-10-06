import { redirect } from 'next/navigation';
import { ContractRegister } from '@/components/contract-register';
import { getCurrentSession } from '@/lib/session';

export default async function ContractsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role === 'superadmin') redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Tenant billing</p><h1>Contracts</h1><p className="subtle">Manage recurring billing commitments, schedules, renewal terms, and security deposits for {session.tenantName}.</p></div></header><ContractRegister /></section>;
}
