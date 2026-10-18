import { redirect } from 'next/navigation';
import { OperationalLogsView } from '@/components/settings-console';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

export default async function LogsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role !== 'admin') redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Admin Console</p><h1>Logs</h1></div></header><OperationalLogsView logs={await getTenantStore().listOperationalLogs(tenantContextOf(session))} /></section>;
}
