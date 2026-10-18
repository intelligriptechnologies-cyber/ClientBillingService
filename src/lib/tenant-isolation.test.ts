import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsInput } from '@/lib/test-helpers';
import { createTenantStore, type AppSession } from '@/lib/tenant-store';

import * as additionalServices from '../app/api/additional-services/route';
import * as additionalService from '../app/api/additional-services/[additionalServiceId]/route';
import * as contracts from '../app/api/contracts/route';
import * as contract from '../app/api/contracts/[contractId]/route';
import * as customers from '../app/api/customers/route';
import * as customer from '../app/api/customers/[customerId]/route';
import * as deposits from '../app/api/deposits/route';
import * as invoiceFormats from '../app/api/invoice-formats/route';
import * as invoiceFormat from '../app/api/invoice-formats/[formatId]/route';
import * as invoiceFormatDefault from '../app/api/invoice-formats/[formatId]/default/route';
import * as invoices from '../app/api/invoices/route';
import * as invoiceBulk from '../app/api/invoices/bulk/route';
import * as invoiceBulkDownload from '../app/api/invoices/bulk/download/route';
import * as invoice from '../app/api/invoices/[invoiceId]/route';
import * as invoiceDownload from '../app/api/invoices/[invoiceId]/download/route';
import * as invoiceHtml from '../app/api/invoices/[invoiceId]/html/route';
import * as invoiceSend from '../app/api/invoices/[invoiceId]/send/route';
import * as invoiceDeliveries from '../app/api/invoices/[invoiceId]/deliveries/route';
import * as logs from '../app/api/logs/route';
import * as payments from '../app/api/payments/route';
import * as paymentsDownload from '../app/api/payments/download/route';
import * as payment from '../app/api/payments/[paymentId]/route';
import * as pendingPayments from '../app/api/pending-payments/route';
import * as pendingClose from '../app/api/pending-payments/[invoiceId]/close/route';
import * as pendingReminders from '../app/api/pending-payments/[invoiceId]/reminders/route';
import * as quotations from '../app/api/quotations/route';
import * as quotation from '../app/api/quotations/[quotationId]/route';
import * as quotationDownload from '../app/api/quotations/[quotationId]/download/route';
import * as renewals from '../app/api/renewals/route';
import * as renewal from '../app/api/renewals/[contractId]/route';
import * as gstReport from '../app/api/reports/gst/route';
import * as services from '../app/api/services/route';
import * as service from '../app/api/services/[serviceId]/route';
import * as settings from '../app/api/settings/route';
import * as settingsPreview from '../app/api/settings/preview/route';
import * as smtpTest from '../app/api/settings/smtp-test/route';
import * as taskNotes from '../app/api/task-notes/route';
import * as taskNote from '../app/api/task-notes/[noteId]/route';
import * as tenants from '../app/api/tenants/route';
import * as tenant from '../app/api/tenants/[tenantId]/route';
import * as tenantHistory from '../app/api/tenants/[tenantId]/history/route';
import * as users from '../app/api/users/route';
import * as user from '../app/api/users/[userId]/route';

type Store = ReturnType<typeof createTenantStore>;

const formatDefinition = { layout: 'compact', blocks: { hsnSac: false, bankDetails: true, upiQr: false, signature: true, stamp: true, terms: true, amountInWords: true }, accent: '#1f3a5f', logo: 'show', bankDetails: '', terms: '' };

const world = vi.hoisted(() => ({ store: undefined as unknown, session: null as unknown }));

vi.mock('@/lib/session', () => ({ sessionCookie: 'test', getCurrentSession: async () => world.session }));
vi.mock('@/lib/operational-error', () => ({ recordOperationException: () => undefined }));
vi.mock('@/lib/tenant-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-store')>()),
  getTenantStore: () => world.store,
}));

type Reply = { status: number; text: string };
type Handler = (request: Request, context: never) => Promise<Response> | Response;
type Fixtures = ReturnType<typeof seedTenantA>;

let store: Store;
let tenantA: AppSession;
let tenantB: AppSession;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture');
  return value;
}

const SMTP_SECRET = 'nexio-smtp-secret-9f3a';

function seedTenantA(session: AppSession) {
  store.updateTenantSettings(session, { ...settingsInput(store.getTenantSettings(session)), smtpHost: 'smtp.nexio-secret.example', smtpFrom: 'billing@nexio-secret.example', smtpUser: 'nexio-smtp-user', smtpPassword: SMTP_SECRET });
  const customerId = must(store.listCustomers(session).items[0]).id;
  const contractId = must(store.listContracts(session).items[0]).id;
  const serviceId = must(store.listServices(session).find((item) => item.status === 'active')).id;
  const pending = must(store.listPendingPayments(session)[0]);
  const additionalServiceId = store.createAdditionalService(session, { customerId, contractId, serviceDate: '2026-10-05', description: 'Nexio-secret extra work', priceMinor: 5000 }).id;
  const noteId = store.createTaskNote(session, { customerId, date: '2026-10-05', note: 'Nexio-secret note' }).id;
  const quotationId = store.createQuotation(session, { customerName: 'Nexio-secret prospect', lines: [{ serviceId, frequency: 'monthly', quantity: 1 }] }).id;
  const userId = store.createTenantUser(session, { name: 'Nexio-secret colleague', email: 'secret@nexio.example', role: 'user' }).id;
  const formatId = store.createInvoiceFormat(session, { name: 'Nexio-secret format', definition: formatDefinition }).id;
  store.recordOperationalError(session, 'nexio-secret-operation', new Error('Nexio-secret failure'));
  const deliveryId = store.recordDelivery(session, { invoiceId: pending.id, to: ['secret-recipient@nexio-secret.example'], cc: [], subject: 'Nexio-secret subject', status: 'sent', error: '' }).id;
  return {
    customerId, contractId, serviceId, additionalServiceId, noteId, quotationId, userId, formatId, deliveryId,
    invoiceId: pending.id,
    invoiceNumber: pending.invoiceNumber,
    paymentId: must(store.listPayments(session).items[0]).id,
    depositId: must(store.listSecurityDeposits(session)[0]).id,
  };
}

function snapshot(session: AppSession) {
  const query = { pageSize: 1000 };
  const contractItems = store.listContracts(session, query).items;
  return {
    customers: store.listCustomers(session, query), contracts: contractItems, invoices: store.listInvoices(session, query),
    payments: store.listPayments(session, query), pending: store.listPendingPayments(session), deposits: store.listSecurityDeposits(session),
    renewals: store.listRenewals(session, query), services: store.listServices(session), additional: store.listAdditionalServices(session, query),
    quotations: store.listQuotations(session), notes: store.listTaskNotes(session), users: store.listTenantUsers(session),
    logs: store.listOperationalLogs(session), settings: store.getTenantSettings(session), bulkRuns: store.listBulkInvoiceRuns(session), formats: store.listInvoiceFormats(session),
    audit: contractItems.map((item) => store.listContractAudit(session, item.id)),
    deliveries: store.listInvoices(session, query).items.map((item) => store.listDeliveries(session, item.id)),
    smtp: store.getSmtpSettings(session),
  };
}

function collectIds(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectIds(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^id$|Id$|Ids$/.test(key)) [child].flat().forEach((id) => typeof id === 'string' && id && found.add(id));
      collectIds(child, found);
    }
  }
  return found;
}

async function call(handler: Handler, as: AppSession, init: { url?: string; method?: string; body?: unknown; params?: Record<string, string> } = {}): Promise<Reply> {
  world.session = as;
  const request = new Request(`http://localhost${init.url ?? '/'}`, { method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body), headers: { 'content-type': 'application/json' } });
  const response = await (handler as (request: Request, context: unknown) => Promise<Response> | Response)(request, { params: Promise.resolve(init.params ?? {}) });
  return { status: response.status, text: await response.text() };
}

let captureDirectory: string; let captureFile: string;

beforeEach(() => {
  store = createTenantStore(':memory:');
  world.store = store;
  tenantA = must(store.authenticate('nexio-admin'));
  tenantB = must(store.authenticate('evo-admin'));
  captureDirectory = mkdtempSync(join(tmpdir(), 'isolation-mail-')); captureFile = join(captureDirectory, 'mail-capture.json');
  vi.stubEnv('CLIENT_BILLING_MAIL_TRANSPORT', 'capture'); vi.stubEnv('CLIENT_BILLING_MAIL_CAPTURE_FILE', captureFile);
});

afterEach(() => { store.close(); vi.unstubAllEnvs(); rmSync(captureDirectory, { recursive: true, force: true }); });

const customerBody = { companyName: 'Hijacked Co', contactName: 'Mallory', email: 'm@evil.example', phone: '1', gstin: '', billingAddress: 'Evil street', invoiceDelivery: 'manual' };
const contractBody = (f: Fixtures) => ({ name: 'Cross-tenant contract', customerId: f.customerId, serviceIds: [f.serviceId], startDate: '2026-01-01', endDate: '2026-12-31', valueMinor: 1000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1, escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0 });

type Kind = 'deliveries' | 'invoice formats' | 'customers' | 'contracts' | 'invoices' | 'payments' | 'deposits' | 'renewals' | 'services' | 'additional services' | 'quotations' | 'task notes' | 'users' | 'logs';
type Case = { kind: Kind; name: string; run: (as: AppSession, f: Fixtures) => Promise<Reply>; owns?: (f: Fixtures) => string; read?: boolean; leak?: string };

const id = (key: keyof Fixtures) => (f: Fixtures) => String(f[key]);
const cases: Case[] = [
  { kind: 'customers', name: 'GET /api/customers lists', owns: id('customerId'), run: (as) => call(customers.GET, as, { url: '/?pageSize=100' }) },
  { kind: 'customers', name: 'PATCH /api/customers/[id] updates', run: (as, f) => call(customer.PATCH, as, { method: 'PATCH', body: customerBody, params: { customerId: f.customerId } }) },
  { kind: 'customers', name: 'PATCH /api/customers/[id] changes status', run: (as, f) => call(customer.PATCH, as, { method: 'PATCH', body: { status: 'inactive' }, params: { customerId: f.customerId } }) },
  { kind: 'contracts', name: 'GET /api/contracts lists', owns: id('contractId'), run: (as) => call(contracts.GET, as, { url: '/?pageSize=100' }) },
  { kind: 'contracts', name: 'GET /api/contracts filtered by foreign customerId', owns: id('contractId'), run: (as, f) => call(contracts.GET, as, { url: `/?customerId=${f.customerId}` }) },
  { kind: 'contracts', name: 'PATCH /api/contracts/[id] updates', run: (as, f) => call(contract.PATCH, as, { method: 'PATCH', body: { name: 'Hijacked' }, params: { contractId: f.contractId } }) },
  { kind: 'contracts', name: 'POST /api/contracts with foreign customer and service', run: (as, f) => call(contracts.POST, as, { method: 'POST', body: contractBody(f) }) },
  { kind: 'invoices', name: 'GET /api/invoices lists', owns: id('invoiceId'), run: (as) => call(invoices.GET, as, { url: '/?pageSize=100' }) },
  { kind: 'invoices', name: 'GET /api/invoices/[id] reads', run: (as, f) => call(invoice.GET, as, { params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'GET /api/invoices/[id]/download reads pdf', run: (as, f) => call(invoiceDownload.GET, as, { params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'GET /api/invoices/[id]/html reads preview', run: (as, f) => call(invoiceHtml.GET, as, { params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'PATCH /api/invoices/[id] voids', run: (as, f) => call(invoice.PATCH, as, { method: 'PATCH', body: { status: 'void', reason: 'hijack' }, params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'PATCH /api/invoices/[id] corrects', run: (as, f) => call(invoice.PATCH, as, { method: 'PATCH', body: { reason: 'hijack', correction: { customerId: f.customerId, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 100 } }, params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'POST /api/invoices with foreign customer', run: (as, f) => call(invoices.POST, as, { method: 'POST', body: { customerId: f.customerId, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 100 } }) },
  { kind: 'invoices', name: 'POST /api/invoices with foreign contract', run: (as, f) => call(invoices.POST, as, { method: 'POST', body: { contractId: f.contractId, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 100 } }) },
  { kind: 'deliveries', name: 'GET /api/invoices/[id]/deliveries lists', run: (as, f) => call(invoiceDeliveries.GET, as, { params: { invoiceId: f.invoiceId } }) },
  { kind: 'deliveries', name: 'POST /api/invoices/[id]/send emails', run: (as, f) => call(invoiceSend.POST, as, { method: 'POST', body: {}, params: { invoiceId: f.invoiceId } }) },
  { kind: 'deliveries', name: 'POST /api/invoices/[id]/send with a recipient and message', run: (as, f) => call(invoiceSend.POST, as, { method: 'POST', body: { to: 'ap@acme.example', cc: 'boss@acme.example', message: 'Hijacked' }, params: { invoiceId: f.invoiceId } }) },
  { kind: 'deliveries', name: 'POST /api/settings/smtp-test tests only the caller settings', run: (as) => call(smtpTest.POST, as, { method: 'POST' }) },
  { kind: 'invoice formats', name: 'GET /api/invoice-formats lists', owns: id('formatId'), run: (as) => call(invoiceFormats.GET, as) },
  { kind: 'invoice formats', name: 'PUT /api/invoice-formats/[id] updates', run: (as, f) => call(invoiceFormat.PUT, as, { method: 'PUT', body: { name: 'Hijacked', definition: formatDefinition }, params: { formatId: f.formatId } }) },
  { kind: 'invoice formats', name: 'DELETE /api/invoice-formats/[id] deletes', run: (as, f) => call(invoiceFormat.DELETE, as, { method: 'DELETE', params: { formatId: f.formatId } }) },
  { kind: 'invoice formats', name: 'POST /api/invoice-formats/[id]/default makes default', run: (as, f) => call(invoiceFormatDefault.POST, as, { method: 'POST', params: { formatId: f.formatId } }) },
  { kind: 'invoice formats', name: 'PATCH /api/customers/[id] with foreign formatId', run: (as, f) => call(customer.PATCH, as, { method: 'PATCH', body: { ...customerBody, invoiceFormatId: f.formatId }, params: { customerId: must(store.listCustomers(as).items[0]).id } }) },
  { kind: 'invoice formats', name: 'POST /api/invoices with foreign formatId', run: (as, f) => call(invoices.POST, as, { method: 'POST', body: { customerId: must(store.listCustomers(as).items[0]).id, formatId: f.formatId, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 100 } }) },
  { kind: 'invoices', name: 'GET /api/pending-payments lists', owns: id('invoiceId'), run: (as) => call(pendingPayments.GET, as) },
  { kind: 'invoices', name: 'POST /api/pending-payments/[id]/close', run: (as, f) => call(pendingClose.POST, as, { method: 'POST', body: { note: 'hijack' }, params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'POST /api/pending-payments/[id]/reminders', run: (as, f) => call(pendingReminders.POST, as, { method: 'POST', body: { channel: 'email', note: 'hijack' }, params: { invoiceId: f.invoiceId } }) },
  { kind: 'invoices', name: 'GET /api/invoices/bulk previews only own contracts', owns: id('contractId'), run: (as) => call(invoiceBulk.GET, as, { url: '/?period=2026-10' }) },
  { kind: 'invoices', name: 'GET /api/invoices/bulk/download previews only own contracts', read: true, run: (as) => call(invoiceBulkDownload.GET, as, { url: '/?period=2026-10' }) },
  { kind: 'invoices', name: 'GET /api/reports/gst reports only own invoices', owns: id('invoiceId'), run: (as) => call(gstReport.GET, as, { url: '/?month=2026-10' }) },
  { kind: 'payments', name: 'GET /api/payments lists', owns: id('paymentId'), run: (as) => call(payments.GET, as, { url: '/?pageSize=100' }) },
  { kind: 'payments', name: 'GET /api/payments filtered by foreign customerId', owns: id('paymentId'), run: (as, f) => call(payments.GET, as, { url: `/?customerId=${f.customerId}` }) },
  { kind: 'payments', name: 'GET /api/payments/download exports only own payments', owns: () => 'Nexio Hyper Customer', run: (as) => call(paymentsDownload.GET, as) },
  { kind: 'payments', name: 'PATCH /api/payments/[id] updates', run: (as, f) => call(payment.PATCH, as, { method: 'PATCH', body: { method: 'cash', reference: 'hijack', notes: 'hijack' }, params: { paymentId: f.paymentId } }) },
  { kind: 'payments', name: 'POST /api/payments against foreign invoice', run: (as, f) => call(payments.POST, as, { method: 'POST', body: { invoiceId: f.invoiceId, paymentDate: '2026-10-08', amountMinor: 100, tdsMinor: 0, writeOffMinor: 0, method: 'cash' } }) },
  { kind: 'deposits', name: 'GET /api/deposits lists', owns: id('depositId'), run: (as) => call(deposits.GET, as) },
  { kind: 'deposits', name: 'POST /api/deposits settles', run: (as, f) => call(deposits.POST, as, { method: 'POST', body: { depositId: f.depositId, amountMinor: 1000, note: 'hijack' } }) },
  { kind: 'renewals', name: 'GET /api/renewals lists', owns: id('contractId'), run: (as) => call(renewals.GET, as, { url: '/?pageSize=100' }) },
  { kind: 'renewals', name: 'GET /api/renewals/[contractId] reads audit', run: (as, f) => call(renewal.GET, as, { params: { contractId: f.contractId } }) },
  { kind: 'renewals', name: 'POST /api/renewals/[contractId] renews', run: (as, f) => call(renewal.POST, as, { method: 'POST', body: { endDate: '2027-12-31', note: 'hijack' }, params: { contractId: f.contractId } }) },
  { kind: 'services', name: 'GET /api/services lists', owns: id('serviceId'), run: (as) => call(services.GET, as) },
  { kind: 'services', name: 'PATCH /api/services/[id] updates', run: (as, f) => call(service.PATCH, as, { method: 'PATCH', body: { name: 'Hijacked' }, params: { serviceId: f.serviceId } }) },
  { kind: 'additional services', name: 'GET /api/additional-services lists', owns: id('additionalServiceId'), run: (as) => call(additionalServices.GET, as, { url: '/?pageSize=100' }) },
  { kind: 'additional services', name: 'GET /api/additional-services filtered by foreign customerId and contractId', owns: id('additionalServiceId'), run: (as, f) => call(additionalServices.GET, as, { url: `/?customerId=${f.customerId}&contractId=${f.contractId}` }) },
  { kind: 'additional services', name: 'PATCH /api/additional-services/[id] updates', run: (as, f) => call(additionalService.PATCH, as, { method: 'PATCH', body: { description: 'Hijacked' }, params: { additionalServiceId: f.additionalServiceId } }) },
  { kind: 'additional services', name: 'POST /api/additional-services with foreign customer and contract', run: (as, f) => call(additionalServices.POST, as, { method: 'POST', body: { customerId: f.customerId, contractId: f.contractId, serviceDate: '2026-10-05', description: 'Planted', priceMinor: 100 } }) },
  { kind: 'quotations', name: 'GET /api/quotations lists', owns: id('quotationId'), run: (as) => call(quotations.GET, as) },
  { kind: 'quotations', name: 'PATCH /api/quotations/[id] updates', run: (as, f) => call(quotation.PATCH, as, { method: 'PATCH', body: { status: 'archived' }, params: { quotationId: f.quotationId } }) },
  { kind: 'quotations', name: 'GET /api/quotations/[id]/download reads pdf', run: (as, f) => call(quotationDownload.GET, as, { params: { quotationId: f.quotationId } }) },
  { kind: 'quotations', name: 'POST /api/quotations with foreign service', run: (as, f) => call(quotations.POST, as, { method: 'POST', body: { customerName: 'Planted', lines: [{ serviceId: f.serviceId, frequency: 'monthly', quantity: 1 }] } }) },
  { kind: 'task notes', name: 'GET /api/task-notes lists', owns: id('noteId'), run: (as) => call(taskNotes.GET, as) },
  { kind: 'task notes', name: 'GET /api/task-notes filtered by foreign customerId', owns: id('noteId'), run: (as, f) => call(taskNotes.GET, as, { url: `/?customerId=${f.customerId}` }) },
  { kind: 'task notes', name: 'PUT /api/task-notes/[id] updates', run: (as, f) => call(taskNote.PUT, as, { method: 'PUT', body: { customerId: f.customerId, date: '2026-10-05', note: 'Hijacked' }, params: { noteId: f.noteId } }) },
  { kind: 'task notes', name: 'DELETE /api/task-notes/[id] deletes', run: (as, f) => call(taskNote.DELETE, as, { method: 'DELETE', params: { noteId: f.noteId } }) },
  { kind: 'task notes', name: 'POST /api/task-notes with foreign customer', run: (as, f) => call(taskNotes.POST, as, { method: 'POST', body: { customerId: f.customerId, date: '2026-10-05', note: 'Planted' } }) },
  { kind: 'users', name: 'GET /api/users lists', owns: id('userId'), run: (as) => call(users.GET, as) },
  { kind: 'users', name: 'PATCH /api/users/[id] updates', run: (as, f) => call(user.PATCH, as, { method: 'PATCH', body: { name: 'Hijacked' }, params: { userId: f.userId } }) },
  { kind: 'users', name: 'PATCH /api/users/[id] disables', run: (as, f) => call(user.PATCH, as, { method: 'PATCH', body: { status: 'disabled' }, params: { userId: f.userId } }) },
  { kind: 'logs', name: 'GET /api/logs lists', owns: () => 'Nexio-secret failure', run: (as) => call(logs.GET, as) },
  { kind: 'logs', name: 'GET /api/settings reads', owns: () => 'Nexio Hyper', run: (as) => call(settings.GET, as) },
  { kind: 'logs', name: 'POST /api/settings/preview renders', owns: () => 'NEX-2026', run: (as) => call(settingsPreview.POST, as, { method: 'POST' }) },
];

describe.each(cases)('$kind: $name', (scenario) => {
  const knownLeak = scenario.leak;
  const isRead = Boolean(scenario.owns) || scenario.read === true;

  it('works for the owning tenant (control)', async () => {
    const fixtures = seedTenantA(tenantA);
    const reply = await scenario.run(tenantA, fixtures);
    expect(reply.status).toBeLessThan(400);
    if (scenario.owns) expect(reply.text).toContain(scenario.owns(fixtures));
  });

  (knownLeak ? it.fails : it)(`${knownLeak ? `LEAK ${knownLeak}: ` : ''}is not reachable from another tenant`, async () => {
    const fixtures = seedTenantA(tenantA);
    const before = snapshot(tenantA);
    const foreignIds = [...collectIds(before)];

    const reply = await scenario.run(tenantB, fixtures);

    if (isRead) expect(reply.status).toBeLessThan(400);
    else expect(reply.status).toBeGreaterThanOrEqual(400);
    for (const foreign of foreignIds) expect(reply.text).not.toContain(foreign);
    expect(reply.text).not.toContain('Nexio');
    expect(snapshot(tenantA)).toEqual(before);
    const bSnapshot = JSON.stringify(snapshot(tenantB));
    for (const foreign of foreignIds) expect(bSnapshot).not.toContain(foreign);
  });
});

describe('superadmin-only routes reject tenant sessions', () => {
  it.each([
    ['GET /api/tenants', () => call(tenants.GET, tenantB)],
    ['POST /api/tenants', () => call(tenants.POST, tenantB, { method: 'POST', body: { name: 'Rogue' } })],
    ['PATCH /api/tenants/[id]', () => call(tenant.PATCH, tenantB, { method: 'PATCH', body: { status: 'disabled' }, params: { tenantId: 'nexio' } })],
    ['GET /api/tenants/[id]/history', () => call(tenantHistory.GET, tenantB, { params: { tenantId: 'nexio' } })],
  ])('%s', async (_name, run) => {
    const before = snapshot(tenantA);
    expect((await run()).status).toBe(403);
    expect(store.authenticate('nexio-admin')).not.toBeNull();
    expect(snapshot(tenantA)).toEqual(before);
  });
});

describe('store functions reached by id without a route', () => {
  it('rejects every id-taking store call made with another tenant session', () => {
    const f = seedTenantA(tenantA);
    const before = snapshot(tenantA);
    const attempts: Array<[string, () => unknown]> = [
      ['getService', () => store.getService(tenantB, f.serviceId)],
      ['getQuotation', () => store.getQuotation(tenantB, f.quotationId)],
      ['getInvoice', () => store.getInvoice(tenantB, f.invoiceId)],
      ['getPayment', () => store.getPayment(tenantB, f.paymentId)],
      ['listDeliveries', () => store.listDeliveries(tenantB, f.invoiceId)],
      ['recordDelivery', () => store.recordDelivery(tenantB, { invoiceId: f.invoiceId, to: ['x@y.example'], cc: [], subject: 'planted', status: 'sent', error: '' })],
      ['getCustomer', () => store.getCustomer(tenantB, f.customerId)],
    ];
    for (const [name, run] of attempts) {
      let outcome: unknown;
      try { outcome = run(); } catch { outcome = null; }
      expect(outcome, name).toBeNull();
    }
    expect(snapshot(tenantA)).toEqual(before);
  });
});

describe('the delivery log and mail settings', () => {
  it('lists an invoice\'s deliveries to the owning tenant, with the defaults the send dialog needs', async () => {
    const f = seedTenantA(tenantA);
    const reply = await call(invoiceDeliveries.GET, tenantA, { params: { invoiceId: f.invoiceId } });
    const body = JSON.parse(reply.text) as { deliveries: Array<{ id: string; status: string; to: string[] }>; defaults: { to: string; subject: string; message: string; configured: boolean } };
    expect(body.deliveries.map((item) => item.id)).toEqual([f.deliveryId]);
    expect(body.defaults).toMatchObject({ to: 'billing@nexio.example', configured: true });
  });

  it('writes no delivery row and no captured message when another tenant sends a foreign invoice', async () => {
    const f = seedTenantA(tenantA);
    const before = snapshot(tenantA); const evoBefore = snapshot(tenantB);
    const reply = await call(invoiceSend.POST, tenantB, { method: 'POST', body: { to: 'ap@acme.example' }, params: { invoiceId: f.invoiceId } });
    expect(reply.status).toBe(404);
    expect(existsSync(captureFile)).toBe(false);
    expect(snapshot(tenantA)).toEqual(before);
    expect(snapshot(tenantB)).toEqual(evoBefore);
  });

  it('answers 400 and sends nothing when the request body is not valid JSON, and uses the defaults for an empty body', async () => {
    const f = seedTenantA(tenantA);
    world.session = tenantA;
    const send = (body: string) => invoiceSend.POST(new Request('http://localhost/', { method: 'POST', body }), { params: Promise.resolve({ invoiceId: f.invoiceId }) });
    expect((await send('{"to":"ap@acme.example"')).status).toBe(400);
    expect(existsSync(captureFile)).toBe(false);
    expect(store.listDeliveries(tenantA, f.invoiceId)).toHaveLength(1);
    expect((await send('')).status).toBe(200);
    expect(JSON.parse(readFileSync(captureFile, 'utf8'))[0].to).toEqual(['billing@nexio.example']);
  }, 30_000);

  it('delivers the owning tenant\'s message with the PDF through the capture transport', async () => {
    const f = seedTenantA(tenantA);
    const reply = await call(invoiceSend.POST, tenantA, { method: 'POST', body: { to: 'ap@acme.example' }, params: { invoiceId: f.invoiceId } });
    expect(reply.status).toBe(200);
    const captured = JSON.parse(readFileSync(captureFile, 'utf8')) as Array<{ to: string[]; from: string; attachments: Array<{ contentBase64: string }> }>;
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ to: ['ap@acme.example'], from: 'billing@nexio-secret.example' });
    expect(Buffer.from(captured[0].attachments[0].contentBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(store.listDeliveries(tenantA, f.invoiceId)).toHaveLength(2);
  }, 30_000);

  it('never returns the SMTP password from the settings or SMTP test routes, to its owner or anyone else', async () => {
    seedTenantA(tenantA);
    const input = settingsInput(store.getTenantSettings(tenantA));
    const replies = [
      await call(settings.GET, tenantA), await call(settings.PUT, tenantA, { method: 'PUT', body: { ...input, companyName: 'Nexio Renamed' } }),
      await call(settings.PUT, tenantA, { method: 'PUT', body: { ...input, smtpPassword: SMTP_SECRET } }), await call(smtpTest.POST, tenantA, { method: 'POST' }),
      await call(settings.GET, tenantB), await call(logs.GET, tenantA),
    ];
    for (const reply of replies) expect(reply.text).not.toContain(SMTP_SECRET);
    expect(JSON.parse(replies[0].text).settings).toMatchObject({ smtpUser: 'nexio-smtp-user', smtpPasswordSet: true });
    expect(store.getSmtpSettings(tenantA).password).toBe(SMTP_SECRET);
    expect(store.getSmtpSettings(tenantB).password).toBe('');
  });

  it('refuses a tenant user who tries to change SMTP settings', async () => {
    seedTenantA(tenantA);
    const user = must(store.authenticate('nexio-user'));
    const input = settingsInput(store.getTenantSettings(tenantA));
    expect((await call(settings.PUT, user, { method: 'PUT', body: { ...input, smtpPassword: 'planted' } })).status).toBeGreaterThanOrEqual(400);
    expect(store.getSmtpSettings(tenantA).password).toBe(SMTP_SECRET);
  });
});

describe('global uniqueness constraints do not disclose another tenant', () => {
  it.fails('LEAK users.email is globally UNIQUE: POST /api/users with another tenant email is refused, revealing it exists (tenant-store.ts:96,388)', async () => {
    const f = seedTenantA(tenantA);
    const taken = must(store.listTenantUsers(tenantA).find((item) => item.id === f.userId)).email;
    const reply = await call(users.POST, tenantB, { method: 'POST', body: { name: 'Same person, other tenant', email: taken, role: 'user' } });
    expect(reply.status).toBe(201);
  });

  it.fails('LEAK users.email is globally UNIQUE: PATCH /api/users/[id] to another tenant email is refused, revealing it exists (tenant-store.ts:96,406)', async () => {
    const f = seedTenantA(tenantA);
    const taken = must(store.listTenantUsers(tenantA).find((item) => item.id === f.userId)).email;
    const own = must(store.listTenantUsers(tenantB).find((item) => item.role === 'user'));
    const reply = await call(user.PATCH, tenantB, { method: 'PATCH', body: { email: taken }, params: { userId: own.id } });
    expect(reply.status).toBe(200);
  });

  it('PATCH /api/users/[id] to an unused email works (control)', async () => {
    const own = must(store.listTenantUsers(tenantB).find((item) => item.role === 'user'));
    expect((await call(user.PATCH, tenantB, { method: 'PATCH', body: { email: 'fresh@evo.example' }, params: { userId: own.id } })).status).toBe(200);
  });
});
