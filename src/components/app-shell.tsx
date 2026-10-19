'use client';

import { apiFetch } from '@/lib/api-client';
import { reportClientError } from '@/lib/client-error';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MemberRole } from '@/lib/auth/principal';
import type { TenantName } from '@/lib/tenant-store';

/** What the menu shows about who is signed in. Nothing is authorized from it. */
export type ShellIdentity =
  | { kind: 'platform'; email: string }
  | { kind: 'member'; email: string; role: MemberRole; tenantId: string; tenants: TenantName[] };

const tenantGroups = [
  { label: 'Master Data', links: [{ href: '/customers', label: 'Customers' }, { href: '/services', label: 'Services' }, { href: '/contracts', label: 'Contracts' }, { href: '/renewals', label: 'Renewal Tracker' }] },
  { label: 'Operational Records', links: [{ href: '/additional-services', label: 'Additional Services' }, { href: '/task-notes', label: 'Task Notes' }] },
  { label: 'Billing', links: [{ href: '/invoices', label: 'Invoices' }, { href: '/payments', label: 'Payments' }, { href: '/security-deposits', label: 'Security Deposits' }] },
  { label: 'Reports', links: [{ href: '/reports/gst-sales', label: 'GST Sales' }, { href: '/reports/pending-payments', label: 'Pending Payments' }] },
  { label: 'Admin Console', links: [{ href: '/settings', label: 'Company Settings' }, { href: '/users', label: 'User management' }, { href: '/logs', label: 'Logs' }] },
];

function active(pathname: string, href: string) { return pathname === href || pathname.startsWith(`${href}/`); }
function groupFor(pathname: string) {
  if (pathname === '/reports') return 'Reports';
  return tenantGroups.find((group) => group.links.some((link) => active(pathname, link.href)))?.label ?? null;
}

export function AppShell({ identity, children }: { identity: ShellIdentity; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(event.message || 'Uncaught client error', event.error instanceof Error ? event.error.stack : undefined);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason instanceof Error ? event.reason.message : String(event.reason), event.reason instanceof Error ? event.reason.stack : undefined);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  const pathname = usePathname();
  const currentGroup = groupFor(pathname);
  const [openGroups, setOpenGroups] = useState<string[]>(() => currentGroup ? [currentGroup] : []);
  const groups = identity.kind === 'member' && identity.role === 'admin' ? tenantGroups : tenantGroups.filter((group) => group.label !== 'Admin Console');
  const tenantName = identity.kind === 'member' ? identity.tenants.find((tenant) => tenant.id === identity.tenantId)?.name ?? identity.tenantId : null;
  const allGroupsOpen = groups.every((group) => openGroups.includes(group.label));
  function toggleGroup(label: string) {
    setOpenGroups((previous) => previous.includes(label) ? previous.filter((group) => group !== label) : [...previous, label]);
  }
  // In authelia mode the logout URL ends the Authelia session as well (ADR 0002, decision 10).
  async function signOut() {
    const { logoutUrl } = await (await apiFetch('/api/auth/logout', { method: 'POST' })).json() as { logoutUrl: string | null };
    if (logoutUrl) { window.location.assign(logoutUrl); return; }
    router.replace('/'); router.refresh();
  }
  return <div className="app-shell"><aside className="sidebar"><Link href="/dashboard" className="brand">ledger<span>ly</span></Link><p className="session-identity"><strong>{identity.kind === 'platform' ? 'Platform access' : tenantName}</strong><span>{identity.email}</span></p>{identity.kind === 'member' && <button className="nav-expand-toggle" type="button" onClick={() => setOpenGroups(allGroupsOpen ? [] : groups.map((group) => group.label))}>{allGroupsOpen ? 'Collapse all' : 'Expand all'}</button>}<nav className="nav" aria-label="Main navigation">{identity.kind === 'platform' ? <><Link href="/dashboard" aria-current={active(pathname, '/dashboard') ? 'page' : undefined}>Platform dashboard</Link><Link href="/tenants" aria-current={active(pathname, '/tenants') ? 'page' : undefined}>Tenants</Link></> : <><Link href="/dashboard" aria-current={active(pathname, '/dashboard') ? 'page' : undefined}>Dashboard</Link>{groups.map((group) => <div className="nav-group" key={group.label}><button type="button" className="nav-parent" aria-expanded={openGroups.includes(group.label)} aria-current={currentGroup === group.label ? 'location' : undefined} aria-controls={`nav-${group.label.replaceAll(' ', '-').toLowerCase()}`} onClick={() => toggleGroup(group.label)}>{group.label}<span aria-hidden="true">⌄</span></button><div className="nav-children" id={`nav-${group.label.replaceAll(' ', '-').toLowerCase()}`} hidden={!openGroups.includes(group.label)}>{group.links.map((link) => <Link key={link.href} href={link.href} aria-current={active(pathname, link.href) ? 'page' : undefined}>{link.label}</Link>)}</div></div>)}</>}</nav><button className="button button-secondary sign-out" type="button" onClick={signOut}>Sign out</button></aside><main className="main">{children}</main></div>;
}
