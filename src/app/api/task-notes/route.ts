import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TaskNoteInput } from '@/lib/tenant-store';
import { recordOperationException } from '@/lib/operational-error';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const query = new URL(request.url).searchParams;
  try { return NextResponse.json({ items: getTenantStore().listTaskNotes(session, { date: query.get('date') ?? undefined, customerId: query.get('customerId') ?? undefined }) }); }
  catch (error) { recordOperationException(session, '/api/task-notes', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load task notes.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(getTenantStore().createTaskNote(session, await request.json() as TaskNoteInput), { status: 201 }); }
  catch (error) { recordOperationException(session, '/api/task-notes', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to create task note.' }, { status: 400 }); }
}
