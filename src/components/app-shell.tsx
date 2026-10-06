'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AppSession } from '@/lib/tenant-store';

const tenantLinks = [{ href: '/dashboard', label: 'Dashboard' }, { href: '/customers', label: 'Customers' }, { href: '/services', label: 'Services' }, { href: '/contracts', label: 'Contracts' }, { href: '/additional-services', label: 'Additional services' }, { href: '/invoices', label: 'Invoices' }, { href: '/payments', label: 'Payments' }, { href: '/reports', label: 'Reports' }];
export function AppShell({ session, children }: { session: AppSession; children: React.ReactNode }) {
  const router = useRouter();
  const links = session.role === 'superadmin' ? [{ href: '/dashboard', label: 'Platform dashboard' }, { href: '/tenants', label: 'Tenants' }] : [...tenantLinks, ...(session.role === 'admin' ? [{ href: '/users', label: 'Users' }, { href: '/settings', label: 'Settings' }] : [])];
  async function signOut() { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/'); router.refresh(); }
  return <div className="app-shell"><aside className="sidebar"><Link href="/dashboard" className="brand">ledger<span>ly</span></Link><p className="session-identity"><strong>{session.role === 'superadmin' ? 'Platform access' : session.tenantName}</strong><span>{session.email}</span></p><nav className="nav" aria-label="Main navigation">{links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav><button className="button button-secondary sign-out" type="button" onClick={signOut}>Sign out</button></aside><main className="main">{children}</main></div>;
}
