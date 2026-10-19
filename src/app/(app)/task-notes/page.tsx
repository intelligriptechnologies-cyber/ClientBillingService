import { TaskNotesRegister } from '@/components/task-notes-register';
import { memberPage } from '@/lib/auth/page-principal';

export default async function TaskNotesPage() {
  const member = await memberPage();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Operational Records</p><h1>Task Notes</h1><p className="subtle">Dated customer notes for {member.tenantName}.</p></div></header><TaskNotesRegister /></section>;
}
