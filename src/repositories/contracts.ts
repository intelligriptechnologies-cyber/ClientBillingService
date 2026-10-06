import type { Actor, Client, ClientStatus, Invoice, InvoiceLine, InvoiceStatus, Payment, PaymentMethod, Settings } from '@/domain/types';

export type Page<T> = { items: T[]; total: number };
export type DateRange = { from?: string; to?: string };
export type ClientListQuery = { search?: string; includeArchived?: boolean };
export type InvoiceListQuery = DateRange & { search?: string; clientId?: string; status?: InvoiceStatus };
export type PaymentListQuery = DateRange & { clientId?: string; method?: PaymentMethod };
export type CreateClientInput = Pick<Client, 'displayName' | 'companyName' | 'email' | 'phone' | 'billingAddress' | 'note'>;
export type UpdateClientInput = CreateClientInput;
export type DraftInvoiceInput = { clientId: string; invoiceDate: string; dueDate: string; note?: string; lines: InvoiceLine[] };
export type RecordPaymentInput = Omit<Payment, 'id' | 'createdAt' | 'recordedBy'>;
export type UpdateSettingsInput = Omit<Settings, 'updatedAt'>;

export interface ClientRepository {
  list(query?: ClientListQuery): Promise<Page<Client>>;
  get(id: string): Promise<Client | null>;
  create(input: CreateClientInput, actor: Actor): Promise<Client>;
  update(id: string, input: UpdateClientInput, actor: Actor): Promise<Client>;
  setStatus(id: string, status: ClientStatus, actor: Actor): Promise<Client>;
}

export interface InvoiceRepository {
  list(query?: InvoiceListQuery): Promise<Page<Invoice>>;
  get(id: string): Promise<Invoice | null>;
  createDraft(input: DraftInvoiceInput, actor: Actor): Promise<Invoice>;
  updateDraft(id: string, input: DraftInvoiceInput, actor: Actor): Promise<Invoice>;
  deleteDraft(id: string, actor: Actor): Promise<void>;
  issue(id: string, actor: Actor): Promise<Invoice>;
  void(id: string, reason: string, actor: Actor): Promise<Invoice>;
}

export interface PaymentRepository {
  list(query?: PaymentListQuery): Promise<Page<Payment>>;
  record(input: RecordPaymentInput, actor: Actor): Promise<Payment>;
}

export interface SettingsRepository { get(): Promise<Settings>; update(input: UpdateSettingsInput, actor: Actor): Promise<Settings>; }
export interface BillingRepositories { clients: ClientRepository; invoices: InvoiceRepository; payments: PaymentRepository; settings: SettingsRepository; }
