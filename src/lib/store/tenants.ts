import type { DatabaseSync } from 'node:sqlite';
import type { PlatformActor, TenantContext } from '../auth/principal';
import { now, requireAdminRole, requirePlatform } from './shared';
import { seedSettings } from './schema';
import { parseIdentityRow, parseTenantHistoryRow, parseTenantRecordRow, parseTenantRow, parseTenantUserRow } from './rows';
import { cleanTenantName, DUPLICATE_EMAIL_MESSAGE, DUPLICATE_TENANT_MESSAGE, LAST_ADMIN_MESSAGE, newTenantUser, tenantIdBase, updatedTenantUser } from './rules';
import type { DemoIdentity, AppSession, TenantRecord, Tenant, TenantHistoryEvent, TenantList, TenantUser, TenantUserInput, TenantUserUpdate, TenantFilters, TenantInput, TenantUpdate } from './types';

type Row = Record<string, unknown>;

/** The acting user's role from its active users row in the context's tenant, or null. */
export function actorRole(database: DatabaseSync, context: TenantContext): string | null {
  if (context.actor.kind !== 'user') return null;
  const row = database.prepare("SELECT role FROM users WHERE id = ? AND tenant_id = ? AND status = 'active'").get(context.actor.id, context.tenantId) as Row | undefined;
  return row ? String(row.role) : null;
}

export function createTenantMethods(database: DatabaseSync) {
  const withIdentity = `SELECT users.id, users.name, users.email, users.role, users.tenant_id, tenants.name AS tenant_name
    FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id
    WHERE users.status = 'active' AND (users.tenant_id IS NULL OR tenants.status = 'active')`;
  const userColumns = 'id, name, email, role, status, created_at';
  function nextTenantId(name: string) { const base = tenantIdBase(name); let candidate = base; let suffix = 2; while (database.prepare('SELECT 1 FROM tenants WHERE id = ?').get(candidate)) candidate = `${base}-${suffix++}`; return candidate; }
  function event(tenantId: string, action: TenantHistoryEvent['action'], detail: string) { database.prepare('INSERT INTO tenant_lifecycle_events (id, tenant_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, action, detail, now()); }
  function getTenant(tenantId: string): Tenant { const row = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id WHERE tenants.id = ? GROUP BY tenants.id`).get(tenantId) as Row | undefined; if (!row) throw new Error('Tenant was not found.'); return parseTenantRow(row); }
  function tenantUser(userId: string) { return parseTenantUserRow(database.prepare(`SELECT ${userColumns} FROM users WHERE id = ?`).get(userId) as Row); }

  return {
    listIdentities(): DemoIdentity[] {
      return (database.prepare(`${withIdentity} ORDER BY CASE users.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tenants.name`).all() as Row[]).map(parseIdentityRow);
    },
    authenticate(userId: string): AppSession | null {
      const row = database.prepare(`${withIdentity} AND users.id = ?`).get(userId) as Row | undefined;
      return row ? parseIdentityRow(row) : null;
    },
    listTenantRecords(context: TenantContext): TenantRecord[] {
      return (database.prepare('SELECT id, tenant_id, label FROM tenant_records WHERE tenant_id = ? ORDER BY id').all(context.tenantId) as Row[]).map(parseTenantRecordRow);
    },
    createTenantRecord(context: TenantContext, tenantId: string, label: string): TenantRecord {
      if (context.tenantId !== tenantId) throw new Error('A tenant session may only change its own tenant data.');
      const id = `${tenantId}-${crypto.randomUUID()}`;
      database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)').run(id, tenantId, label);
      return { id, tenantId, label };
    },
    listTenants(platform: PlatformActor, filters: TenantFilters): TenantList {
      requirePlatform(platform); const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 5), 50); const page = Math.max(Number(filters.page) || 1, 1); const query = filters.query?.trim() ?? ''; const conditions: string[] = []; const values: Array<string | number> = [];
      if (query) { conditions.push("INSTR(LOWER(tenants.name), ?) > 0"); values.push(query.toLowerCase()); } if (filters.status && filters.status !== 'all') { conditions.push('tenants.status = ?'); values.push(filters.status); }
      if (filters.month) { conditions.push('substr(tenants.created_at, 1, 7) = ?'); values.push(filters.month); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''; const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM tenants ${where}`).get(...values) as { count: number }).count);
      const rows = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id ${where} GROUP BY tenants.id ORDER BY tenants.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
      return { items: rows.map(parseTenantRow), total };
    },
    createTenant(platform: PlatformActor, input: TenantInput): Tenant {
      requirePlatform(platform); const name = cleanTenantName(input.name); if (database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error(DUPLICATE_TENANT_MESSAGE); const tenantId = nextTenantId(name); const timestamp = now(); database.exec('BEGIN');
      try { database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(tenantId, name, 'active', timestamp, timestamp); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-admin`, tenantId, `${name} Admin`, `admin@${tenantId}.demo`, 'admin', 'admin123', 'active'); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-user`, tenantId, `${name} User`, `user@${tenantId}.demo`, 'user', 'admin123', 'active'); event(tenantId, 'created', `Created ${name} with default admin and user.`); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      database.prepare("UPDATE users SET created_at = ? WHERE tenant_id = ? AND created_at = ''").run(timestamp, tenantId);
      seedSettings(database); return getTenant(tenantId);
    },
    updateTenant(platform: PlatformActor, tenantId: string, input: TenantUpdate): Tenant {
      requirePlatform(platform); const current = getTenant(tenantId); const name = input.name === undefined ? current.name : cleanTenantName(input.name); const status = input.status ?? current.status; if (status !== 'active' && status !== 'disabled') throw new Error('Tenant status is invalid.'); if (name !== current.name && database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?) AND id <> ?').get(name, tenantId)) throw new Error(DUPLICATE_TENANT_MESSAGE); database.exec('BEGIN');
      try { if (name !== current.name) event(tenantId, 'updated', `Renamed from ${current.name} to ${name}.`); if (status !== current.status) event(tenantId, status === 'disabled' ? 'disabled' : 'enabled', status === 'disabled' ? 'Tenant disabled.' : 'Tenant enabled.'); database.prepare('UPDATE tenants SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(name, status, now(), tenantId); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return getTenant(tenantId);
    },
    listTenantHistory(platform: PlatformActor, tenantId: string): TenantHistoryEvent[] { requirePlatform(platform); getTenant(tenantId); return (database.prepare('SELECT id, tenant_id, action, detail, occurred_at FROM tenant_lifecycle_events WHERE tenant_id = ? ORDER BY occurred_at, rowid').all(tenantId) as Row[]).map(parseTenantHistoryRow); },
    listTenantUsers(context: TenantContext): TenantUser[] {
      requireAdminRole(actorRole(database, context));
      return (database.prepare(`SELECT ${userColumns} FROM users WHERE tenant_id = ? ORDER BY name COLLATE NOCASE`).all(context.tenantId) as Row[]).map(parseTenantUserRow);
    },
    createTenantUser(context: TenantContext, input: TenantUserInput): TenantUser {
      requireAdminRole(actorRole(database, context));
      const user = newTenantUser(input);
      const id = `${context.tenantId}-user-${crypto.randomUUID()}`;
      try {
        database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, context.tenantId, user.name, user.email, user.role, 'admin123', 'active', now());
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error(DUPLICATE_EMAIL_MESSAGE);
        throw error;
      }
      return tenantUser(id);
    },
    updateTenantUser(context: TenantContext, userId: string, update: TenantUserUpdate): TenantUser {
      requireAdminRole(actorRole(database, context));
      const existing = database.prepare(`SELECT ${userColumns} FROM users WHERE id = ? AND tenant_id = ?`).get(userId, context.tenantId) as Row | undefined;
      if (!existing) throw new Error('This user does not belong to your tenant.');
      const { user, removesActiveAdmin } = updatedTenantUser(parseTenantUserRow(existing), update);
      if (removesActiveAdmin) {
        const others = database.prepare("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND role = 'admin' AND status = 'active' AND id <> ?").get(context.tenantId, userId) as { count: number };
        if (others.count === 0) throw new Error(LAST_ADMIN_MESSAGE);
      }
      try {
        database.prepare('UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ? AND tenant_id = ?').run(user.name, user.email, user.role, user.status, userId, context.tenantId);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error(DUPLICATE_EMAIL_MESSAGE);
        throw error;
      }
      return tenantUser(userId);
    },
  };
}
