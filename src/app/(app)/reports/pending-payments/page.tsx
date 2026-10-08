import { redirect } from 'next/navigation';
import PaymentsWorkspace from '@/components/payments-workspace';
import { getCurrentSession } from '@/lib/session';

export default async function PendingPaymentsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (!session.tenantId) redirect('/dashboard');
  return <PaymentsWorkspace pendingOnly />;
}
