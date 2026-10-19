import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { BUILTIN_DEFINITION, parseFormatInput, resolveInvoiceFormat, type InvoiceFormat, type SnapshotFormat } from '../../invoice-format';
import { parseInvoiceFormatRow } from '../rows';
import { DEFAULT_FORMAT_DELETE_MESSAGE, DUPLICATE_FORMAT_MESSAGE, FORMAT_NOT_FOUND, standardFormatId } from '../rules';
import { now, requireAdminRole } from '../shared';
import type { TenantStore } from '../types';
import { actorRole, renameUniqueViolation } from './shared';

type Row = Record<string, unknown>;

/** The tenant's formats, default first, then by name, ignoring ASCII case. */
async function loadFormats(tx: Tx, tenantId: string): Promise<InvoiceFormat[]> {
  const { rows } = await tx.query<Row>('SELECT * FROM invoice_formats WHERE tenant_id = $1 ORDER BY is_default DESC, lower(name) COLLATE "C"', [tenantId]);
  return rows.map(parseInvoiceFormatRow);
}

/** The format an invoice is issued with. Throws when the chosen id is not one of the tenant's own formats. */
export async function resolveFormat(tx: Tx, tenantId: string, requestedId?: string | null, customerDefaultId?: string | null): Promise<SnapshotFormat> {
  return resolveInvoiceFormat(await loadFormats(tx, tenantId), { requestedId, customerDefaultId });
}

/** The id of a format only while it still exists, so a correction can keep the original format unless it was deleted. */
export async function existingFormatId(tx: Tx, tenantId: string, formatId: string | undefined): Promise<string | undefined> {
  if (!formatId) return undefined;
  return (await tx.query('SELECT 1 FROM invoice_formats WHERE id = $1 AND tenant_id = $2', [formatId, tenantId])).rows[0] ? formatId : undefined;
}

async function find(tx: Tx, tenantId: string, formatId: string, forUpdate = false): Promise<InvoiceFormat> {
  const { rows } = await tx.query<Row>(`SELECT * FROM invoice_formats WHERE id = $1 AND tenant_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [formatId, tenantId]);
  if (!rows[0]) throw new Error(FORMAT_NOT_FOUND);
  return parseInvoiceFormatRow(rows[0]);
}

/** A tenant's first listing creates its Standard format. Two first listings at once both try; the one that loses inserts nothing. */
async function ensureStandard(tx: Tx, tenantId: string) {
  await tx.query(
    `INSERT INTO invoice_formats (id, tenant_id, name, definition, is_default, created_at, updated_at) SELECT $1::text, $2::text, 'Standard', $3::jsonb, 1, $4::timestamptz, $4::timestamptz
     WHERE NOT EXISTS (SELECT 1 FROM invoice_formats WHERE tenant_id = $2) ON CONFLICT DO NOTHING`,
    [standardFormatId(tenantId), tenantId, JSON.stringify(BUILTIN_DEFINITION), now()],
  );
}

async function requireFreeName(tx: Tx, tenantId: string, name: string, exceptId = '') {
  if ((await tx.query('SELECT 1 FROM invoice_formats WHERE tenant_id = $1 AND lower(name) = lower($2) AND id <> $3', [tenantId, name, exceptId])).rows[0]) throw new Error(DUPLICATE_FORMAT_MESSAGE);
}

const duplicateName = renameUniqueViolation(['invoice_formats_tenant_name'], DUPLICATE_FORMAT_MESSAGE);

/** Locks every format of the tenant first, so two moves of the default take turns instead of colliding on the one-default index. */
async function makeDefault(tx: Tx, tenantId: string, formatId: string) {
  await tx.query('SELECT 1 FROM invoice_formats WHERE tenant_id = $1 ORDER BY id COLLATE "C" FOR UPDATE', [tenantId]);
  await tx.query('UPDATE invoice_formats SET is_default = 0 WHERE tenant_id = $1 AND is_default = 1', [tenantId]);
  await tx.query('UPDATE invoice_formats SET is_default = 1 WHERE id = $1 AND tenant_id = $2', [formatId, tenantId]);
}

export function createPgInvoiceFormatMethods(db: Database) {
  const asAdmin = <T>(context: TenantContext, work: (tx: Tx) => Promise<T>) => db.withTenant(context.tenantId, async (tx) => {
    requireAdminRole(await actorRole(tx, context), 'invoice formats');
    return work(tx);
  });
  return {
    async listInvoiceFormats(context: TenantContext): Promise<InvoiceFormat[]> {
      return db.withTenant(context.tenantId, async (tx) => {
        await ensureStandard(tx, context.tenantId);
        return loadFormats(tx, context.tenantId);
      });
    },
    async createInvoiceFormat(context: TenantContext, input: unknown): Promise<InvoiceFormat> {
      return asAdmin(context, async (tx) => {
        const { name, definition, isDefault } = parseFormatInput(input);
        await ensureStandard(tx, context.tenantId);
        await requireFreeName(tx, context.tenantId, name);
        const id = `${context.tenantId}-format-${crypto.randomUUID()}`;
        await tx.query('INSERT INTO invoice_formats (id, tenant_id, name, definition, is_default, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, $5, $5)', [id, context.tenantId, name, JSON.stringify(definition), now()]).catch(duplicateName);
        if (isDefault) await makeDefault(tx, context.tenantId, id);
        return find(tx, context.tenantId, id);
      });
    },
    async updateInvoiceFormat(context: TenantContext, formatId: string, input: unknown): Promise<InvoiceFormat> {
      return asAdmin(context, async (tx) => {
        const { name, definition, isDefault } = parseFormatInput(input);
        await find(tx, context.tenantId, formatId);
        await requireFreeName(tx, context.tenantId, name, formatId);
        await tx.query('UPDATE invoice_formats SET name = $1, definition = $2, updated_at = $3 WHERE id = $4 AND tenant_id = $5', [name, JSON.stringify(definition), now(), formatId, context.tenantId]).catch(duplicateName);
        if (isDefault) await makeDefault(tx, context.tenantId, formatId);
        return find(tx, context.tenantId, formatId);
      });
    },
    async setDefaultInvoiceFormat(context: TenantContext, formatId: string): Promise<InvoiceFormat> {
      return asAdmin(context, async (tx) => {
        await find(tx, context.tenantId, formatId);
        await makeDefault(tx, context.tenantId, formatId);
        return find(tx, context.tenantId, formatId);
      });
    },
    /** Locks the format before the default check, so it cannot be made the default meanwhile and then deleted. */
    async deleteInvoiceFormat(context: TenantContext, formatId: string): Promise<void> {
      await asAdmin(context, async (tx) => {
        if ((await find(tx, context.tenantId, formatId, true)).isDefault) throw new Error(DEFAULT_FORMAT_DELETE_MESSAGE);
        await tx.query('UPDATE customers SET invoice_format_id = NULL WHERE invoice_format_id = $1 AND tenant_id = $2', [formatId, context.tenantId]);
        await tx.query('DELETE FROM invoice_formats WHERE id = $1 AND tenant_id = $2', [formatId, context.tenantId]);
      });
    },
  } satisfies Partial<TenantStore>;
}
