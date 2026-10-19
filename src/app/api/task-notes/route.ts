import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TaskNoteInput } from '@/lib/tenant-store';
import { recordOperationException } from '@/lib/operational-error';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const query = new URL(request.url).searchParams;
  try { return NextResponse.json({ items: await getTenantStore().listTaskNotes(tenantContextOf(principal), { date: query.get('date') ?? undefined, customerId: query.get('customerId') ?? undefined }) }); }
  catch (error) { await recordOperationException(principal, '/api/task-notes', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load task notes.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().createTaskNote(tenantContextOf(principal), await request.json() as TaskNoteInput), { status: 201 }); }
  catch (error) { await recordOperationException(principal, '/api/task-notes', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to create task note.' }, { status: 400 }); }
}
