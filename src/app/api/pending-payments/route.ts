import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from "@/lib/auth/session-context";

export async function GET() { const session = await getCurrentSession(); if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); try { return NextResponse.json(await getTenantStore().listPendingPayments(tenantContextOf(session))); } catch (cause) { await recordOperationException(session, '/api/pending-payments', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to load pending payments.' }, { status: 400 }); } }
