import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { MailServiceError, testSmtp } from '@/lib/mail-service';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';

const statusFor = { verified: 200, 'not-configured': 409, failed: 502 } as const;

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to test SMTP.' }, { status: 401 });
  try {
    const result = await testSmtp(getTenantStore(), principal);
    return NextResponse.json({ status: result.status, message: result.message }, { status: statusFor[result.status] });
  } catch (error) {
    if (error instanceof MailServiceError) return NextResponse.json({ message: error.message }, { status: error.status });
    await recordOperationException(principal, '/api/settings/smtp-test', error);
    return NextResponse.json({ message: 'Unable to test SMTP.' }, { status: 403 });
  }
}
