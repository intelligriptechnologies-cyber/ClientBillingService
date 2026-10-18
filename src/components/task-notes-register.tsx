'use client';

import { apiFetch } from '@/lib/api-client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MonthYearFilter } from '@/components/month-year-filter';
import { TablePager } from '@/components/table-pager';
import type { CustomerRecord, TaskNote, TaskNoteInput } from '@/lib/tenant-store';

const empty = (): TaskNoteInput => { const date = new Date(); return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, customerId: '', note: '' }; };

export function TaskNotesRegister() {
  const [items, setItems] = useState<TaskNote[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [date, setDate] = useState(''); const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState(''); const [month, setMonth] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<TaskNote | 'new' | null>(null);
  const [input, setInput] = useState<TaskNoteInput>(empty);
  const [deleting, setDeleting] = useState<TaskNote | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const params = new URLSearchParams(); if (date) params.set('date', date); if (customerId) params.set('customerId', customerId);
    const [notesResponse, customersResponse] = await Promise.all([apiFetch(`/api/task-notes?${params}`), apiFetch('/api/customers?pageSize=100')]);
    if (notesResponse.ok) setItems((await notesResponse.json() as { items: TaskNote[] }).items);
    else setError((await notesResponse.json() as { message?: string }).message ?? 'Unable to load task notes.');
    if (customersResponse.ok) {
      const first = await customersResponse.json() as { items: CustomerRecord[]; total: number };
      const pages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 100) - 1) }, (_, index) => apiFetch(`/api/customers?pageSize=100&page=${index + 2}`).then((response) => response.json() as Promise<{ items: CustomerRecord[] }>)));
      setCustomers([...first.items, ...pages.flatMap((page) => page.items)]);
    }
  }, [date, customerId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  function open(item: TaskNote | 'new') { setError(''); setInput(item === 'new' ? empty() : { date: item.date, customerId: item.customerId, note: item.note }); setEditing(item); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const response = await apiFetch(editing === 'new' ? '/api/task-notes' : `/api/task-notes/${(editing as TaskNote).id}`, { method: editing === 'new' ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) { setError((await response.json() as { message?: string }).message ?? 'Unable to save task note.'); return; }
    setMessage(editing === 'new' ? 'Task note added.' : 'Task note updated.'); setEditing(null); void load();
  }
  async function remove() {
    if (!deleting) return;
    const response = await apiFetch(`/api/task-notes/${deleting.id}`, { method: 'DELETE' });
    if (!response.ok) setError((await response.json() as { message?: string }).message ?? 'Unable to delete task note.');
    else { setMessage('Task note deleted.'); void load(); }
    setDeleting(null);
  }
  const filtered = items.filter((item) => (!month || item.date.slice(0, 7) === month) && (!search || `${item.note} ${item.customerName} ${item.date}`.toLowerCase().includes(search.trim().toLowerCase())));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pager = <TablePager total={filtered.length} page={currentPage} pageSize={pageSize} noun="task notes" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />;
  return <><div className="toolbar"><input className="input filter-input" aria-label="Search task notes" placeholder="Search notes and customers" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><MonthYearFilter label="Task notes month" value={month} onChange={(value) => { setMonth(value); setPage(1); }} /><label className="field"><span>Date</span><input className="input" aria-label="Filter task notes by date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} /></label><label className="field"><span>Customer</span><select className="select" aria-label="Filter task notes by customer" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setPage(1); }}><option value="">All customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></label><button className="button button-secondary" type="button" onClick={() => { setSearch(''); setMonth(''); setDate(''); setCustomerId(''); setPage(1); }}>Clear filters</button><button className="button button-primary" type="button" onClick={() => open('new')}>Add task note</button></div>
    {message && <p role="status" className="notice">{message}</p>}{error && !editing && <p role="alert" className="form-error">{error}</p>}
    <section className="panel"><div className="panel-head"><h2>Task Notes</h2><span className="subtle">{filtered.length} notes</span></div>{pager}<div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Customer</th><th>Note</th><th>Actions</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td>{item.date}</td><td>{item.customerName}</td><td className="task-note-text">{item.note}</td><td><div className="row-actions"><button className="button button-secondary" type="button" onClick={() => open(item)}>Edit</button><button className="button button-secondary" type="button" onClick={() => setDeleting(item)}>Delete</button></div></td></tr>)}</tbody></table></div>{!filtered.length && <p className="empty">No task notes match these filters.</p>}{pager}</section>
    {editing && <div className="dialog-backdrop" role="presentation"><form className="dialog" aria-label={editing === 'new' ? 'Add task note' : 'Edit task note'} onSubmit={save}><div className="dialog-head"><h2>{editing === 'new' ? 'Add task note' : 'Edit task note'}</h2><button className="icon-button" aria-label="Close form" type="button" onClick={() => setEditing(null)}>×</button></div><div className="stack"><label className="field"><span>Date</span><input className="input" type="date" value={input.date} onChange={(event) => setInput((value) => ({ ...value, date: event.target.value }))} required /></label><label className="field"><span>Customer</span><select className="select" value={input.customerId} onChange={(event) => setInput((value) => ({ ...value, customerId: event.target.value }))} required><option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></label><label className="field"><span>Note</span><textarea className="textarea" value={input.note} onChange={(event) => setInput((value) => ({ ...value, note: event.target.value }))} required /></label></div>{error && <p role="alert" className="form-error">{error}</p>}<div className="toolbar dialog-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary">Save task note</button></div></form></div>}
    <ConfirmDialog open={Boolean(deleting)} title="Delete task note?" description="This note will be permanently removed." confirmLabel="Delete task note" onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
  </>;
}
