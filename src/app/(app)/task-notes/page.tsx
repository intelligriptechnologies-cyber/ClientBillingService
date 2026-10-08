import { redirect } from 'next/navigation';
import { TaskNotesRegister } from '@/components/task-notes-register';
import { getCurrentSession } from '@/lib/session';

export default async function TaskNotesPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/');
  if (!session.tenantId) redirect('/dashboard');
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Operational Records</p><h1>Task Notes</h1><p className="subtle">Dated customer notes for {session.tenantName}.</p></div></header><TaskNotesRegister /></section>;
}
