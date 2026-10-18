import { NextResponse } from 'next/server';
import { MailServiceError, sendInvoiceEmail } from '@/lib/mail-service';
import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

const statusFor = { sent: 200, 'not-configured': 409, failed: 502 } as const;

export async function POST(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const text = await request.text(); let body: unknown = {};
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { return NextResponse.json({ message: 'Invalid request.' }, { status: 400 }); }
  }
  try {
    const result = await sendInvoiceEmail(getTenantStore(), session, (await context.params).invoiceId, body);
    return NextResponse.json({ status: result.status, message: result.message, delivery: result.delivery }, { status: statusFor[result.status] });
  } catch (cause) {
    if (cause instanceof MailServiceError) return NextResponse.json({ message: cause.message }, { status: cause.status });
    recordOperationException(session, '/api/invoices/[invoiceId]/send', cause);
    return NextResponse.json({ message: 'Unable to send the invoice by email.' }, { status: 400 });
  }
}
