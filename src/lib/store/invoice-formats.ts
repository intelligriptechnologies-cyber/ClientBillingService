import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { parseFormatInput, resolveInvoiceFormat, BUILTIN_DEFINITION, type InvoiceFormat, type SnapshotFormat } from '../invoice-format';
import { now, requireAdminRole } from './shared';
import { actorRole } from './tenants';
import { parseInvoiceFormatRow } from './rows';
import { DEFAULT_FORMAT_DELETE_MESSAGE, DUPLICATE_FORMAT_MESSAGE, FORMAT_NOT_FOUND, standardFormatId } from './rules';

type Row = Record<string, unknown>;

export function loadInvoiceFormats(database: DatabaseSync, tenantId: string): InvoiceFormat[] {
  const rows = database.prepare('SELECT * FROM invoice_formats WHERE tenant_id = ? ORDER BY is_default DESC, name COLLATE NOCASE').all(tenantId) as Row[];
  return rows.map(parseInvoiceFormatRow);
}

/** The format an invoice is issued with. Throws when the chosen id is not one of the tenant's own formats. */
export function resolveFormatForInvoice(database: DatabaseSync, tenantId: string, requestedId?: string | null, customerDefaultId?: string | null): SnapshotFormat {
  return resolveInvoiceFormat(loadInvoiceFormats(database, tenantId), { requestedId, customerDefaultId });
}

/** The id of a format only while it still exists, so a correction can keep the original format unless it was deleted. */
export function existingFormatId(database: DatabaseSync, tenantId: string, formatId: string | undefined): string | undefined {
  return formatId && database.prepare('SELECT 1 FROM invoice_formats WHERE id = ? AND tenant_id = ?').get(formatId, tenantId) ? formatId : undefined;
}

export function createInvoiceFormatMethods(database: DatabaseSync) {
  function find(tenantId: string, formatId: string): InvoiceFormat {
    const row = database.prepare('SELECT * FROM invoice_formats WHERE id = ? AND tenant_id = ?').get(formatId, tenantId) as Row | undefined;
    if (!row) throw new Error(FORMAT_NOT_FOUND);
    return parseInvoiceFormatRow(row);
  }
  function ensureStandard(tenantId: string) {
    const timestamp = now();
    database.prepare("INSERT INTO invoice_formats (id, tenant_id, name, definition, is_default, created_at, updated_at) SELECT ?, ?, 'Standard', ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM invoice_formats WHERE tenant_id = ?)").run(standardFormatId(tenantId), tenantId, JSON.stringify(BUILTIN_DEFINITION), timestamp, timestamp, tenantId);
  }
  function requireFreeName(tenantId: string, name: string, exceptId = '') {
    if (database.prepare('SELECT 1 FROM invoice_formats WHERE tenant_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(tenantId, name, exceptId)) throw new Error(DUPLICATE_FORMAT_MESSAGE);
  }
  function inTransaction<T>(work: () => T): T {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function makeDefault(tenantId: string, formatId: string) {
    database.prepare('UPDATE invoice_formats SET is_default = 0 WHERE tenant_id = ? AND is_default = 1').run(tenantId);
    database.prepare('UPDATE invoice_formats SET is_default = 1 WHERE id = ? AND tenant_id = ?').run(formatId, tenantId);
  }
  const requireAdmin = (context: TenantContext) => requireAdminRole(actorRole(database, context), 'invoice formats');

  return {
    listInvoiceFormats(context: TenantContext): InvoiceFormat[] {
      ensureStandard(context.tenantId);
      return loadInvoiceFormats(database, context.tenantId);
    },
    createInvoiceFormat(context: TenantContext, input: unknown): InvoiceFormat {
      requireAdmin(context);
      const { name, definition, isDefault } = parseFormatInput(input);
      return inTransaction(() => {
        ensureStandard(context.tenantId);
        requireFreeName(context.tenantId, name);
        const id = `${context.tenantId}-format-${crypto.randomUUID()}`; const timestamp = now();
        database.prepare('INSERT INTO invoice_formats (id, tenant_id, name, definition, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)').run(id, context.tenantId, name, JSON.stringify(definition), timestamp, timestamp);
        if (isDefault) makeDefault(context.tenantId, id);
        return find(context.tenantId, id);
      });
    },
    updateInvoiceFormat(context: TenantContext, formatId: string, input: unknown): InvoiceFormat {
      requireAdmin(context);
      const { name, definition, isDefault } = parseFormatInput(input);
      return inTransaction(() => {
        find(context.tenantId, formatId);
        requireFreeName(context.tenantId, name, formatId);
        database.prepare('UPDATE invoice_formats SET name = ?, definition = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(name, JSON.stringify(definition), now(), formatId, context.tenantId);
        if (isDefault) makeDefault(context.tenantId, formatId);
        return find(context.tenantId, formatId);
      });
    },
    setDefaultInvoiceFormat(context: TenantContext, formatId: string): InvoiceFormat {
      requireAdmin(context);
      return inTransaction(() => { find(context.tenantId, formatId); makeDefault(context.tenantId, formatId); return find(context.tenantId, formatId); });
    },
    deleteInvoiceFormat(context: TenantContext, formatId: string): void {
      requireAdmin(context);
      inTransaction(() => {
        if (find(context.tenantId, formatId).isDefault) throw new Error(DEFAULT_FORMAT_DELETE_MESSAGE);
        database.prepare('UPDATE customers SET invoice_format_id = NULL WHERE invoice_format_id = ? AND tenant_id = ?').run(formatId, context.tenantId);
        database.prepare('DELETE FROM invoice_formats WHERE id = ? AND tenant_id = ?').run(formatId, context.tenantId);
      });
    },
  };
}
