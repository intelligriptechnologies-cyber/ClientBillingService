'use client';

import { reportClientError } from '@/lib/client-error';
import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error.message, error.stack); }, [error]);
  return <section className="page" role="alert"><p className="eyebrow">Billing workspace</p><h1>Unable to load this screen</h1><div className="panel"><p className="empty">Please try again. Your in-session billing data has not been changed.</p><button className="button button-primary" onClick={reset}>Try again</button></div></section>;
}
