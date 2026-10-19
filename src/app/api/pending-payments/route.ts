import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) { const principal = await getPrincipal(request); if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); try { return NextResponse.json(await getTenantStore().listPendingPayments(tenantContextOf(principal))); } catch (cause) { await recordOperationException(principal, '/api/pending-payments', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to load pending payments.' }, { status: 400 }); } }
