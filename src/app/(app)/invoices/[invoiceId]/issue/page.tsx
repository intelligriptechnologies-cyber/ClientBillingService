'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PageTitle } from '@/components/ui';
import { useBilling } from '@/state/billing-store';
import { formatDate, formatMoney } from '@/lib/format';

export default function IssueInvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const router = useRouter();
  const { invoices, clients, role, settings, issueInvoice } = useBilling();
  const invoice = invoices.find((item) => item.id === invoiceId);
  if (!invoice || invoice.status !== 'draft') return <section className="page"><PageTitle eyebrow="Invoices" title="Draft not found"/><p className="notice">Only an existing draft can be issued.</p></section>;
  if (role === 'viewer') return <section className="page"><PageTitle eyebrow="Invoices" title="Issue invoice"/><p className="notice">Viewer role cannot issue invoices.</p></section>;
  const client = clients.find((item) => item.id === invoice.clientId);
  const confirm = async () => { const result = await issueInvoice(invoice.id); if (result) return; router.replace(`/invoices/${invoice.id}`); };
  return <section className="page"><PageTitle eyebrow="Review before issue" title="Issue invoice"><Link href={`/invoices/${invoice.id}`} className="button button-secondary">Back to draft</Link></PageTitle><div className="detail-grid"><div className="panel"><div className="panel-head"><h2>Issue confirmation</h2></div><div className="summary-list"><div><span>Client</span><strong>{client?.companyName || client?.displayName || 'Unknown client'}</strong></div><div><span>Invoice date</span><strong>{formatDate(invoice.invoiceDate)}</strong></div><div><span>Due date</span><strong>{formatDate(invoice.dueDate)}</strong></div><div><span>Line-item total</span><strong>{formatMoney(invoice.totalMinor, settings.currencyCode)}</strong></div>{invoice.note && <div><span>Note</span><strong>{invoice.note}</strong></div>}</div><div className="toolbar" style={{ padding: '18px' }}><button className="button button-primary" onClick={confirm}>Confirm and issue</button><Link href={`/invoices/${invoice.id}`} className="button button-secondary">Cancel</Link></div></div><aside className="panel"><div className="panel-head"><h2>What happens next</h2></div><p className="empty">The invoice receives the next configured number and its commercial fields become read-only.</p></aside></div></section>;
}
