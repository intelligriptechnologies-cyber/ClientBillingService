import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TenantPayment } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return Response.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const update = await request.json() as Pick<TenantPayment, 'method' | 'reference' | 'notes'>;
    return Response.json({ payment: await getTenantStore().updatePaymentDetails(tenantContextOf(principal), (await params).paymentId, update) });
  } catch (error) {
    await recordOperationException(principal, '/api/payments/[paymentId]', error);
    return Response.json({ message: error instanceof Error ? error.message : 'Unable to update payment details.' }, { status: 400 });
  }
}
