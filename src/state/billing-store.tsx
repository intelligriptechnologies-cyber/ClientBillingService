'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { deriveInvoiceStatus, outstandingForInvoice, paidForInvoice } from '@/domain/billing';
import { DomainError } from '@/domain/types';
import { createMockRepositories } from '@/repositories/mock';
import type { Actor, Client, Invoice, InvoiceLine, Payment, Role, Settings } from '@/domain/types';

type BillingState = { clients: Client[]; invoices: Invoice[]; payments: Payment[]; settings: Settings; role: Role };
type ClientInput = Pick<Client, 'displayName' | 'companyName' | 'email' | 'phone' | 'billingAddress' | 'note'>;
type DraftInput = { clientId: string; invoiceDate: string; dueDate: string; note?: string; lines: InvoiceLine[] };
type BillingStore = BillingState & {
  actor: Actor; setRole(role: Role): void; addClient(input: ClientInput): Promise<string | null>; updateClient(id: string, input: ClientInput): Promise<string | null>;
  setClientStatus(id: string, status: Client['status']): Promise<string | null>; createDraft(input: DraftInput): Promise<string | null>; updateDraft(id: string, input: DraftInput): Promise<string | null>;
  deleteDraft(id: string): Promise<string | null>; issueInvoice(id: string): Promise<string | null>; voidInvoice(id: string, reason: string): Promise<string | null>;
  updateSettings(input: Omit<Settings, 'updatedAt'>): Promise<string | null>; addPayment(input: Omit<Payment, 'id' | 'createdAt' | 'recordedBy'>): Promise<string | null>;
};

const initial: Omit<BillingState, 'role'> = {
  settings: { businessName: 'Northstar Studio', currencyCode: 'INR', invoiceNumberPrefix: 'NST', defaultPaymentTermsDays: 14, updatedAt: '2026-10-01T09:00:00Z' },
  clients: [
    { id: 'c1', displayName: 'Aarav Mehta', companyName: 'Meridian Labs', email: 'aarav@meridian.example', phone: '+91 98765 43210', billingAddress: '18 Meridian Road, Bengaluru', status: 'active', createdAt: '2026-01-10T00:00:00Z', updatedAt: '2026-01-10T00:00:00Z' },
    { id: 'c2', displayName: 'Nisha Rao', companyName: 'Canvas & Co.', email: 'nisha@canvas.example', status: 'active', createdAt: '2026-02-12T00:00:00Z', updatedAt: '2026-02-12T00:00:00Z' },
    { id: 'c3', displayName: 'Kabir Shah', companyName: 'Fieldwork', email: 'kabir@fieldwork.example', status: 'active', createdAt: '2026-03-02T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
    { id: 'c4', displayName: 'Leena Bose', companyName: 'Nostrum Design', email: 'leena@nostrum.example', status: 'archived', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z' },
  ],
  invoices: [
    { id: 'i1', clientId: 'c1', invoiceNumber: 'NST-0024', invoiceDate: '2026-09-04', dueDate: '2026-09-18', status: 'overdue', lines: [{ id: 'l1', description: 'Strategy workshop', quantity: 1, unitPriceMinor: 450000, lineTotalMinor: 450000 }], totalMinor: 450000, issuedAt: '2026-09-04T08:30:00Z', createdAt: '2026-09-04T08:00:00Z', updatedAt: '2026-09-04T08:30:00Z' },
    { id: 'i2', clientId: 'c2', invoiceNumber: 'NST-0025', invoiceDate: '2026-09-20', dueDate: '2026-10-10', status: 'partial', lines: [{ id: 'l2', description: 'Interface system', quantity: 1, unitPriceMinor: 900000, lineTotalMinor: 900000 }], totalMinor: 900000, issuedAt: '2026-09-20T09:00:00Z', createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z' },
    { id: 'i3', clientId: 'c3', invoiceNumber: 'NST-0026', invoiceDate: '2026-10-01', dueDate: '2026-10-15', status: 'issued', lines: [{ id: 'l3', description: 'Research sprint', quantity: 2, unitPriceMinor: 150000, lineTotalMinor: 300000 }], totalMinor: 300000, issuedAt: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-01T09:00:00Z' },
    { id: 'i4', clientId: 'c1', invoiceNumber: 'NST-0027', invoiceDate: '2026-09-01', dueDate: '2026-09-15', status: 'paid', lines: [{ id: 'l4', description: 'Brand audit', quantity: 1, unitPriceMinor: 125000, lineTotalMinor: 125000 }], totalMinor: 125000, issuedAt: '2026-09-01T09:00:00Z', createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z' },
    { id: 'i5', clientId: 'c2', invoiceNumber: 'NST-0028', invoiceDate: '2026-09-10', dueDate: '2026-09-24', status: 'void', lines: [{ id: 'l5', description: 'Cancelled discovery', quantity: 1, unitPriceMinor: 80000, lineTotalMinor: 80000 }], totalMinor: 80000, issuedAt: '2026-09-10T09:00:00Z', voidReason: 'Client cancelled the engagement', voidedBy: 'u1', voidedAt: '2026-09-11T10:00:00Z', createdAt: '2026-09-10T09:00:00Z', updatedAt: '2026-09-11T10:00:00Z' },
    { id: 'i6', clientId: 'c3', invoiceDate: '2026-10-06', dueDate: '2026-10-20', status: 'draft', lines: [{ id: 'l6', description: 'Content review', quantity: 1, unitPriceMinor: 60000, lineTotalMinor: 60000 }], totalMinor: 60000, createdAt: '2026-10-06T09:00:00Z', updatedAt: '2026-10-06T09:00:00Z' },
  ],
  payments: [
    { id: 'p1', invoiceId: 'i2', paymentDate: '2026-09-29', amountMinor: 350000, method: 'bank_transfer', reference: 'UTR-2291', recordedBy: 'u1', createdAt: '2026-09-29T12:00:00Z' },
    { id: 'p2', invoiceId: 'i4', paymentDate: '2026-09-12', amountMinor: 125000, method: 'card', recordedBy: 'u1', createdAt: '2026-09-12T12:00:00Z' },
  ],
};

const Context = createContext<BillingStore | null>(null);

export function BillingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BillingState>({ ...initial, role: 'billing' });
  const actor = useMemo<Actor>(() => ({ id: 'u1', name: 'Samira Patel', role: state.role }), [state.role]);
  const repositories = useMemo(() => createMockRepositories({ clients: state.clients, invoices: state.invoices, payments: state.payments, settings: state.settings }), [state.clients, state.invoices, state.payments, state.settings]);
  const refresh = useCallback(() => setState((current) => ({ ...current, clients: [...current.clients], invoices: [...current.invoices], payments: [...current.payments], settings: { ...current.settings } })), []);
  const perform = useCallback(async (operation: () => Promise<unknown>) => { try { await operation(); refresh(); return null; } catch (error) { return error instanceof DomainError ? error.message : 'Unable to complete this action.'; } }, [refresh]);
  const value = useMemo<BillingStore>(() => ({
    ...state, actor,
    setRole: (role) => setState((current) => ({ ...current, role })),
    addClient: (input) => perform(() => repositories.clients.create(input, actor)),
    updateClient: (id, input) => perform(() => repositories.clients.update(id, input, actor)),
    setClientStatus: (id, status) => perform(() => repositories.clients.setStatus(id, status, actor)),
    createDraft: (input) => perform(() => repositories.invoices.createDraft(input, actor)),
    updateDraft: (id, input) => perform(() => repositories.invoices.updateDraft(id, input, actor)),
    deleteDraft: (id) => perform(() => repositories.invoices.deleteDraft(id, actor)),
    issueInvoice: (id) => perform(() => repositories.invoices.issue(id, actor)),
    voidInvoice: (id, reason) => perform(() => repositories.invoices.void(id, reason, actor)),
    updateSettings: (input) => perform(() => repositories.settings.update(input, actor)),
    addPayment: (input) => perform(() => repositories.payments.record(input, actor)),
  }), [actor, perform, repositories, state]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBilling() { const value = useContext(Context); if (!value) throw new Error('BillingProvider is missing'); return value; }
export { paidForInvoice, outstandingForInvoice, deriveInvoiceStatus };
