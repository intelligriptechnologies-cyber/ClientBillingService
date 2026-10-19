import PaymentsWorkspace from '@/components/payments-workspace';
import { memberPage } from '@/lib/auth/page-principal';

export default async function PendingPaymentsPage() {
  await memberPage();
  return <PaymentsWorkspace pendingOnly />;
}
