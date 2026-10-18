import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { actorId, now } from './shared';
import { parseDeliveryRow } from './rows';
import { checkDeliveryStatus, INVOICE_NOT_FOUND } from './rules';
import type { DeliveryInput, DeliveryRecord } from './types';

type Row = Record<string, unknown>;

export function createDeliveryMethods(database: DatabaseSync) {
  function requireOwnInvoice(tenantId: string, invoiceId: string) {
    if (!database.prepare('SELECT 1 FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId)) throw new Error(INVOICE_NOT_FOUND);
  }
  const select = 'SELECT delivery_log.*, users.name AS attempted_by_name FROM delivery_log LEFT JOIN users ON users.id = delivery_log.attempted_by';
  return {
    recordDelivery(context: TenantContext, input: DeliveryInput): DeliveryRecord {
      requireOwnInvoice(context.tenantId, input.invoiceId);
      checkDeliveryStatus(input.status);
      const id = `delivery-${crypto.randomUUID()}`;
      database.prepare('INSERT INTO delivery_log (id, tenant_id, invoice_id, channel, to_address, cc_address, subject, status, error, attempted_at, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, context.tenantId, input.invoiceId, 'email', input.to.join(','), input.cc.join(','), input.subject, input.status, input.error, now(), actorId(context));
      return parseDeliveryRow(database.prepare(`${select} WHERE delivery_log.id = ? AND delivery_log.tenant_id = ?`).get(id, context.tenantId) as Row);
    },
    listDeliveries(context: TenantContext, invoiceId: string): DeliveryRecord[] {
      requireOwnInvoice(context.tenantId, invoiceId);
      return (database.prepare(`${select} WHERE delivery_log.tenant_id = ? AND delivery_log.invoice_id = ? ORDER BY delivery_log.attempted_at DESC, delivery_log.rowid DESC`).all(context.tenantId, invoiceId) as Row[]).map(parseDeliveryRow);
    },
  };
}
