import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { getCurrentSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  return <AppShell session={session}>{children}</AppShell>;
}
