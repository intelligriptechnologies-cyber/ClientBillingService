import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type QuotationInput, type Quotation } from '@/lib/tenant-store';

export async function PATCH(request: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return Response.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const input = await request.json() as Partial<QuotationInput> & { status?: Quotation['status'] };
    const quotation = getTenantStore().updateQuotation(session, (await params).quotationId, input);
    return Response.json({ quotation });
  } catch (error) {
    recordOperationException(session, '/api/quotations/[quotationId]', error);
    return Response.json({ message: error instanceof Error ? error.message : 'Unable to update quotation.' }, { status: 400 });
  }
}
