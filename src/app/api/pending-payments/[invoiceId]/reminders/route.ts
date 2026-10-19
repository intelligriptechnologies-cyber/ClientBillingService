import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { sendPaymentReminder } from '@/lib/mail-service';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';

/** The response is the recorded reminder plus `delivery` and `message`, which say whether anything was actually sent. */
export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json(); const { invoiceId } = await params;
    const result = await sendPaymentReminder(getTenantStore(), principal, invoiceId, { channel: body.channel, note: String(body.note ?? '') });
    return NextResponse.json({ ...result.reminder, delivery: result.status, message: result.message });
  } catch (cause) {
    await recordOperationException(principal, '/api/pending-payments/[invoiceId]/reminders', cause);
    return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to prepare reminder.' }, { status: 400 });
  }
}
