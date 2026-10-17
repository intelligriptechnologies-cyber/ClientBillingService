'use client';

import { apiFetch } from '@/lib/api-client';
import { useEffect, useState } from 'react';
import { reportClientException } from '@/lib/client-error';
import { useRouter } from 'next/navigation';
import type { DemoIdentity } from '@/lib/tenant-store';

export function DemoLogin() {
  const router = useRouter();
  const [identities, setIdentities] = useState<DemoIdentity[]>([]);
  const [userId, setUserId] = useState('superadmin');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { apiFetch('/api/auth/identities').then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Unable to load demo identities.'))).then(({ identities }) => { setIdentities(identities); setLoading(false); }).catch((cause) => { reportClientException('Load demo identities', cause); setError('Demo identities could not be loaded.'); setLoading(false); }); }, []);
  async function enterDemo() { setError(null); const response = await apiFetch('/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) }); if (!response.ok) { const body = await response.json(); setError(body.message); return; } router.replace('/dashboard'); router.refresh(); }
  return <main className="login-page"><section className="login-card"><p className="eyebrow">Client Billing Service</p><h1>Choose a demo identity</h1><p className="subtle">Soft login is local to this demo. No external account is required.</p><label className="field" htmlFor="demo-identity"><span>Demo identity</span><select id="demo-identity" className="input" aria-label="Demo identity" value={userId} disabled={loading} onChange={(event) => setUserId(event.target.value)}>{identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.role === 'superadmin' ? `${identity.name} — Superadmin` : `${identity.tenantName} — ${identity.email} (${identity.role})`}</option>)}</select></label><p className="hint">All seeded passwords are <code>admin123</code>; selection is intentionally sufficient for demo access.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="button" disabled={loading} onClick={enterDemo}>Enter demo</button></section></main>;
}
