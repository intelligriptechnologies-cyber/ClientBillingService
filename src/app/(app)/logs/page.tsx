import { OperationalLogsView } from '@/components/settings-console';
import { memberPage } from '@/lib/auth/page-principal';
import { getTenantStore } from '@/lib/tenant-store';

export default async function LogsPage() {
  const member = await memberPage({ admin: true });
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Admin Console</p><h1>Logs</h1></div></header><OperationalLogsView logs={await getTenantStore().listOperationalLogs(member.context)} /></section>;
}
