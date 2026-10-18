'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { reportClientException } from '@/lib/client-error';
import { BANK_DETAILS_LIMIT, BLOCKS, BUILTIN_DEFINITION, LAYOUTS, LOGO_CHOICES, NAME_LIMIT, TERMS_LIMIT, UPI_ID_LIMIT, parseFormatDefinition, snapshotFormat, type BlockId, type FormatDefinition, type InvoiceFormat, type LayoutId, type LogoChoice } from '@/lib/invoice-format';
import { sampleInvoice } from '@/lib/invoice-format-sample';
import { renderInvoiceHtml } from '@/lib/invoice-html';
import type { TenantSettings } from '@/lib/tenant-store';
import { apiFetch } from '@/lib/api-client';

type Draft = { id: string | null; name: string; definition: FormatDefinition; isDefault: boolean };
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const LAYOUT_NOTES: Record<LayoutId, string> = { classic: 'Roomy header and rows. Reads well on screen.', compact: 'Tighter spacing. Fits more lines on a page.', panel: 'Tinted parties band, ruled item table, bank and UPI panel beside the totals.' };

function Preview({ branding, definition, name }: { branding: TenantSettings; definition: FormatDefinition; name: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / PAGE_WIDTH)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const html = useMemo(() => renderInvoiceHtml(sampleInvoice(branding, snapshotFormat({ id: 'preview', name, definition }))), [branding, definition, name]);
  return <div className="preview-frame" ref={frame} style={{ height: PAGE_HEIGHT * scale }}><iframe title="Invoice format preview" sandbox="" srcDoc={html} style={{ transform: `scale(${scale})` }} /></div>;
}

function FormatEditor({ initial, branding, onSaved, onCancel }: { initial: Draft; branding: TenantSettings; onSaved(message: string): void; onCancel(): void }) {
  const [draft, setDraft] = useState(initial);
  const [accentText, setAccentText] = useState(initial.definition.accent);
  const [accentError, setAccentError] = useState('');
  const [secondaryText, setSecondaryText] = useState(initial.definition.accentSecondary ?? '');
  const [secondaryError, setSecondaryError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { definition } = draft;
  const change = (patch: Partial<FormatDefinition>) => setDraft((current) => ({ ...current, definition: { ...current.definition, ...patch } }));
  const setAccent = (value: string) => {
    setAccentText(value);
    try { change({ accent: parseFormatDefinition({ ...definition, accent: value }).accent }); setAccentError(''); }
    catch (cause) { setAccentError(cause instanceof Error ? cause.message : 'Choose a different colour.'); }
  };
  const setSecondary = (value: string) => {
    setSecondaryText(value);
    if (!value.trim()) { change({ accentSecondary: undefined }); setSecondaryError(''); return; }
    try { change({ accentSecondary: parseFormatDefinition({ ...definition, accentSecondary: value }).accentSecondary }); setSecondaryError(''); }
    catch (cause) { setSecondaryError(cause instanceof Error ? cause.message : 'Choose a different colour.'); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const response = await apiFetch(draft.id ? `/api/invoice-formats/${draft.id}` : '/api/invoice-formats', { method: draft.id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: draft.name, definition, isDefault: draft.isDefault }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setError(body.message ?? 'Unable to save the format.'); return; }
      onSaved(`Format "${draft.name.trim()}" saved.`);
    } catch (cause) { reportClientException('Save invoice format', cause); setError('Unable to save the format.'); }
    finally { setSaving(false); }
  };
  return <form className="formats-editor" onSubmit={(event) => void save(event)} aria-label={draft.id ? 'Edit invoice format' : 'New invoice format'}>
    <div className="formats-form">
      <label className="field"><span>Format name</span><input className="input" required maxLength={NAME_LIMIT} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <fieldset><legend>Base layout</legend><div className="layout-options">{(Object.keys(LAYOUTS) as LayoutId[]).map((id) => <label key={id} className="layout-option"><input type="radio" name="layout" value={id} checked={definition.layout === id} onChange={() => change({ layout: id })} /><strong>{LAYOUTS[id]}</strong><span className="hint">{LAYOUT_NOTES[id]}</span></label>)}</div></fieldset>
      <fieldset><legend>Blocks on the invoice</legend><div className="check-list">{(Object.keys(BLOCKS) as BlockId[]).map((id) => <label key={id}><input type="checkbox" checked={Boolean(definition.blocks[id])} onChange={(event) => change({ blocks: { ...definition.blocks, [id]: event.target.checked } })} />{BLOCKS[id]}</label>)}</div><p className="hint">The UPI QR slot is an empty box for now. Bank details, terms and the UPI ID print only when they have text.</p></fieldset>
      <div className="field"><label htmlFor="format-accent">Accent colour</label><div className="color-row"><input type="color" aria-label="Pick accent colour" value={definition.accent} onChange={(event) => setAccent(event.target.value)} /><input id="format-accent" className="input" value={accentText} spellCheck={false} maxLength={7} aria-invalid={accentError ? true : undefined} onChange={(event) => setAccent(event.target.value)} /></div>{accentError ? <p className="form-error" role="alert">{accentError}</p> : <p className="hint">Used for the header rule and table headings.</p>}</div>
      {definition.layout === 'panel' && <div className="field"><label htmlFor="format-accent-secondary">Second accent colour</label><div className="color-row"><input type="color" aria-label="Pick second accent colour" value={definition.accentSecondary ?? definition.accent} onChange={(event) => setSecondary(event.target.value)} /><input id="format-accent-secondary" className="input" value={secondaryText} placeholder={definition.accent} spellCheck={false} maxLength={7} aria-invalid={secondaryError ? true : undefined} onChange={(event) => setSecondary(event.target.value)} /></div>{secondaryError ? <p className="form-error" role="alert">{secondaryError}</p> : <p className="hint">Used by the Panel layout for the section labels, figure headings and tinted panels. Leave empty to follow the accent.</p>}</div>}
      <label className="field"><span>Logo</span><select className="select" value={definition.logo} onChange={(event) => change({ logo: event.target.value as LogoChoice })}>{(Object.keys(LOGO_CHOICES) as LogoChoice[]).map((id) => <option key={id} value={id}>{LOGO_CHOICES[id]}</option>)}</select></label>
      <label className="field"><span>Bank details to print</span><textarea className="textarea" maxLength={BANK_DETAILS_LIMIT} placeholder={'Account name\nBank, branch\nAccount number, IFSC'} value={definition.bankDetails} onChange={(event) => change({ bankDetails: event.target.value })} /></label>
      <label className="field"><span>UPI ID to print</span><input className="input" maxLength={UPI_ID_LIMIT} placeholder="name@bank" spellCheck={false} value={definition.upiId ?? ''} onChange={(event) => change({ upiId: event.target.value })} /></label>
      <label className="field"><span>Terms to print</span><textarea className="textarea" maxLength={TERMS_LIMIT} placeholder="Payment due within 14 days. Late payments attract interest." value={definition.terms} onChange={(event) => change({ terms: event.target.value })} /></label>
      <label className="invoice-checkbox"><input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} disabled={initial.isDefault} /> Use as the default format for new invoices</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="toolbar"><button className="button button-primary" type="submit" disabled={saving || Boolean(accentError) || Boolean(secondaryError)}>{saving ? 'Saving...' : 'Save format'}</button><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button></div>
    </div>
    <div className="formats-preview"><div className="panel-head formats-preview-head"><h3>Live preview</h3><span className="hint">Sample data with your branding</span></div><Preview branding={branding} definition={definition} name={draft.name} /></div>
  </form>;
}

export function InvoiceFormatsPanel({ settings }: { settings: TenantSettings }) {
  const [formats, setFormats] = useState<InvoiceFormat[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<InvoiceFormat | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/invoice-formats');
      const body = await response.json() as { formats?: InvoiceFormat[]; message?: string };
      if (!response.ok) { setError(body.message ?? 'Unable to load invoice formats.'); return; }
      setFormats(body.formats ?? []);
    } catch (cause) { reportClientException('Load invoice formats', cause); setError('Unable to load invoice formats.'); }
  }, []);
  // The format list is tenant request data, hydrated once the client session exists.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const act = async (request: () => Promise<Response>, done: string) => {
    setError(''); setMessage('');
    try {
      const response = await request();
      const body = await response.json() as { message?: string };
      if (!response.ok) { setError(body.message ?? 'Unable to complete that.'); return; }
      setMessage(done); await load();
    } catch (cause) { reportClientException('Change invoice format', cause); setError('Unable to complete that.'); }
  };

  if (editing) return <div className="panel"><div className="panel-head"><h2>{editing.id ? `Edit ${editing.name}` : 'New invoice format'}</h2></div>
    <FormatEditor initial={editing} branding={settings} onCancel={() => setEditing(null)} onSaved={(text) => { setEditing(null); setMessage(text); void load(); }} /></div>;

  return <div className="panel">
    <div className="panel-head"><h2>Invoice formats</h2><button className="button button-primary" type="button" onClick={() => { setError(''); setMessage(''); setEditing({ id: null, name: '', definition: { ...BUILTIN_DEFINITION, blocks: { ...BUILTIN_DEFINITION.blocks } }, isDefault: false }); }}>New format</button></div>
    <p className="subtle formats-intro">Each invoice prints with the format it was issued with. Editing or deleting a format never changes an invoice that is already issued.</p>
    {message && <p className="notice" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {!formats ? <p className="empty">Loading invoice formats...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Layout</th><th>Colour</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{formats.map((format) => <tr key={format.id}>
      <td><strong>{format.name}</strong> {format.isDefault && <span className="tenant-status tenant-status-active">Default</span>}</td>
      <td>{LAYOUTS[format.definition.layout]}</td>
      <td><span className="swatch" style={{ background: format.definition.accent }} aria-hidden="true" /> {format.definition.accent}</td>
      <td className="format-actions"><button className="button button-secondary" type="button" onClick={() => { setError(''); setMessage(''); setEditing({ id: format.id, name: format.name, definition: format.definition, isDefault: format.isDefault }); }}>Edit<span className="sr-only"> {format.name}</span></button>
        {!format.isDefault && <button className="button button-secondary" type="button" onClick={() => void act(() => apiFetch(`/api/invoice-formats/${format.id}/default`, { method: 'POST' }), `"${format.name}" is now the default format.`)}>Make default<span className="sr-only"> {format.name}</span></button>}
        {!format.isDefault && <button className="button button-secondary" type="button" onClick={() => setRemoving(format)}>Delete<span className="sr-only"> {format.name}</span></button>}</td>
    </tr>)}</tbody></table></div>}
    <ConfirmDialog open={removing !== null} title="Delete this format?" description={removing ? `"${removing.name}" will no longer be offered. Invoices already issued with it keep printing exactly as they did.` : ''} confirmLabel="Delete format" onCancel={() => setRemoving(null)} onConfirm={() => { const target = removing; setRemoving(null); if (target) void act(() => apiFetch(`/api/invoice-formats/${target.id}`, { method: 'DELETE' }), `"${target.name}" deleted.`); }} />
  </div>;
}
