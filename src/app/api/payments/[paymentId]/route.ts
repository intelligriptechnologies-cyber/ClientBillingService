import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TenantPayment } from '@/lib/tenant-store';
import { tenantContextOf } from "@/lib/auth/session-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return Response.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const update = await request.json() as Pick<TenantPayment, 'method' | 'reference' | 'notes'>;
    return Response.json({ payment: await getTenantStore().updatePaymentDetails(tenantContextOf(session), (await params).paymentId, update) });
  } catch (error) {
    await recordOperationException(session, '/api/payments/[paymentId]', error);
    return Response.json({ message: error instanceof Error ? error.message : 'Unable to update payment details.' }, { status: 400 });
  }
}
