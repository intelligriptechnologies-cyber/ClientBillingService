import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) { const session = await getCurrentSession(); if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); try { const body = await request.json(); const { invoiceId } = await params; return NextResponse.json(getTenantStore().recordPaymentReminder(session, invoiceId, { channel: body.channel, note: String(body.note ?? '') })); } catch (cause) { return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to prepare reminder.' }, { status: 400 }); } }
