import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import type { AppSession, DeliveryInput, DeliveryRecord, DeliveryStatus } from './types';

const statuses: readonly DeliveryStatus[] = ['sent', 'failed', 'not-configured'];
const split = (value: unknown) => String(value).split(',').filter(Boolean);

function deliveryFromRow(row: Record<string, unknown>): DeliveryRecord {
  return { id: String(row.id), invoiceId: String(row.invoice_id), channel: 'email', to: split(row.to_address), cc: split(row.cc_address), subject: String(row.subject), status: row.status as DeliveryStatus, error: String(row.error), attemptedAt: String(row.attempted_at), attemptedBy: String(row.attempted_by), attemptedByName: String(row.attempted_by_name ?? '') };
}

export function createDeliveryMethods(database: DatabaseSync) {
  function requireOwnInvoice(session: AppSession & { tenantId: string }, invoiceId: string) {
    if (!database.prepare('SELECT 1 FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, session.tenantId)) throw new Error('Invoice not found.');
  }
  const select = 'SELECT delivery_log.*, users.name AS attempted_by_name FROM delivery_log LEFT JOIN users ON users.id = delivery_log.attempted_by';
  return {
    recordDelivery(session: AppSession, input: DeliveryInput): DeliveryRecord {
      requireTenantMember(session); requireOwnInvoice(session, input.invoiceId);
      if (!statuses.includes(input.status)) throw new Error('Unknown delivery status.');
      const id = `delivery-${crypto.randomUUID()}`;
      database.prepare('INSERT INTO delivery_log (id, tenant_id, invoice_id, channel, to_address, cc_address, subject, status, error, attempted_at, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, session.tenantId, input.invoiceId, 'email', input.to.join(','), input.cc.join(','), input.subject, input.status, input.error, now(), session.id);
      return deliveryFromRow(database.prepare(`${select} WHERE delivery_log.id = ? AND delivery_log.tenant_id = ?`).get(id, session.tenantId) as Record<string, unknown>);
    },
    listDeliveries(session: AppSession, invoiceId: string): DeliveryRecord[] {
      requireTenantMember(session); requireOwnInvoice(session, invoiceId);
      return (database.prepare(`${select} WHERE delivery_log.tenant_id = ? AND delivery_log.invoice_id = ? ORDER BY delivery_log.attempted_at DESC, delivery_log.rowid DESC`).all(session.tenantId, invoiceId) as Record<string, unknown>[]).map(deliveryFromRow);
    },
  };
}
