'use client';

import { useEffect, useState } from 'react';
import { calculateInvoiceLines, type InvoiceLineInput, type InvoiceTaxType } from '@/lib/invoice-lines';
import { reportClientException } from '@/lib/client-error';
import { stateName } from '@/lib/gst';
import { invoiceDocumentType, lineTaxability, overridesSplit, type SupplyContext } from '@/lib/invoice-gst';
import type { Contract, CustomerRecord, TenantInvoice, TenantService } from '@/lib/tenant-store';
import { StateSelect } from './state-select';

type Props = { invoice: TenantInvoice | null; onClose(): void; onSaved(): void };
type List<T> = { items: T[]; total: number };
type DraftLine = { id: string; description: string; quantity: string; rate: string; taxType: InvoiceTaxType; gstRate: string; hsnSac: string; serviceId: string; touched: boolean };
type SupplyResult = { key: string; supply: SupplyContext | null; error: string };
const today = () => new Date().toISOString().slice(0, 10);
const newLine = (supply: SupplyContext | null = null): DraftLine => ({ id: crypto.randomUUID(), description: '', quantity: '1', rate: '', taxType: supply?.expectedTaxType ?? 'none', gstRate: supply?.expectedTaxType ? '18' : '0', hsnSac: '', serviceId: '', touched: false });
const preselect = (line: DraftLine, supply: SupplyContext): DraftLine => line.touched || !supply.expectedTaxType ? line : { ...line, taxType: supply.expectedTaxType, gstRate: line.gstRate === '0' ? '18' : line.gstRate };
const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

async function allRows<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${path}?page=${page}&pageSize=100`);
    const body = await response.json() as List<T> & { message?: string };
    if (!response.ok) throw new Error(body.message ?? 'Unable to load choices.');
    rows.push(...body.items);
    if (rows.length >= body.total || !body.items.length) return rows;
  }
}

export function InvoiceEditorDialog({ invoice, onClose, onSaved }: Props) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [source, setSource] = useState<'existing' | 'new'>('existing');
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? '');
  const [contractId, setContractId] = useState(invoice?.contractId ?? '');
  const [newCustomer, setNewCustomer] = useState({ companyName: '', contactName: '', email: '', phone: '', stateCode: '' });
  const [services, setServices] = useState<TenantService[]>([]);
  const [supplyResult, setSupplyResult] = useState<SupplyResult | null>(null);
  const [overrideReason, setOverrideReason] = useState(invoice?.snapshot.taxSplitOverrideReason ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? today());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? today());
  const [gstApplicable, setGstApplicable] = useState(invoice?.snapshot.gstApplicable ?? true);
  const [customerPan, setCustomerPan] = useState(invoice?.snapshot.customerPan ?? '');
  const [customerGstin, setCustomerGstin] = useState(invoice?.snapshot.customerGstin ?? '');
  const [billingAddress, setBillingAddress] = useState(invoice?.snapshot.customerAddress ?? '');
  const [notes, setNotes] = useState(invoice?.snapshot.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => invoice?.snapshot.lines?.length
    ? invoice.snapshot.lines.map((line) => ({ id: crypto.randomUUID(), description: line.description, quantity: String(line.quantity), rate: String(line.rateMinor / 100), taxType: line.taxType, gstRate: String(line.gstRate), hsnSac: line.hsnSac ?? '', serviceId: '', touched: true }))
    : invoice ? [{ ...newLine(), description: 'Invoice charges', rate: String(invoice.taxableMinor / 100), taxType: invoice.gstRate ? 'igst' : 'none', gstRate: String(invoice.gstRate), touched: true }] : [newLine()]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([allRows<CustomerRecord>('/api/customers'), allRows<Contract>('/api/contracts')])
      .then(([customerRows, contractRows]) => { if (active) { setCustomers(customerRows.filter((row) => row.status === 'active')); setContracts(contractRows.filter((row) => row.status === 'active')); if (invoice && !invoice.snapshot.customerGstin) setCustomerGstin(customerRows.find((row) => row.id === invoice.customerId)?.gstin ?? ''); } })
      .catch((cause: unknown) => { reportClientException('Load invoice choices', cause); if (active) setError(cause instanceof Error ? cause.message : 'Unable to load choices.'); });
    return () => { active = false; };
  }, [invoice]);

  useEffect(() => {
    let active = true;
    void fetch('/api/services').then(async (response) => { const body = await response.json() as { services?: TenantService[] }; if (active && response.ok) setServices((body.services ?? []).filter((service) => service.status === 'active')); }).catch((cause: unknown) => reportClientException('Load invoice services', cause));
    return () => { active = false; };
  }, []);

  const gstinInput = customerGstin.trim().toUpperCase();
  const supplyKey = [source === 'new' ? 'new' : customerId, gstinInput, source === 'new' ? newCustomer.stateCode : ''].join('|');
  const supplyReady = (source === 'new' || Boolean(customerId)) && (gstinInput === '' || gstinInput.length === 15);
  useEffect(() => {
    if (!supplyReady) return;
    let active = true;
    const params = new URLSearchParams();
    if (source === 'existing') params.set('customerId', customerId);
    if (gstinInput) params.set('customerGstin', gstinInput);
    if (source === 'new' && newCustomer.stateCode) params.set('billingStateCode', newCustomer.stateCode);
    void fetch(`/api/gst/supply?${params}`).then(async (response) => {
      const body = await response.json() as { supply?: SupplyContext; message?: string };
      if (!active) return;
      if (!response.ok || !body.supply) { setSupplyResult({ key: supplyKey, supply: null, error: body.message ?? 'Unable to work out the place of supply.' }); return; }
      const supply = body.supply;
      setSupplyResult({ key: supplyKey, supply, error: '' });
      if (gstApplicable) setLines((current) => current.map((line) => preselect(line, supply)));
    }).catch((cause: unknown) => reportClientException('Load place of supply', cause));
    return () => { active = false; };
  }, [supplyReady, supplyKey, source, customerId, gstinInput, newCustomer.stateCode, gstApplicable]);
  const supply = supplyReady && supplyResult?.key === supplyKey ? supplyResult.supply : null;
  const supplyError = supplyReady && supplyResult?.key === supplyKey ? supplyResult.error : '';

  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  function chooseCustomer(id: string) {
    const customer = customers.find((row) => row.id === id);
    setCustomerId(id); setContractId(contracts.find((contract) => contract.customerId === id)?.id ?? '');
    setCustomerGstin(customer?.gstin ?? ''); setBillingAddress(customer?.billingAddress ?? '');
  }
  function updateLine(id: string, change: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...change } : line));
  }
  const draftTaxLines = lines.map((line) => ({ taxType: gstApplicable ? line.taxType : 'none' as InvoiceTaxType, gstRate: gstApplicable && line.taxType !== 'none' ? Number(line.gstRate || 0) : 0 }));
  const overridden = supply !== null && overridesSplit(draftTaxLines, supply);
  const draftType = supply ? invoiceDocumentType(supply.sellerRegistered, draftTaxLines) : null;
  const preview = lines.reduce((sum, line) => {
    const amount = Math.round(Number(line.quantity || 0) * Number(line.rate || 0) * 100);
    const gst = gstApplicable && line.taxType !== 'none' ? Math.round(amount * Number(line.gstRate || 0) / 100) : 0;
    return { subtotal: sum.subtotal + (Number.isFinite(amount) ? amount : 0), gst: sum.gst + (Number.isFinite(gst) ? gst : 0) };
  }, { subtotal: 0, gst: 0 });

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (dueDate < invoiceDate) { setError('Due date must be on or after invoice date.'); return; }
    if (source === 'existing' && !invoice && !customerId) { setError('Choose a customer.'); return; }
    if (customerPan.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(customerPan.trim().toUpperCase())) { setError('Enter a valid customer PAN.'); return; }
    let calculated;
    try {
      const inputs: InvoiceLineInput[] = lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), rateMinor: Math.round(Number(line.rate) * 100), taxType: gstApplicable ? line.taxType : 'none', gstRate: gstApplicable && line.taxType !== 'none' ? Number(line.gstRate) : 0, hsnSac: line.hsnSac.trim() }));
      if (lines.some((line) => !line.rate.trim() || !line.quantity.trim())) throw new Error('Enter a quantity and rate for every line.');
      calculated = calculateInvoiceLines(inputs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the line items.'); return; }
    if (supply?.sellerRegistered && invoiceDocumentType(true, calculated.lines) === 'Tax Invoice') {
      const missing = calculated.lines.findIndex((line) => lineTaxability(line) === 'taxable' && !(line.hsnSac ?? '').trim());
      if (missing >= 0) { setError(`Line ${missing + 1} needs an HSN/SAC code because a Tax Invoice taxes it.`); return; }
    }
    if (overridden && !overrideReason.trim()) { setError('Enter a reason for overriding the tax split that was preselected from the place of supply.'); return; }
    setSaving(true);
    try {
      let chosenCustomerId = customerId;
      if (!invoice && source === 'new') {
        const response = await fetch('/api/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...newCustomer, gstin: gstinInput, billingAddress: billingAddress.trim(), invoiceDelivery: 'manual' }) });
        const body = await response.json() as CustomerRecord & { message?: string };
        if (!response.ok) throw new Error(body.message ?? 'Unable to create customer.');
        chosenCustomerId = body.id;
      }
      const input = { customerId: chosenCustomerId, contractId: contractId || undefined, invoiceDate, dueDate, venue: invoice?.snapshot.venue, gstApplicable, customerPan, customerGstin, billingAddress, notes, taxSplitOverrideReason: overridden ? overrideReason.trim() : undefined, lines: calculated.lines.map(({ description, quantity, rateMinor, taxType, gstRate, hsnSac }) => ({ description, quantity, rateMinor, taxType, gstRate, hsnSac })) };
      const response = await fetch(invoice ? `/api/invoices/${invoice.id}` : '/api/invoices', { method: invoice ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(invoice ? { correction: input, reason: reason.trim() } : input) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Unable to save invoice.');
      onSaved(); onClose();
    } catch (cause) { reportClientException(invoice ? 'Correct invoice' : 'Create invoice', cause); setError(cause instanceof Error ? cause.message : 'Unable to save invoice.'); }
    finally { setSaving(false); }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><form className="dialog invoice-dialog" role="dialog" aria-modal="true" aria-label={invoice ? 'Correct invoice' : 'Create invoice'} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
    <div className="dialog-head"><h2>{invoice ? `Correct ${invoice.invoiceNumber}` : 'Create Invoice'}</h2><button className="icon-button" type="button" aria-label="Close invoice form" onClick={onClose}>×</button></div>
    <div className="invoice-dialog-body">
      {invoice && <p className="subtle invoice-correction-note">A correction voids the unpaid invoice and issues a replacement with a new number.</p>}
      {!invoice && <label className="field"><span>Customer Source <b>*</b></span><select className="select" value={source} onChange={(event) => { setSource(event.target.value as 'existing' | 'new'); setContractId(''); }}><option value="existing">Select Existing Customer</option><option value="new">Create New Customer</option></select></label>}
      {!invoice && source === 'existing' && <label className="field"><span>Customer <b>*</b></span><select className="select" required value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">Search customer...</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></label>}
      {!invoice && source === 'new' && <div className="form-grid"><label className="field full"><span>Customer / company name <b>*</b></span><input className="input" required value={newCustomer.companyName} onChange={(event) => setNewCustomer({ ...newCustomer, companyName: event.target.value })} /></label><label className="field"><span>Contact name <b>*</b></span><input className="input" required value={newCustomer.contactName} onChange={(event) => setNewCustomer({ ...newCustomer, contactName: event.target.value })} /></label><label className="field"><span>Phone <b>*</b></span><input className="input" required value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></label><label className="field full"><span>Email <b>*</b></span><input className="input" type="email" required value={newCustomer.email} onChange={(event) => setNewCustomer({ ...newCustomer, email: event.target.value })} /></label></div>}
      {!invoice && source === 'existing' && customerId && <label className="field"><span>Contract (optional)</span><select className="select" value={contractId} onChange={(event) => setContractId(event.target.value)}><option value="">No contract</option>{contracts.filter((contract) => contract.customerId === customerId).map((contract) => <option key={contract.id} value={contract.id}>{contract.name}</option>)}</select></label>}
      <div className="form-grid invoice-date-grid"><label className="field"><span>Invoice Date <b>*</b></span><input className="input" type="date" required value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label><label className="field"><span>Due Date <b>*</b></span><input className="input" type="date" required min={invoiceDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
      <section className="invoice-lines" aria-label="Line Items"><div className="invoice-section-head"><h3>Line Items</h3><button className="button button-secondary" type="button" onClick={() => setLines((current) => [...current, newLine(gstApplicable ? supply : null)])}>Add Line</button></div><div className="invoice-lines-scroll"><div className="invoice-line-labels" aria-hidden="true"><span>Description</span><span>HSN/SAC</span><span>Qty</span><span>Rate</span><span>Tax Type</span><span>GST %</span><span>Amount</span><span /></div>{lines.map((line, index) => {
        const amount = Math.round(Number(line.quantity || 0) * Number(line.rate || 0) * 100);
        const gst = gstApplicable && line.taxType !== 'none' ? Math.round(amount * Number(line.gstRate || 0) / 100) : 0;
        return <div className="invoice-line" key={line.id}><div className="invoice-line-description">{services.length > 0 && <select className="select" aria-label={`Service ${index + 1}`} value={line.serviceId} onChange={(event) => { const service = services.find((item) => item.id === event.target.value); updateLine(line.id, service ? { serviceId: service.id, description: service.name, hsnSac: service.hsnSac } : { serviceId: '' }); }}><option value="">Custom line</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>}<input className="input" aria-label={`Description ${index + 1}`} required placeholder="Description" value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /></div><input className="input" aria-label={`HSN/SAC ${index + 1}`} inputMode="numeric" placeholder="HSN/SAC" value={line.hsnSac} onChange={(event) => updateLine(line.id, { hsnSac: event.target.value })} /><input className="input" aria-label={`Quantity ${index + 1}`} type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} /><input className="input" aria-label={`Rate ${index + 1}`} type="number" min="0" step="0.01" required value={line.rate} onChange={(event) => updateLine(line.id, { rate: event.target.value })} /><select className="select" aria-label={`Tax type ${index + 1}`} disabled={!gstApplicable} value={line.taxType} onChange={(event) => updateLine(line.id, { taxType: event.target.value as InvoiceTaxType, gstRate: event.target.value === 'none' ? '0' : line.gstRate === '0' ? '18' : line.gstRate, touched: true })}><option value="none">No GST</option><option value="igst">IGST</option><option value="cgst_sgst">CGST + SGST</option></select><input className="input" aria-label={`GST percent ${index + 1}`} type="number" min="0" max="100" step="0.01" disabled={!gstApplicable || line.taxType === 'none'} value={line.gstRate} onChange={(event) => updateLine(line.id, { gstRate: event.target.value })} /><output className="invoice-line-amount">{money(Number.isFinite(amount + gst) ? amount + gst : 0)}</output><button className="invoice-remove" type="button" onClick={() => setLines((current) => current.length > 1 ? current.filter((item) => item.id !== line.id) : [newLine()])}>Remove</button></div>;
      })}</div><div className="invoice-totals"><span>Subtotal: <strong>{money(preview.subtotal)}</strong></span><span>GST: <strong>{money(preview.gst)}</strong></span><span>Total: <strong>{money(preview.subtotal + preview.gst)}</strong></span></div>{supply && <p className="hint invoice-supply">{supply.sellerRegistered ? <>Issued as a <strong>{draftType}</strong>. Seller state {stateName(supply.sellerStateCode)}, place of supply {supply.placeOfSupplyState || 'not set'}: {supply.taxSplit === 'intra' ? 'CGST + SGST' : 'IGST'} is preselected.</> : <>Issued as a <strong>Bill of Supply</strong>. Your company has no GSTIN yet, so no tax split is preselected.</>}</p>}{supplyError && <p className="form-error">{supplyError}</p>}{overridden && <label className="field"><span>Tax split override reason <b>*</b></span><textarea className="textarea" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>}</section>
      <section className="invoice-details"><label className="invoice-checkbox"><input type="checkbox" checked={gstApplicable} onChange={(event) => setGstApplicable(event.target.checked)} /> GST Applicable</label><div className="form-grid"><label className="field"><span>Customer PAN</span><input className="input" value={customerPan} onChange={(event) => setCustomerPan(event.target.value.toUpperCase())} /></label><label className="field"><span>Customer GST No</span><input className="input" placeholder="Blank for an unregistered customer" value={customerGstin} onChange={(event) => setCustomerGstin(event.target.value.toUpperCase())} /></label>{source === 'new' && !gstinInput && <StateSelect label="Billing state" value={newCustomer.stateCode} blankLabel="Not set" onChange={(value) => setNewCustomer({ ...newCustomer, stateCode: value })} />}<label className="field full"><span>Billing Address</span><textarea className="textarea" value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} /></label></div></section>
      <label className="field"><span>Notes</span><textarea className="textarea" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      {invoice && <label className="field"><span>Correction reason <b>*</b></span><textarea className="textarea" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div><div className="toolbar dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Close</button><button className="button button-primary" disabled={saving || (!invoice && source === 'existing' && !selectedCustomer) || (invoice !== null && !reason.trim())}>{saving ? 'Saving...' : invoice ? 'Issue corrected invoice' : 'Create Invoice'}</button></div>
  </form></div>;
}
