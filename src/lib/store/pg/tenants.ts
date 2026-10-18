import type { PlatformActor, TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseIdentityRow, parseTenantHistoryRow, parseTenantRecordRow, parseTenantRow, parseTenantUserRow } from '../rows';
import { cleanTenantName, defaultSettingsColumns, DUPLICATE_EMAIL_MESSAGE, DUPLICATE_TENANT_MESSAGE, LAST_ADMIN_MESSAGE, monthRange, newTenantUser, tenantIdBase, updatedTenantUser } from '../rules';
import { now, requireAdminRole, requirePlatform } from '../shared';
import type { AppSession, DemoIdentity, Tenant, TenantFilters, TenantHistoryEvent, TenantInput, TenantList, TenantRecord, TenantStore, TenantUpdate, TenantUser, TenantUserInput, TenantUserUpdate } from '../types';
import { actorRole, renameUniqueViolation } from './shared';

type Row = Record<string, unknown>;

const duplicateTenantName = renameUniqueViolation(['tenants_name_key', 'tenants_lower_name'], DUPLICATE_TENANT_MESSAGE);
const duplicateEmail = renameUniqueViolation(['users_tenant_email'], DUPLICATE_EMAIL_MESSAGE);

// Sign-in lookups cross tenants before one is chosen, so they run through withPlatform (ADR 0001, Consequences).
const identities = `SELECT users.id, users.name, users.email, users.role, users.tenant_id, tenants.name AS tenant_name
  FROM users JOIN tenants ON tenants.id = users.tenant_id
  WHERE users.status = 'active' AND tenants.status = 'active'`;
const tenantColumns = `tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at,
  (SELECT count(*) FROM users WHERE users.tenant_id = tenants.id) AS user_count`;
const userColumns = 'id, name, email, role, status, created_at';

async function getTenant(tx: Tx, tenantId: string): Promise<Tenant> {
  const { rows } = await tx.query<Row>(`SELECT ${tenantColumns} FROM tenants WHERE id = $1`, [tenantId]);
  if (!rows[0]) throw new Error('Tenant was not found.');
  return parseTenantRow(rows[0]);
}

/** clock_timestamp() rather than now(): two events written in one transaction must still sort in the order written. */
async function recordEvent(tx: Tx, tenantId: string, action: TenantHistoryEvent['action'], detail: string) {
  await tx.query(`INSERT INTO tenant_lifecycle_events (id, tenant_id, action, detail, occurred_at) VALUES ($1, $2, $3, $4, clock_timestamp())`, [crypto.randomUUID(), tenantId, action, detail]);
}

/** Inserts the tenant under the first free id. ON CONFLICT on the id alone, so a taken name still raises 23505. */
async function insertTenant(tx: Tx, name: string, timestamp: string) {
  const base = tenantIdBase(name);
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    const { rowCount } = await tx.query(`INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES ($1, $2, 'active', $3, $3) ON CONFLICT (id) DO NOTHING`, [id, name, timestamp]);
    if (rowCount === 1) return id;
  }
}

export function createPgTenantMethods(db: Database) {
  return {
    async listIdentities(): Promise<DemoIdentity[]> {
      return db.withPlatform(async (tx) => (await tx.query<Row>(`${identities} ORDER BY CASE users.role WHEN 'admin' THEN 1 ELSE 2 END, tenants.name COLLATE "C", users.id`)).rows.map(parseIdentityRow));
    },
    async authenticate(userId: string): Promise<AppSession | null> {
      return db.withPlatform(async (tx) => {
        const { rows } = await tx.query<Row>(`${identities} AND users.id = $1`, [userId]);
        return rows[0] ? parseIdentityRow(rows[0]) : null;
      });
    },
    async listTenantRecords(context: TenantContext): Promise<TenantRecord[]> {
      return db.withTenant(context.tenantId, async (tx) => (await tx.query<Row>('SELECT id, tenant_id, label FROM tenant_records WHERE tenant_id = $1 ORDER BY id', [context.tenantId])).rows.map(parseTenantRecordRow));
    },
    async createTenantRecord(context: TenantContext, tenantId: string, label: string): Promise<TenantRecord> {
      if (context.tenantId !== tenantId) throw new Error('A tenant session may only change its own tenant data.');
      const id = `${tenantId}-${crypto.randomUUID()}`;
      await db.withTenant(tenantId, (tx) => tx.query('INSERT INTO tenant_records (id, tenant_id, label) VALUES ($1, $2, $3)', [id, tenantId, label]));
      return { id, tenantId, label };
    },
    async listTenants(platform: PlatformActor, filters: TenantFilters): Promise<TenantList> {
      requirePlatform(platform);
      const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 5), 50);
      const page = Math.max(Number(filters.page) || 1, 1);
      const query = filters.query?.trim() ?? '';
      const conditions: string[] = [];
      const values: unknown[] = [];
      const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
      if (query) where((p) => `strpos(lower(tenants.name), ${p}) > 0`, query.toLowerCase());
      if (filters.status && filters.status !== 'all') where((p) => `tenants.status = ${p}`, filters.status);
      if (filters.month) {
        const range = monthRange(filters.month);
        if (!range) conditions.push('false');
        else { where((p) => `tenants.created_at >= ${p}`, range.start); where((p) => `tenants.created_at < ${p}`, range.end); }
      }
      const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return db.withPlatform(async (tx) => {
        const total = Number((await tx.query<Row>(`SELECT count(*) AS count FROM tenants ${clause}`, values)).rows[0].count);
        const { rows } = await tx.query<Row>(`SELECT ${tenantColumns} FROM tenants ${clause} ORDER BY lower(tenants.name), tenants.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
        return { items: rows.map(parseTenantRow), total };
      });
    },
    async createTenant(platform: PlatformActor, input: TenantInput): Promise<Tenant> {
      requirePlatform(platform);
      const name = cleanTenantName(input.name);
      return db.withPlatform(async (tx) => {
        const timestamp = now();
        const tenantId = await insertTenant(tx, name, timestamp);
        const insertUser = `INSERT INTO users (id, tenant_id, name, email, role, status, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6)`;
        await tx.query(insertUser, [`${tenantId}-admin`, tenantId, `${name} Admin`, `admin@${tenantId}.demo`, 'admin', timestamp]);
        await tx.query(insertUser, [`${tenantId}-user`, tenantId, `${name} User`, `user@${tenantId}.demo`, 'user', timestamp]);
        await recordEvent(tx, tenantId, 'created', `Created ${name} with default admin and user.`);
        const settings = { tenant_id: tenantId, ...defaultSettingsColumns(name), updated_at: timestamp };
        const columns = Object.keys(settings);
        await tx.query(`INSERT INTO tenant_settings (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, Object.values(settings));
        return getTenant(tx, tenantId);
      }).catch(duplicateTenantName);
    },
    async updateTenant(platform: PlatformActor, tenantId: string, input: TenantUpdate): Promise<Tenant> {
      requirePlatform(platform);
      return db.withPlatform(async (tx) => {
        await tx.query('SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
        const current = await getTenant(tx, tenantId);
        const name = input.name === undefined ? current.name : cleanTenantName(input.name);
        const status = input.status ?? current.status;
        if (status !== 'active' && status !== 'disabled') throw new Error('Tenant status is invalid.');
        if (name !== current.name) await recordEvent(tx, tenantId, 'updated', `Renamed from ${current.name} to ${name}.`);
        if (status !== current.status) await recordEvent(tx, tenantId, status === 'disabled' ? 'disabled' : 'enabled', status === 'disabled' ? 'Tenant disabled.' : 'Tenant enabled.');
        await tx.query('UPDATE tenants SET name = $1, status = $2, updated_at = $3 WHERE id = $4', [name, status, now(), tenantId]);
        return getTenant(tx, tenantId);
      }).catch(duplicateTenantName);
    },
    async listTenantHistory(platform: PlatformActor, tenantId: string): Promise<TenantHistoryEvent[]> {
      requirePlatform(platform);
      return db.withPlatform(async (tx) => {
        await getTenant(tx, tenantId);
        return (await tx.query<Row>('SELECT id, tenant_id, action, detail, occurred_at FROM tenant_lifecycle_events WHERE tenant_id = $1 ORDER BY occurred_at, id', [tenantId])).rows.map(parseTenantHistoryRow);
      });
    },
    async listTenantUsers(context: TenantContext): Promise<TenantUser[]> {
      return db.withTenant(context.tenantId, async (tx) => {
        requireAdminRole(await actorRole(tx, context));
        return (await tx.query<Row>(`SELECT ${userColumns} FROM users WHERE tenant_id = $1 ORDER BY lower(name), id`, [context.tenantId])).rows.map(parseTenantUserRow);
      });
    },
    async createTenantUser(context: TenantContext, input: TenantUserInput): Promise<TenantUser> {
      return db.withTenant(context.tenantId, async (tx) => {
        requireAdminRole(await actorRole(tx, context));
        const user = newTenantUser(input);
        const { rows } = await tx.query<Row>(`INSERT INTO users (id, tenant_id, name, email, role, status, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING ${userColumns}`, [`${context.tenantId}-user-${crypto.randomUUID()}`, context.tenantId, user.name, user.email, user.role, now()]);
        return parseTenantUserRow(rows[0]);
      }).catch(duplicateEmail);
    },
    /** Locks the tenant's active admins, in id order, before reading anything, so two admins demoting each other cannot both pass the last-admin check. */
    async updateTenantUser(context: TenantContext, userId: string, update: TenantUserUpdate): Promise<TenantUser> {
      return db.withTenant(context.tenantId, async (tx) => {
        await tx.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE`, [context.tenantId]);
        requireAdminRole(await actorRole(tx, context));
        const { rows } = await tx.query<Row>(`SELECT ${userColumns} FROM users WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [userId, context.tenantId]);
        if (!rows[0]) throw new Error('This user does not belong to your tenant.');
        const { user, removesActiveAdmin } = updatedTenantUser(parseTenantUserRow(rows[0]), update);
        if (removesActiveAdmin) {
          const others = await tx.query<Row>(`SELECT count(*) AS count FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active' AND id <> $2`, [context.tenantId, userId]);
          if (Number(others.rows[0].count) === 0) throw new Error(LAST_ADMIN_MESSAGE);
        }
        const updated = await tx.query<Row>(`UPDATE users SET name = $1, email = $2, role = $3, status = $4 WHERE id = $5 AND tenant_id = $6 RETURNING ${userColumns}`, [user.name, user.email, user.role, user.status, userId, context.tenantId]);
        return parseTenantUserRow(updated.rows[0]);
      }).catch(duplicateEmail);
    },
  } satisfies Partial<TenantStore>;
}
