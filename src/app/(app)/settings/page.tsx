import { redirect } from 'next/navigation';
import SettingsConsole from '@/components/settings-console';
import { getCurrentSession } from '@/lib/session';

export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (session.role !== 'admin') redirect('/dashboard');
  return <SettingsConsole />;
}
