'use client';

import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { void fetch('/api/logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: error.message, stack: error.stack }) }).catch((cause) => console.error('Unable to report screen error', cause)); }, [error]);
  return <section className="page" role="alert"><p className="eyebrow">Billing workspace</p><h1>Unable to load this screen</h1><div className="panel"><p className="empty">Please try again. Your in-session billing data has not been changed.</p><button className="button button-primary" onClick={reset}>Try again</button></div></section>;
}
