'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { BillingFrequency, Quotation, ServiceInput, TenantService } from '@/lib/tenant-store';

const frequencies: Array<{ value: BillingFrequency; label: string }> = [{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'halfYearly', label: 'Half-yearly' }, { value: 'annual', label: 'Annual' }];
const emptyPrices = { monthly: 0, quarterly: 0, halfYearly: 0, annual: 0 };
const blankService = (): ServiceInput => ({ name: '', description: '', prices: { ...emptyPrices } });
type QuoteLineDraft = { serviceId: string; frequency: BillingFrequency; quantity: number };

export function ServiceCatalogue() {
  const [services, setServices] = useState<TenantService[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [search, setSearch] = useState('');
  const [serviceForm, setServiceForm] = useState<ServiceInput>(blankService);
  const [editing, setEditing] = useState<TenantService | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [quoteLines, setQuoteLines] = useState<QuoteLineDraft[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [servicesResponse, quotationsResponse] = await Promise.all([fetch('/api/services'), fetch('/api/quotations')]);
    const servicesBody = await servicesResponse.json(); const quotationsBody = await quotationsResponse.json();
    if (servicesResponse.ok) setServices(servicesBody.services); else setError(servicesBody.message ?? 'Services could not be loaded.');
    if (quotationsResponse.ok) setQuotations(quotationsBody.quotations);
  }
  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const shown = useMemo(() => services.filter((service) => `${service.name} ${service.description}`.toLowerCase().includes(search.toLowerCase())), [services, search]);
  function openNewService() { setEditing(null); setServiceForm(blankService()); setError(''); setServiceOpen(true); }
  function openEditService(service: TenantService) { setEditing(service); setServiceForm({ name: service.name, description: service.description, prices: { ...service.prices } }); setError(''); setServiceOpen(true); }
  function openNewQuote() { setCustomerName(''); setCustomerEmail(''); setQuoteLines(services.filter((service) => service.status === 'active').slice(0, 1).map((service) => ({ serviceId: service.id, frequency: 'monthly', quantity: 1 }))); setError(''); setQuoteOpen(true); }
  async function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const response = await fetch(editing ? `/api/services/${editing.id}` : '/api/services', { method: editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(serviceForm) });
    const body = await response.json(); if (!response.ok) { setError(body.message ?? 'Service could not be saved.'); return; }
    setMessage(editing ? 'Service updated.' : 'Service added.'); setServiceOpen(false); await load();
  }
  async function toggleService(service: TenantService) {
    const response = await fetch(`/api/services/${service.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: service.status === 'active' ? 'inactive' : 'active' }) });
    const body = await response.json(); if (!response.ok) { setError(body.message ?? 'Service status could not be changed.'); return; }
    setMessage(`${service.name} is now ${body.service.status}.`); await load();
  }
  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const response = await fetch('/api/quotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerName, customerEmail, lines: quoteLines }) });
    const body = await response.json(); if (!response.ok) { setError(body.message ?? 'Quotation could not be created.'); return; }
    setMessage(`Quotation ${body.quotation.quoteNumber} saved.`); setQuoteOpen(false); await load();
  }
  function updateLine(index: number, update: Partial<QuoteLineDraft>) { setQuoteLines((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line)); }
  function money(minor: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100); }

  return <>
    {message && <p className="notice" role="status">{message}</p>}{error && !serviceOpen && !quoteOpen && <p className="form-error" role="alert">{error}</p>}
    <div className="toolbar"><input className="input filter-input" aria-label="Search services" placeholder="Search services" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button button-secondary" type="button" onClick={() => setSearch('')}>Clear filters</button><button className="button button-secondary" type="button" onClick={openNewQuote} disabled={!services.some((service) => service.status === 'active')}>New quotation</button><button className="button button-primary" type="button" onClick={openNewService}>Add service</button></div>
    <section className="panel"><div className="panel-head"><h2>Service catalogue</h2><span className="subtle">{shown.length} services</span></div>{shown.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Service</th>{frequencies.map((frequency) => <th className="money" key={frequency.value}>{frequency.label}</th>)}<th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map((service) => <tr key={service.id}><td><strong>{service.name}</strong><br /><span className="subtle">{service.description || 'No description'}</span></td>{frequencies.map((frequency) => <td className="money" key={frequency.value}>{money(service.prices[frequency.value])}</td>)}<td><span className={`status status-${service.status === 'active' ? 'paid' : 'void'}`}>{service.status}</span></td><td><div className="toolbar"><button type="button" className="button button-secondary" onClick={() => openEditService(service)}>Edit</button><button type="button" className="button button-secondary" onClick={() => void toggleService(service)}>{service.status === 'active' ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div> : <div className="empty">No services match these filters.</div>}</section>
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><h2>Saved quotations</h2><span className="subtle">{quotations.length} quotations</span></div>{quotations.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Quotation</th><th>Customer</th><th>Lines</th><th className="money">Total</th><th>Download</th></tr></thead><tbody>{quotations.map((quotation) => <tr key={quotation.id}><td><strong>{quotation.quoteNumber}</strong><br /><span className="subtle">{new Date(quotation.createdAt).toLocaleDateString('en-IN')}</span></td><td>{quotation.customerName}<br /><span className="subtle">{quotation.customerEmail}</span></td><td>{quotation.lines.length}</td><td className="money">{money(quotation.totalMinor)}</td><td><a className="button button-secondary" href={`/api/quotations/${quotation.id}/download`}>Download</a></td></tr>)}</tbody></table></div> : <div className="empty">No quotations have been saved.</div>}</section>
    {serviceOpen && <div className="dialog-backdrop" role="presentation"><form className="dialog wide-dialog" onSubmit={submitService}><h2>{editing ? 'Edit service' : 'Add service'}</h2><p>Set one price for each supported billing frequency.</p><div className="form-grid"><div className="field full"><label htmlFor="service-name">Service name</label><input className="input" id="service-name" value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} required /></div><div className="field full"><label htmlFor="service-description">Description</label><textarea className="textarea" id="service-description" value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} /></div>{frequencies.map((frequency) => <div className="field" key={frequency.value}><label htmlFor={`service-${frequency.value}`}>{frequency.label} price (₹)</label><input className="input" id={`service-${frequency.value}`} type="number" min="0" step="0.01" value={serviceForm.prices[frequency.value] / 100} onChange={(event) => setServiceForm({ ...serviceForm, prices: { ...serviceForm.prices, [frequency.value]: Math.round(Number(event.target.value) * 100) } })} /></div>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="toolbar" style={{ marginTop: 18 }}><button className="button button-primary">Save service</button><button className="button button-secondary" type="button" onClick={() => setServiceOpen(false)}>Cancel</button></div></form></div>}
    {quoteOpen && <div className="dialog-backdrop" role="presentation"><form className="dialog wide-dialog" onSubmit={submitQuote}><h2>New quotation</h2><p>Quotation prices are copied from the current service catalogue.</p><div className="form-grid"><div className="field"><label htmlFor="quote-customer">Customer name</label><input className="input" id="quote-customer" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></div><div className="field"><label htmlFor="quote-email">Customer email</label><input className="input" id="quote-email" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></div></div><div className="quote-lines">{quoteLines.map((line, index) => <div className="form-grid quote-line" key={index}><div className="field"><label>Service</label><select className="select" aria-label={`Quotation service ${index + 1}`} value={line.serviceId} onChange={(event) => updateLine(index, { serviceId: event.target.value })}>{services.filter((service) => service.status === 'active').map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></div><div className="field"><label>Frequency</label><select className="select" value={line.frequency} onChange={(event) => updateLine(index, { frequency: event.target.value as BillingFrequency })}>{frequencies.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}</select></div><div className="field"><label>Quantity</label><input className="input" type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></div><button className="button button-secondary" type="button" onClick={() => setQuoteLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))} disabled={quoteLines.length === 1}>Remove</button></div>)}</div><div className="toolbar"><button className="button button-secondary" type="button" onClick={() => setQuoteLines((lines) => [...lines, { serviceId: services.find((service) => service.status === 'active')!.id, frequency: 'monthly', quantity: 1 }])}>Add line</button></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="toolbar" style={{ marginTop: 18 }}><button className="button button-primary">Save quotation</button><button className="button button-secondary" type="button" onClick={() => setQuoteOpen(false)}>Cancel</button></div></form></div>}
  </>;
}
