import type { DatabaseSync } from 'node:sqlite';
import { parseFormatDefinition, parseFormatInput, resolveInvoiceFormat, BUILTIN_DEFINITION, type InvoiceFormat, type SnapshotFormat } from '../invoice-format';
import { now, requireTenantAdmin, requireTenantMember } from './shared';
import type { AppSession } from './types';

const NOT_FOUND = 'Invoice format not found.';

function formatFromRow(row: Record<string, unknown>): InvoiceFormat {
  return { id: String(row.id), name: String(row.name), isDefault: Number(row.is_default) === 1, definition: parseFormatDefinition(JSON.parse(String(row.definition))) };
}

export function loadInvoiceFormats(database: DatabaseSync, tenantId: string): InvoiceFormat[] {
  const rows = database.prepare('SELECT * FROM invoice_formats WHERE tenant_id = ? ORDER BY is_default DESC, name COLLATE NOCASE').all(tenantId) as Record<string, unknown>[];
  return rows.map(formatFromRow);
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
    const row = database.prepare('SELECT * FROM invoice_formats WHERE id = ? AND tenant_id = ?').get(formatId, tenantId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(NOT_FOUND);
    return formatFromRow(row);
  }
  function ensureStandard(tenantId: string) {
    const timestamp = now();
    database.prepare("INSERT INTO invoice_formats (id, tenant_id, name, definition, is_default, created_at, updated_at) SELECT ?, ?, 'Standard', ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM invoice_formats WHERE tenant_id = ?)").run(`${tenantId}-format-standard`, tenantId, JSON.stringify(BUILTIN_DEFINITION), timestamp, timestamp, tenantId);
  }
  function requireFreeName(tenantId: string, name: string, exceptId = '') {
    if (database.prepare('SELECT 1 FROM invoice_formats WHERE tenant_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(tenantId, name, exceptId)) throw new Error('A format with that name already exists.');
  }
  function inTransaction<T>(work: () => T): T {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function makeDefault(tenantId: string, formatId: string) {
    database.prepare('UPDATE invoice_formats SET is_default = 0 WHERE tenant_id = ? AND is_default = 1').run(tenantId);
    database.prepare('UPDATE invoice_formats SET is_default = 1 WHERE id = ? AND tenant_id = ?').run(formatId, tenantId);
  }

  return {
    listInvoiceFormats(session: AppSession): InvoiceFormat[] {
      requireTenantMember(session);
      ensureStandard(session.tenantId);
      return loadInvoiceFormats(database, session.tenantId);
    },
    createInvoiceFormat(session: AppSession, input: unknown): InvoiceFormat {
      requireTenantAdmin(session, 'invoice formats');
      const { name, definition, isDefault } = parseFormatInput(input);
      return inTransaction(() => {
        ensureStandard(session.tenantId);
        requireFreeName(session.tenantId, name);
        const id = `${session.tenantId}-format-${crypto.randomUUID()}`; const timestamp = now();
        database.prepare('INSERT INTO invoice_formats (id, tenant_id, name, definition, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)').run(id, session.tenantId, name, JSON.stringify(definition), timestamp, timestamp);
        if (isDefault) makeDefault(session.tenantId, id);
        return find(session.tenantId, id);
      });
    },
    updateInvoiceFormat(session: AppSession, formatId: string, input: unknown): InvoiceFormat {
      requireTenantAdmin(session, 'invoice formats');
      const { name, definition, isDefault } = parseFormatInput(input);
      return inTransaction(() => {
        find(session.tenantId, formatId);
        requireFreeName(session.tenantId, name, formatId);
        database.prepare('UPDATE invoice_formats SET name = ?, definition = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(name, JSON.stringify(definition), now(), formatId, session.tenantId);
        if (isDefault) makeDefault(session.tenantId, formatId);
        return find(session.tenantId, formatId);
      });
    },
    setDefaultInvoiceFormat(session: AppSession, formatId: string): InvoiceFormat {
      requireTenantAdmin(session, 'invoice formats');
      return inTransaction(() => { find(session.tenantId, formatId); makeDefault(session.tenantId, formatId); return find(session.tenantId, formatId); });
    },
    deleteInvoiceFormat(session: AppSession, formatId: string): void {
      requireTenantAdmin(session, 'invoice formats');
      inTransaction(() => {
        if (find(session.tenantId, formatId).isDefault) throw new Error('The default invoice format cannot be deleted. Make another format the default first.');
        database.prepare('UPDATE customers SET invoice_format_id = NULL WHERE invoice_format_id = ? AND tenant_id = ?').run(formatId, session.tenantId);
        database.prepare('DELETE FROM invoice_formats WHERE id = ? AND tenant_id = ?').run(formatId, session.tenantId);
      });
    },
  };
}
