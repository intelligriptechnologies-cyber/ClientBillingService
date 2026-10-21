'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function PasswordLogin() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      // eslint-disable-next-line no-restricted-globals -- A rejected login must show its error, not trigger apiFetch's expired-session reload.
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
      if (!response.ok) { setError((await response.json()).message ?? 'Unable to sign in.'); return; }
      router.replace('/dashboard');
      router.refresh();
    } catch { setError('Unable to sign in. Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-card"><p className="eyebrow">Client Billing Service</p><h1>Sign in</h1><form onSubmit={submit}><label className="field"><span>Username</span><input className="input" name="username" autoComplete="username" required maxLength={64} /></label><label className="field"><span>Password</span><input className="input" name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></section></main>;
}
