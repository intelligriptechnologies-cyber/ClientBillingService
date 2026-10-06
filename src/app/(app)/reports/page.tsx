import Link from 'next/link';
import { PageTitle } from '@/components/ui';

export default function ReportsPage() {
  return <section className="page"><PageTitle eyebrow="Finance intelligence" title="Reports"><span className="subtle">Download tenant-scoped billing reports.</span></PageTitle><div className="panel"><div className="panel-head"><h2>GST Sales</h2><Link className="button" href="/reports/gst-sales">Open report</Link></div><p className="subtle">Review invoice tax values by month, then export a spreadsheet-compatible CSV or a print-ready document for PDF saving.</p></div></section>;
}
