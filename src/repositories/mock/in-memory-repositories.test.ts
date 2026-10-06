import { describe, expect, it } from 'vitest';
import { DomainError } from '@/domain/types';
import { createMockRepositories, type MockBillingData } from './in-memory-repositories';

const admin = { id: 'a1', name: 'Admin', role: 'admin' as const };
const billing = { id: 'b1', name: 'Billing', role: 'billing' as const };
const viewer = { id: 'v1', name: 'Viewer', role: 'viewer' as const };
const fixture = (): MockBillingData => ({
  settings: { businessName: 'Example', currencyCode: 'INR', invoiceNumberPrefix: 'EX', defaultPaymentTermsDays: 14, updatedAt: '2026-01-01T00:00:00Z' },
  clients: [{ id: 'c1', displayName: 'Client', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  invoices: [], payments: [],
});

describe('in-memory repositories', () => {
  it('uses asynchronous contracts while enforcing draft lifecycle and invoice numbering', async () => {
    const repositories = createMockRepositories(fixture());
    const draft = await repositories.invoices.createDraft({ clientId: 'c1', invoiceDate: '2026-01-01', dueDate: '2026-01-15', lines: [{ id: 'l1', description: 'Work', quantity: 1, unitPriceMinor: 1000, lineTotalMinor: 1000 }] }, billing);
    expect(draft.status).toBe('draft');
    const issued = await repositories.invoices.issue(draft.id, billing);
    expect(issued.invoiceNumber).toBe('EX-0001');
    await expect(repositories.invoices.updateDraft(draft.id, { clientId: 'c1', invoiceDate: '2026-01-01', dueDate: '2026-01-15', lines: [] }, billing)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects forbidden and overpayment operations at the repository boundary', async () => {
    const repositories = createMockRepositories(fixture());
    await expect(repositories.clients.create({ displayName: 'No access' }, viewer)).rejects.toBeInstanceOf(DomainError);
    const draft = await repositories.invoices.createDraft({ clientId: 'c1', invoiceDate: '2026-01-01', dueDate: '2026-01-15', lines: [{ id: 'l1', description: 'Work', quantity: 1, unitPriceMinor: 1000, lineTotalMinor: 1000 }] }, admin);
    await repositories.invoices.issue(draft.id, admin);
    await expect(repositories.payments.record({ invoiceId: draft.id, paymentDate: '2026-01-02', amountMinor: 1001, method: 'cash' }, billing)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
