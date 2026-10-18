import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseDeliveryRow } from '../rows';
import { checkDeliveryStatus, INVOICE_NOT_FOUND } from '../rules';
import { actorId } from '../shared';
import type { DeliveryInput, DeliveryRecord, TenantStore } from '../types';

type Row = Record<string, unknown>;

const withAttempter = 'SELECT delivery_log.*, users.name AS attempted_by_name FROM delivery_log LEFT JOIN users ON users.tenant_id = delivery_log.tenant_id AND users.id = delivery_log.attempted_by';

async function requireOwnInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  if (!(await tx.query('SELECT 1 FROM invoices WHERE id = $1 AND tenant_id = $2', [invoiceId, tenantId])).rows[0]) throw new Error(INVOICE_NOT_FOUND);
}

export function createPgDeliveryMethods(db: Database) {
  return {
    /** clock_timestamp() rather than now(): attempts made in quick succession still sort in the order made, where SQLite breaks ties on rowid. */
    async recordDelivery(context: TenantContext, input: DeliveryInput): Promise<DeliveryRecord> {
      return db.withTenant(context.tenantId, async (tx) => {
        await requireOwnInvoice(tx, context.tenantId, input.invoiceId);
        checkDeliveryStatus(input.status);
        const id = `delivery-${crypto.randomUUID()}`;
        await tx.query(
          `INSERT INTO delivery_log (id, tenant_id, invoice_id, channel, to_address, cc_address, subject, status, error, attempted_at, attempted_by) VALUES ($1, $2, $3, 'email', $4, $5, $6, $7, $8, clock_timestamp(), $9)`,
          [id, context.tenantId, input.invoiceId, input.to.join(','), input.cc.join(','), input.subject, input.status, input.error, actorId(context)],
        );
        return parseDeliveryRow((await tx.query<Row>(`${withAttempter} WHERE delivery_log.id = $1 AND delivery_log.tenant_id = $2`, [id, context.tenantId])).rows[0]);
      });
    },
    async listDeliveries(context: TenantContext, invoiceId: string): Promise<DeliveryRecord[]> {
      return db.withTenant(context.tenantId, async (tx) => {
        await requireOwnInvoice(tx, context.tenantId, invoiceId);
        const { rows } = await tx.query<Row>(`${withAttempter} WHERE delivery_log.tenant_id = $1 AND delivery_log.invoice_id = $2 ORDER BY delivery_log.attempted_at DESC, delivery_log.id COLLATE "C" DESC`, [context.tenantId, invoiceId]);
        return rows.map(parseDeliveryRow);
      });
    },
  } satisfies Partial<TenantStore>;
}
