'use client';

import { useRouter } from 'next/navigation';
import { InvoiceRegister } from '@/components/invoice-register';

export default function BulkInvoicePage() {
  const router = useRouter();
  return <InvoiceRegister bulkOpen onCloseBulk={() => router.push('/invoices')} />;
}
