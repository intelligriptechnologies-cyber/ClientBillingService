'use client';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="page" role="alert"><p className="eyebrow">Billing workspace</p><h1>Unable to load this screen</h1><div className="panel"><p className="empty">Please try again. Your in-session billing data has not been changed.</p><button className="button button-primary" onClick={reset}>Try again</button></div></section>;
}
