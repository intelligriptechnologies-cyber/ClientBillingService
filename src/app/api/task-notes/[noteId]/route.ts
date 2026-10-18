import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TaskNoteInput } from '@/lib/tenant-store';
import { recordOperationException } from '@/lib/operational-error';

type Context = { params: Promise<{ noteId: string }> };
export async function PUT(request: Request, context: Context) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().updateTaskNote(session, (await context.params).noteId, await request.json() as TaskNoteInput)); }
  catch (error) { await recordOperationException(session, '/api/task-notes/[noteId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update task note.' }, { status: 400 }); }
}
export async function DELETE(_request: Request, context: Context) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { await getTenantStore().deleteTaskNote(session, (await context.params).noteId); return new Response(null, { status: 204 }); }
  catch (error) { await recordOperationException(session, '/api/task-notes/[noteId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to delete task note.' }, { status: 400 }); }
}
