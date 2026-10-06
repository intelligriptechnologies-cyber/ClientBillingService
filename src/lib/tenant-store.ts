import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppRole = 'superadmin' | 'admin' | 'user';
export type TenantStatus = 'active' | 'disabled';
export type DemoIdentity = { id: string; name: string; email: string; role: AppRole; tenantId: string | null; tenantName: string | null };
export type AppSession = DemoIdentity;
export type TenantRecord = { id: string; tenantId: string; label: string };
export type Tenant = { id: string; name: string; status: TenantStatus; createdAt: string; updatedAt: string; userCount: number };
export type TenantHistoryEvent = { id: string; tenantId: string; action: 'created' | 'updated' | 'disabled' | 'enabled'; detail: string; occurredAt: string };
export type TenantList = { items: Tenant[]; total: number };

type TenantSeed = { id: string; name: string; adminEmail: string; userEmail: string };
type TenantFilters = { query?: string; status?: TenantStatus | 'all'; page?: number; pageSize?: number };
type TenantInput = { name: string };
type TenantUpdate = { name?: string; status?: TenantStatus };

const tenantSeeds: TenantSeed[] = [
  { id: 'nexio', name: 'Nexio Hyper', adminEmail: 'Admin@nexio.com', userEmail: 'user@nexio.com' },
  { id: 'maasp', name: 'MAASP Associates', adminEmail: 'Admin@maasp.com', userEmail: 'user@massp.com' },
  { id: 'evo', name: 'Evo Fitness', adminEmail: 'Admin@evo.com', userEmail: 'user@evo.com' },
  { id: 'gripdata', name: 'Gripdata Analytics', adminEmail: 'Admin@gripdata.com', userEmail: 'user@gripdata.com' },
  { id: 'od', name: 'OD Badminton', adminEmail: 'Admin@od.com', userEmail: 'user@od.com' },
];

function now() { return new Date().toISOString(); }

function seed(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')), created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'user')), password TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')));
    CREATE TABLE IF NOT EXISTS tenant_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenant_lifecycle_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'disabled', 'enabled')), detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
  `);
  for (const statement of ["ALTER TABLE tenants ADD COLUMN created_at TEXT NOT NULL DEFAULT ''", "ALTER TABLE tenants ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"]) {
    try { database.exec(statement); } catch { /* Column already exists. */ }
  }
  const tenantCount = database.prepare('SELECT COUNT(*) AS count FROM tenants').get() as { count: number };
  if (tenantCount.count > 0) return;
  const timestamp = now();
  database.exec('BEGIN');
  try {
    database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('superadmin', null, 'Demo Superadmin', 'superadmin@ledgerly.demo', 'superadmin', 'admin123', 'active');
    const insertTenant = database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertUser = database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertRecord = database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)');
    for (const tenant of tenantSeeds) {
      insertTenant.run(tenant.id, tenant.name, 'active', timestamp, timestamp);
      insertUser.run(`${tenant.id}-admin`, tenant.id, `${tenant.name} Admin`, tenant.adminEmail, 'admin', 'admin123', 'active');
      insertUser.run(`${tenant.id}-user`, tenant.id, `${tenant.name} User`, tenant.userEmail, 'user', 'admin123', 'active');
      insertRecord.run(`${tenant.id}-baseline`, tenant.id, `${tenant.name} baseline demo record`);
    }
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

function identityFromRow(row: Record<string, unknown> | undefined): DemoIdentity | null {
  if (!row) return null;
  return { id: String(row.id), name: String(row.name), email: String(row.email), role: row.role as AppRole, tenantId: row.tenant_id ? String(row.tenant_id) : null, tenantName: row.tenant_name ? String(row.tenant_name) : null };
}
function tenantFromRow(row: Record<string, unknown>): Tenant {
  return { id: String(row.id), name: String(row.name), status: row.status as TenantStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at), userCount: Number(row.user_count) };
}
function requireSuperadmin(session: AppSession) { if (session.role !== 'superadmin') throw new Error('Only a superadmin may manage tenants.'); }
function cleanName(name: string) { const value = name.trim().replace(/\s+/g, ' '); if (value.length < 2 || value.length > 100) throw new Error('Tenant name must be between 2 and 100 characters.'); return value; }

export function createTenantStore(filename = process.env.CLIENT_BILLING_DATABASE ?? '.data/client-billing.sqlite') {
  mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  seed(database);
  const withIdentity = `SELECT users.id, users.name, users.email, users.role, users.tenant_id, tenants.name AS tenant_name FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id WHERE users.status = 'active' AND (users.tenant_id IS NULL OR tenants.status = 'active')`;
  function nextTenantId(name: string) { const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'tenant'; let candidate = base; let suffix = 2; while (database.prepare('SELECT 1 FROM tenants WHERE id = ?').get(candidate)) candidate = `${base}-${suffix++}`; return candidate; }
  function event(tenantId: string, action: TenantHistoryEvent['action'], detail: string) { database.prepare('INSERT INTO tenant_lifecycle_events (id, tenant_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, action, detail, now()); }
  function getTenant(tenantId: string): Tenant { const row = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id WHERE tenants.id = ? GROUP BY tenants.id`).get(tenantId) as Record<string, unknown> | undefined; if (!row) throw new Error('Tenant was not found.'); return tenantFromRow(row); }
  return {
    listIdentities(): DemoIdentity[] { return (database.prepare(`${withIdentity} ORDER BY CASE users.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tenants.name`).all() as Record<string, unknown>[]).map((row) => identityFromRow(row)!).filter(Boolean); },
    authenticate(userId: string): AppSession | null { return identityFromRow(database.prepare(`${withIdentity} AND users.id = ?`).get(userId) as Record<string, unknown> | undefined); },
    listTenantRecords(session: AppSession): TenantRecord[] { if (!session.tenantId) return []; return database.prepare('SELECT id, tenant_id AS tenantId, label FROM tenant_records WHERE tenant_id = ? ORDER BY id').all(session.tenantId) as TenantRecord[]; },
    createTenantRecord(session: AppSession, tenantId: string, label: string): TenantRecord { if (!session.tenantId || session.tenantId !== tenantId) throw new Error('A tenant session may only change its own tenant data.'); const id = `${tenantId}-${crypto.randomUUID()}`; database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)').run(id, tenantId, label); return { id, tenantId, label }; },
    listTenants(session: AppSession, filters: TenantFilters): TenantList {
      requireSuperadmin(session); const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 5), 50); const page = Math.max(Number(filters.page) || 1, 1); const query = filters.query?.trim() ?? ''; const conditions: string[] = []; const values: Array<string | number> = [];
      if (query) { conditions.push('LOWER(tenants.name) LIKE ?'); values.push(`%${query.toLowerCase()}%`); } if (filters.status && filters.status !== 'all') { conditions.push('tenants.status = ?'); values.push(filters.status); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''; const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM tenants ${where}`).get(...values) as { count: number }).count);
      const rows = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id ${where} GROUP BY tenants.id ORDER BY tenants.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(tenantFromRow), total };
    },
    createTenant(session: AppSession, input: TenantInput): Tenant {
      requireSuperadmin(session); const name = cleanName(input.name); if (database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error('A tenant with that name already exists.'); const tenantId = nextTenantId(name); const timestamp = now(); database.exec('BEGIN');
      try { database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(tenantId, name, 'active', timestamp, timestamp); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-admin`, tenantId, `${name} Admin`, `admin@${tenantId}.demo`, 'admin', 'admin123', 'active'); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-user`, tenantId, `${name} User`, `user@${tenantId}.demo`, 'user', 'admin123', 'active'); event(tenantId, 'created', `Created ${name} with default admin and user.`); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return getTenant(tenantId);
    },
    updateTenant(session: AppSession, tenantId: string, input: TenantUpdate): Tenant {
      requireSuperadmin(session); const current = getTenant(tenantId); const name = input.name === undefined ? current.name : cleanName(input.name); const status = input.status ?? current.status; if (status !== 'active' && status !== 'disabled') throw new Error('Tenant status is invalid.'); if (name !== current.name && database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error('A tenant with that name already exists.'); database.exec('BEGIN');
      try { if (name !== current.name) event(tenantId, 'updated', `Renamed from ${current.name} to ${name}.`); if (status !== current.status) event(tenantId, status === 'disabled' ? 'disabled' : 'enabled', status === 'disabled' ? 'Tenant disabled.' : 'Tenant enabled.'); database.prepare('UPDATE tenants SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(name, status, now(), tenantId); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return getTenant(tenantId);
    },
    listTenantHistory(session: AppSession, tenantId: string): TenantHistoryEvent[] { requireSuperadmin(session); getTenant(tenantId); return (database.prepare('SELECT id, tenant_id, action, detail, occurred_at FROM tenant_lifecycle_events WHERE tenant_id = ? ORDER BY occurred_at, rowid').all(tenantId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), tenantId: String(row.tenant_id), action: row.action as TenantHistoryEvent['action'], detail: String(row.detail), occurredAt: String(row.occurred_at) })); },
    close() { database.close(); },
  };
}

let sharedStore: ReturnType<typeof createTenantStore> | undefined;
export function getTenantStore() { sharedStore ??= createTenantStore(); return sharedStore; }
