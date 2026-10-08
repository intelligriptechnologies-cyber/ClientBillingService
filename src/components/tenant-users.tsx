'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { TenantUser, TenantUserInput } from '@/lib/tenant-store';
import { TablePager } from './table-pager';
import { MonthYearFilter } from './month-year-filter';

const emptyForm: TenantUserInput = { name: '', email: '', role: 'user' };

export function TenantUsers() {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [query, setQuery] = useState(''); const [month, setMonth] = useState(''); const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState<'all' | TenantUser['status']>('all');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<TenantUserInput>(emptyForm);
  const [editing, setEditing] = useState<TenantUser | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch('/api/users');
    const body = await response.json();
    if (!response.ok) { setError(body.message ?? 'Users could not be loaded.'); return; }
    setUsers(body.users);
  }
  // The active tenant comes from the soft-login cookie, so users are loaded only after this client component mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const shown = useMemo(() => users.filter((user) => {
    const matchesQuery = `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'all' || user.status === status) && (!month || user.createdAt.slice(0, 7) === month);
  }), [users, query, status, month]);
  const rows = shown.slice((page - 1) * pageSize, page * pageSize);

  function startCreate() { setEditing(null); setForm(emptyForm); setOpen(true); setError(''); }
  function startEdit(user: TenantUser) { setEditing(user); setForm({ name: user.name, email: user.email, role: user.role }); setOpen(true); setError(''); }
  function close() { setOpen(false); setEditing(null); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const response = await fetch(editing ? `/api/users/${editing.id}` : '/api/users', { method: editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
    const body = await response.json();
    if (!response.ok) { setError(body.message ?? 'User could not be saved.'); return; }
    setMessage(editing ? 'User updated.' : 'User created.'); close(); await load();
  }
  async function toggle(user: TenantUser) {
    setError('');
    const response = await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: user.status === 'active' ? 'disabled' : 'active' }) });
    const body = await response.json();
    if (!response.ok) { setError(body.message ?? 'User status could not be changed.'); return; }
    setMessage(`${user.name} is now ${body.user.status}.`); await load();
  }
  function updateField<K extends keyof TenantUserInput>(key: K, value: TenantUserInput[K]) { setForm((current) => ({ ...current, [key]: value })); }

  return <>
    {message && <p className="notice" role="status">{message}</p>}{error && !open && <p className="form-error" role="alert">{error}</p>}
    <div className="toolbar"><input className="input filter-input" aria-label="Search users" placeholder="Search users" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}/><select className="select" aria-label="Filter user status" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select><MonthYearFilter value={month} onChange={(value) => { setMonth(value); setPage(1); }} label="User month" /><button className="button button-secondary" type="button" onClick={() => { setQuery(''); setStatus('all'); setMonth(''); setPage(1); }}>Clear filters</button><button className="button button-primary" type="button" onClick={startCreate}>Add user</button></div>
    <div className="panel"><div className="panel-head"><h2>Tenant users</h2><span className="subtle">{shown.length} users</span></div><TablePager noun="users" total={shown.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />{rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><br/><span className="subtle">{user.email}</span></td><td>{user.role === 'admin' ? 'Tenant admin' : 'Tenant user'}</td><td><span className={`status status-${user.status === 'active' ? 'paid' : 'void'}`}>{user.status}</span></td><td><div className="toolbar"><button className="button button-secondary" type="button" onClick={() => startEdit(user)}>Edit</button><button className="button button-secondary" type="button" onClick={() => void toggle(user)}>{user.status === 'active' ? 'Archive' : 'Approve'}</button></div></td></tr>)}</tbody></table></div> : <div className="empty">No tenant users match these filters.</div>}<TablePager noun="users" total={shown.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /></div>
    {open && <div className="dialog-backdrop" role="presentation"><form className="dialog" onSubmit={submit}><h2>{editing ? 'Edit tenant user' : 'Add tenant user'}</h2><p>Users can access only this tenant&apos;s billing workspace.</p><div className="form-grid"><div className="field full"><label htmlFor="tenant-user-name">Name</label><input className="input" id="tenant-user-name" value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></div><div className="field full"><label htmlFor="tenant-user-email">Email</label><input className="input" id="tenant-user-email" type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} required /></div><div className="field full"><label htmlFor="tenant-user-role">Role</label><select className="select" id="tenant-user-role" value={form.role} onChange={(event) => updateField('role', event.target.value as TenantUser['role'])}><option value="user">Tenant user</option><option value="admin">Tenant admin</option></select></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="toolbar" style={{ marginTop: 18 }}><button className="button button-primary">Save user</button><button className="button button-secondary" type="button" onClick={close}>Cancel</button></div></form></div>}
  </>;
}
