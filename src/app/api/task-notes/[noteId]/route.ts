import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TaskNoteInput } from '@/lib/tenant-store';
import { recordOperationException } from '@/lib/operational-error';
import { tenantContextOf } from '@/lib/auth/principal';

type Context = { params: Promise<{ noteId: string }> };
export async function PUT(request: Request, context: Context) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().updateTaskNote(tenantContextOf(principal), (await context.params).noteId, await request.json() as TaskNoteInput)); }
  catch (error) { await recordOperationException(principal, '/api/task-notes/[noteId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update task note.' }, { status: 400 }); }
}
export async function DELETE(_request: Request, context: Context) {
  const principal = await getPrincipal(_request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { await getTenantStore().deleteTaskNote(tenantContextOf(principal), (await context.params).noteId); return new Response(null, { status: 204 }); }
  catch (error) { await recordOperationException(principal, '/api/task-notes/[noteId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to delete task note.' }, { status: 400 }); }
}
