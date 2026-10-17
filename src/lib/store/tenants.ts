import type { DatabaseSync } from 'node:sqlite';
import { now, requireSuperadmin, requireTenantAdmin } from './shared';
import { seedSettings } from './schema';
import type { AppRole, DemoIdentity, AppSession, TenantRecord, TenantStatus, Tenant, TenantHistoryEvent, TenantList, TenantUser, TenantUserInput, TenantUserUpdate } from './types';

type TenantFilters = { query?: string; month?: string; status?: TenantStatus | 'all'; page?: number; pageSize?: number };
type TenantInput = { name: string };
type TenantUpdate = { name?: string; status?: TenantStatus };

function identityFromRow(row: Record<string, unknown> | undefined): DemoIdentity | null {
  if (!row) return null;
  return { id: String(row.id), name: String(row.name), email: String(row.email), role: row.role as AppRole, tenantId: row.tenant_id ? String(row.tenant_id) : null, tenantName: row.tenant_name ? String(row.tenant_name) : null };
}
function tenantFromRow(row: Record<string, unknown>): Tenant { return { id: String(row.id), name: String(row.name), status: row.status as TenantStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at), userCount: Number(row.user_count) }; }
function cleanTenantName(name: string) { const value = name.trim().replace(/\s+/g, ' '); if (value.length < 2 || value.length > 100) throw new Error('Tenant name must be between 2 and 100 characters.'); return value; }
function tenantUserFromRow(row: Record<string, unknown>): TenantUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as TenantUser['role'],
    status: row.status as TenantUser['status'],
    createdAt: String(row.created_at),
  };
}

export function createTenantMethods(database: DatabaseSync) {
  const withIdentity = `SELECT users.id, users.name, users.email, users.role, users.tenant_id, tenants.name AS tenant_name
    FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id
    WHERE users.status = 'active' AND (users.tenant_id IS NULL OR tenants.status = 'active')`;
  function nextTenantId(name: string) { const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'tenant'; let candidate = base; let suffix = 2; while (database.prepare('SELECT 1 FROM tenants WHERE id = ?').get(candidate)) candidate = `${base}-${suffix++}`; return candidate; }
  function event(tenantId: string, action: TenantHistoryEvent['action'], detail: string) { database.prepare('INSERT INTO tenant_lifecycle_events (id, tenant_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, action, detail, now()); }
  function getTenant(tenantId: string): Tenant { const row = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id WHERE tenants.id = ? GROUP BY tenants.id`).get(tenantId) as Record<string, unknown> | undefined; if (!row) throw new Error('Tenant was not found.'); return tenantFromRow(row); }

  return {
    listIdentities(): DemoIdentity[] {
      return (database.prepare(`${withIdentity} ORDER BY CASE users.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tenants.name`).all() as Record<string, unknown>[]).map((row) => identityFromRow(row)!).filter(Boolean);
    },
    authenticate(userId: string): AppSession | null {
      return identityFromRow(database.prepare(`${withIdentity} AND users.id = ?`).get(userId) as Record<string, unknown> | undefined);
    },
    listTenantRecords(session: AppSession): TenantRecord[] {
      if (!session.tenantId) return [];
      return database.prepare('SELECT id, tenant_id AS tenantId, label FROM tenant_records WHERE tenant_id = ? ORDER BY id').all(session.tenantId) as TenantRecord[];
    },
    createTenantRecord(session: AppSession, tenantId: string, label: string): TenantRecord {
      if (!session.tenantId || session.tenantId !== tenantId) throw new Error('A tenant session may only change its own tenant data.');
      const id = `${tenantId}-${crypto.randomUUID()}`;
      database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)').run(id, tenantId, label);
      return { id, tenantId, label };
    },
    listTenants(session: AppSession, filters: TenantFilters): TenantList {
      requireSuperadmin(session); const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 5), 50); const page = Math.max(Number(filters.page) || 1, 1); const query = filters.query?.trim() ?? ''; const conditions: string[] = []; const values: Array<string | number> = [];
      if (query) { conditions.push('LOWER(tenants.name) LIKE ?'); values.push(`%${query.toLowerCase()}%`); } if (filters.status && filters.status !== 'all') { conditions.push('tenants.status = ?'); values.push(filters.status); }
      if (filters.month) { conditions.push('substr(tenants.created_at, 1, 7) = ?'); values.push(filters.month); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''; const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM tenants ${where}`).get(...values) as { count: number }).count);
      const rows = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id ${where} GROUP BY tenants.id ORDER BY tenants.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(tenantFromRow), total };
    },
    createTenant(session: AppSession, input: TenantInput): Tenant {
      requireSuperadmin(session); const name = cleanTenantName(input.name); if (database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error('A tenant with that name already exists.'); const tenantId = nextTenantId(name); const timestamp = now(); database.exec('BEGIN');
      try { database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(tenantId, name, 'active', timestamp, timestamp); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-admin`, tenantId, `${name} Admin`, `admin@${tenantId}.demo`, 'admin', 'admin123', 'active'); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-user`, tenantId, `${name} User`, `user@${tenantId}.demo`, 'user', 'admin123', 'active'); event(tenantId, 'created', `Created ${name} with default admin and user.`); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      database.prepare("UPDATE users SET created_at = ? WHERE tenant_id = ? AND created_at = ''").run(timestamp, tenantId);
      seedSettings(database); return getTenant(tenantId);
    },
    updateTenant(session: AppSession, tenantId: string, input: TenantUpdate): Tenant {
      requireSuperadmin(session); const current = getTenant(tenantId); const name = input.name === undefined ? current.name : cleanTenantName(input.name); const status = input.status ?? current.status; if (status !== 'active' && status !== 'disabled') throw new Error('Tenant status is invalid.'); if (name !== current.name && database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error('A tenant with that name already exists.'); database.exec('BEGIN');
      try { if (name !== current.name) event(tenantId, 'updated', `Renamed from ${current.name} to ${name}.`); if (status !== current.status) event(tenantId, status === 'disabled' ? 'disabled' : 'enabled', status === 'disabled' ? 'Tenant disabled.' : 'Tenant enabled.'); database.prepare('UPDATE tenants SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(name, status, now(), tenantId); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return getTenant(tenantId);
    },
    listTenantHistory(session: AppSession, tenantId: string): TenantHistoryEvent[] { requireSuperadmin(session); getTenant(tenantId); return (database.prepare('SELECT id, tenant_id, action, detail, occurred_at FROM tenant_lifecycle_events WHERE tenant_id = ? ORDER BY occurred_at, rowid').all(tenantId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), tenantId: String(row.tenant_id), action: row.action as TenantHistoryEvent['action'], detail: String(row.detail), occurredAt: String(row.occurred_at) })); },
    listTenantUsers(session: AppSession): TenantUser[] {
      requireTenantAdmin(session);
      return (database.prepare(`SELECT id, name, email, role, status, created_at FROM users
        WHERE tenant_id = ? ORDER BY name COLLATE NOCASE`).all(session.tenantId) as Record<string, unknown>[]).map(tenantUserFromRow);
    },
    createTenantUser(session: AppSession, input: TenantUserInput): TenantUser {
      requireTenantAdmin(session);
      const name = input.name.trim();
      const email = input.email.trim();
      if (!name || !email) throw new Error('A user name and email are required.');
      if (input.role !== 'admin' && input.role !== 'user') throw new Error('Choose an admin or user role.');
      const id = `${session.tenantId}-user-${crypto.randomUUID()}`;
      try {
        database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, session.tenantId, name, email, input.role, 'admin123', 'active', now());
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A user with that email already exists.');
        throw error;
      }
      return tenantUserFromRow(database.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?').get(id) as Record<string, unknown>);
    },
    updateTenantUser(session: AppSession, userId: string, update: TenantUserUpdate): TenantUser {
      requireTenantAdmin(session);
      const existing = database.prepare('SELECT id, name, email, role, status FROM users WHERE id = ? AND tenant_id = ?').get(userId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('This user does not belong to your tenant.');
      const name = update.name === undefined ? String(existing.name) : update.name.trim();
      const email = update.email === undefined ? String(existing.email) : update.email.trim();
      const role = update.role === undefined ? existing.role as TenantUser['role'] : update.role;
      const status = update.status === undefined ? existing.status as TenantUser['status'] : update.status;
      if (!name || !email) throw new Error('A user name and email are required.');
      if ((role !== 'admin' && role !== 'user') || (status !== 'active' && status !== 'disabled')) throw new Error('Invalid user role or status.');
      try {
        database.prepare('UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ? AND tenant_id = ?').run(name, email, role, status, userId, session.tenantId);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A user with that email already exists.');
        throw error;
      }
      return tenantUserFromRow(database.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?').get(userId) as Record<string, unknown>);
    },
  };
}
