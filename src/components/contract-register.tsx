'use client';

import { apiFetch } from '@/lib/api-client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { BillingFrequency, Contract, ContractInput, CustomerRecord, TenantService } from '@/lib/tenant-store';
import { TablePager } from './table-pager';
import { MonthYearFilter } from './month-year-filter';

const frequencies: Array<{ value: BillingFrequency; label: string }> = [{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'halfYearly', label: 'Half-yearly' }, { value: 'annual', label: 'Annual' }];
const expectedMonths: Record<BillingFrequency, number> = { monthly: 0, quarterly: 3, halfYearly: 2, annual: 1 };
const initial = (): ContractInput => ({ customerId: '', serviceIds: [], name: '', startDate: '', endDate: '', valueMinor: 0, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1, escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0 });
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);

function generatedName(customerId: string, frequency: BillingFrequency, customers: CustomerRecord[]) {
  const firstName = customers.find((customer) => customer.id === customerId)?.contactName.trim().split(/\s+/)[0];
  return firstName ? `${firstName} - Nexio v1 ${frequency.toLowerCase()}` : '';
}

function generatedDates(startDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) return { endDate: '', escalationReviewDate: '' };
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const start = new Date(Date.UTC(year, month, day));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month || start.getUTCDate() !== day) return { endDate: '', escalationReviewDate: '' };
  const format = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return {
    endDate: format(new Date(Date.UTC(year, month + 12, 0))),
    escalationReviewDate: format(new Date(Date.UTC(year, month + 10, 1))),
  };
}

function ContractDialog({ contract, customers, services, onClose, onSaved }: { contract: Contract | null; customers: CustomerRecord[]; services: TenantService[]; onClose(): void; onSaved(): void }) {
  const [input, setInput] = useState<ContractInput>(() => contract ? { customerId: contract.customerId, serviceIds: contract.serviceIds, name: contract.name, startDate: contract.startDate, endDate: contract.endDate, valueMinor: contract.valueMinor, paymentTermsDays: contract.paymentTermsDays, billingFrequency: contract.billingFrequency, invoiceMonths: contract.invoiceMonths, cycleDay: contract.cycleDay, escalationPercent: contract.escalationPercent, escalationReviewDate: contract.escalationReviewDate ?? '', renewalNoticeDays: contract.renewalNoticeDays, securityDepositMinor: contract.securityDepositMinor } : initial());
  const [customName, setCustomName] = useState(false);
  const [customEndDate, setCustomEndDate] = useState(false);
  const [customReviewDate, setCustomReviewDate] = useState(false);
  const [error, setError] = useState('');
  const activeServices = services.filter((service) => service.status === 'active');
  const selectedServices = input.serviceIds.map((id) => services.find((service) => service.id === id)).filter((service): service is TenantService => Boolean(service));

  function change<K extends keyof ContractInput>(key: K, value: ContractInput[K]) { setInput((current) => ({ ...current, [key]: value })); }
  function changeCustomer(customerId: string) {
    setInput((current) => ({ ...current, customerId, name: !contract && !customName ? generatedName(customerId, current.billingFrequency, customers) : current.name }));
  }
  function changeFrequency(frequency: BillingFrequency) {
    setInput((current) => ({ ...current, billingFrequency: frequency, invoiceMonths: [], name: !contract && !customName ? generatedName(current.customerId, frequency, customers) : current.name }));
  }
  function changeName(name: string) {
    setCustomName(Boolean(name));
    setInput((current) => ({ ...current, name: !contract && !name ? generatedName(current.customerId, current.billingFrequency, customers) : name }));
  }
  function changeStartDate(startDate: string) {
    const dates = generatedDates(startDate);
    setInput((current) => ({ ...current, startDate, endDate: !contract && !customEndDate ? dates.endDate : current.endDate, escalationReviewDate: !contract && !customReviewDate ? dates.escalationReviewDate : current.escalationReviewDate }));
  }
  function toggleMonth(month: number) { setInput((current) => ({ ...current, invoiceMonths: current.invoiceMonths.includes(month) ? current.invoiceMonths.filter((item) => item !== month) : [...current.invoiceMonths, month].sort((a, b) => a - b) })); }
  function toggleService(serviceId: string) { setInput((current) => ({ ...current, serviceIds: current.serviceIds.includes(serviceId) ? current.serviceIds.filter((item) => item !== serviceId) : [...current.serviceIds, serviceId] })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.serviceIds.length) { setError('Select at least one service.'); return; }
    setError('');
    const response = await apiFetch(contract ? `/api/contracts/${contract.id}` : '/api/contracts', { method: contract ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) { setError((await response.json() as { message?: string }).message ?? 'Unable to save contract.'); return; }
    onSaved(); onClose();
  }
  const required = expectedMonths[input.billingFrequency];
  return <div className="dialog-backdrop" role="presentation"><form className="dialog wide-dialog" aria-label={contract ? 'Edit contract' : 'Create contract'} onSubmit={submit}>
    <div className="dialog-head"><h2>{contract ? 'Edit contract' : 'New contract'}</h2><button className="icon-button" type="button" aria-label="Close contract form" onClick={onClose}>&times;</button></div>
    <div className="form-grid">
      <label className="field"><span>Contract name</span><input className="input" value={input.name} onChange={(event) => changeName(event.target.value)} required /></label>
      <label className="field"><span>Customer</span><select className="select" aria-label="Customer" value={input.customerId} onChange={(event) => changeCustomer(event.target.value)} required><option value="">Choose customer</option>{customers.filter((customer) => customer.status === 'active').map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></label>
      <label className="field"><span>Start date</span><input className="input" type="date" value={input.startDate} onChange={(event) => changeStartDate(event.target.value)} required /></label>
      <label className="field"><span>End date</span><input className="input" type="date" value={input.endDate} onChange={(event) => { setCustomEndDate(true); change('endDate', event.target.value); }} required /></label>
      <label className="field"><span>Contract value (&#8377;)</span><input className="input" aria-label="Contract value" type="number" min="0" step="0.01" value={input.valueMinor / 100} onChange={(event) => change('valueMinor', Math.round(Number(event.target.value) * 100))} required /></label>
      <label className="field"><span>Payment terms (days)</span><input className="input" type="number" min="0" value={input.paymentTermsDays} onChange={(event) => change('paymentTermsDays', Number(event.target.value))} required /></label>
      <label className="field"><span>Billing frequency</span><select className="select" aria-label="Billing frequency" value={input.billingFrequency} onChange={(event) => changeFrequency(event.target.value as BillingFrequency)}>{frequencies.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}</select></label>
      <label className="field"><span>Billing cycle day</span><input className="input" type="number" min="1" max="31" value={input.cycleDay} onChange={(event) => change('cycleDay', Number(event.target.value))} required /></label>
      <label className="field"><span>Escalation (%)</span><input className="input" type="number" min="0" step="0.01" value={input.escalationPercent} onChange={(event) => change('escalationPercent', Number(event.target.value))} /></label>
      <label className="field"><span>Escalation review date</span><input className="input" type="date" value={input.escalationReviewDate} onChange={(event) => { setCustomReviewDate(true); change('escalationReviewDate', event.target.value); }} /></label>
      <label className="field"><span>Renewal notice (days)</span><input className="input" type="number" min="0" value={input.renewalNoticeDays} onChange={(event) => change('renewalNoticeDays', Number(event.target.value))} required /></label>
      <label className="field"><span>Security deposit (&#8377;)</span><input className="input" aria-label="Security deposit" type="number" min="0" step="0.01" value={input.securityDepositMinor / 100} onChange={(event) => change('securityDepositMinor', Math.round(Number(event.target.value) * 100))} /></label>
      <fieldset className="field full service-field"><legend>Services</legend><details className="service-dropdown"><summary aria-label="Select services">Select services{input.serviceIds.length ? ` (${input.serviceIds.length})` : ''}</summary><div className="service-options">{activeServices.length ? activeServices.map((service) => <label key={service.id}><input type="checkbox" checked={input.serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />{service.name}</label>) : <span className="subtle">No active services available.</span>}</div></details><div className="selected-services" aria-label="Selected services">{selectedServices.map((service) => <span className="selected-service" key={service.id}>{service.name}<button type="button" aria-label={`Remove ${service.name}`} onClick={() => toggleService(service.id)}>&times;</button></span>)}</div></fieldset>
      {required > 0 && <fieldset className="field full"><legend>Invoice months &mdash; select exactly {required}</legend><div className="check-list">{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <label className="switch" key={month}><input type="checkbox" checked={input.invoiceMonths.includes(month)} onChange={() => toggleMonth(month)} /><span aria-hidden="true"/><b>{new Date(2026, month - 1).toLocaleString('en-IN', { month: 'short' })}</b></label>)}</div></fieldset>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="toolbar dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary">{contract ? 'Save changes' : 'Create contract'}</button></div>
  </form></div>;
}

export function ContractRegister() {
  const [contracts, setContracts] = useState<Contract[]>([]); const [customers, setCustomers] = useState<CustomerRecord[]>([]); const [services, setServices] = useState<TenantService[]>([]); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [month, setMonth] = useState(''); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10); const [total, setTotal] = useState(0); const [dialog, setDialog] = useState<Contract | 'create' | null>(null); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const load = useCallback(async () => { const params = new URLSearchParams(); if (search) params.set('search', search); if (status) params.set('status', status); if (month) params.set('month', month); params.set('page', String(page)); params.set('pageSize', String(pageSize)); const [contractsResponse, customersResponse, servicesResponse] = await Promise.all([apiFetch(`/api/contracts?${params}`), apiFetch('/api/customers?pageSize=100'), apiFetch('/api/services')]); if (contractsResponse.ok) { const body = await contractsResponse.json() as { items: Contract[]; total: number }; setContracts(body.items); setTotal(body.total); } else setError('Contracts could not be loaded.'); if (customersResponse.ok) setCustomers((await customersResponse.json() as { items: CustomerRecord[] }).items); if (servicesResponse.ok) setServices((await servicesResponse.json() as { services: TenantService[] }).services); }, [search, status, month, page, pageSize]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function toggle(contract: Contract) { const response = await apiFetch(`/api/contracts/${contract.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: contract.status === 'active' ? 'inactive' : 'active' }) }); if (!response.ok) { setError((await response.json() as { message?: string }).message ?? 'Unable to change contract status.'); return; } setMessage(`${contract.name} is now ${contract.status === 'active' ? 'inactive' : 'active'}.`); void load(); }
  return <><div className="toolbar"><input className="input filter-input" aria-label="Search contracts" placeholder="Search contracts or customers" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><select className="select compact-select" aria-label="Contract status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><MonthYearFilter label="Contract month" value={month} onChange={(value) => { setMonth(value); setPage(1); }} /><button className="button button-secondary" type="button" onClick={() => { setSearch(''); setStatus(''); setMonth(''); setPage(1); }}>Clear filters</button><button className="button button-primary" type="button" onClick={() => setDialog('create')}>Add contract</button></div>{message && <p className="notice" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<section className="panel"><div className="panel-head"><h2>Contracts</h2><span className="subtle">{total} matching contracts</span></div><TablePager noun="contracts" total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />{contracts.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Contract</th><th>Customer</th><th>Schedule</th><th>Services</th><th className="money">Value</th><th>Status</th><th>Actions</th></tr></thead><tbody>{contracts.map((contract) => <tr key={contract.id}><td><strong>{contract.name}</strong><br/><span className="subtle">{contract.startDate} – {contract.endDate}</span></td><td>{contract.customerName}</td><td>{frequencies.find((item) => item.value === contract.billingFrequency)?.label}<br/><span className="subtle">Day {contract.cycleDay}{contract.invoiceMonths.length ? ` · months ${contract.invoiceMonths.join(', ')}` : ''}</span></td><td>{contract.services.join(', ')}</td><td className="money">{money(contract.valueMinor)}{contract.securityDepositMinor > 0 && <><br/><span className="subtle">Deposit {money(contract.securityDepositMinor)}</span></>}</td><td><label className="switch"><input type="checkbox" checked={contract.status === 'active'} aria-label={`Set ${contract.name} ${contract.status === 'active' ? 'inactive' : 'active'}`} onChange={() => void toggle(contract)} /><span aria-hidden="true"/><b>{contract.status}</b></label></td><td><div className="row-actions"><button className="link-button" type="button" onClick={() => setDialog(contract)}>Edit</button><button className="link-button" type="button" onClick={() => void toggle(contract)}>{contract.status === 'active' ? 'Archive' : 'Approve'}</button></div></td></tr>)}</tbody></table></div> : <div className="empty">No contracts match these filters.</div>}<TablePager noun="contracts" total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /></section>{dialog && <ContractDialog contract={dialog === 'create' ? null : dialog} customers={customers} services={services} onClose={() => setDialog(null)} onSaved={() => { setMessage(dialog === 'create' ? 'Contract created.' : 'Contract updated.'); void load(); }} />}</>;
}
