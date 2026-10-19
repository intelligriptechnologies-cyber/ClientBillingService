'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import type { TenantName } from '@/lib/tenant-store';

/** Sets the tenant cookie. The server accepts only a tenant the person has an active row in. */
export function selectTenant(tenantId: string) {
  return apiFetch('/api/auth/select-tenant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId }) });
}

export function TenantChooser({ tenants }: { tenants: TenantName[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function choose(tenantId: string) {
    setPending(true); setError(null);
    const response = await selectTenant(tenantId);
    if (!response.ok) { setError('That tenant could not be opened. Choose another, or reload the page.'); setPending(false); return; }
    router.replace('/dashboard'); router.refresh();
  }
  return <div className="tenant-choices">{tenants.map((tenant) => <button key={tenant.id} className="button button-secondary" type="button" disabled={pending} onClick={() => choose(tenant.id)}>{tenant.name}</button>)}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
