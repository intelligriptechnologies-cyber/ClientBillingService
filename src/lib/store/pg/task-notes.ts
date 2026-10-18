import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseTaskNoteRow } from '../rows';
import { checkTaskNote, isCalendarDate, TASK_NOTE_CUSTOMER_MESSAGE, TASK_NOTE_NOT_FOUND } from '../rules';
import { now } from '../shared';
import type { TaskNote, TaskNoteInput, TaskNoteQuery, TenantStore } from '../types';

type Row = Record<string, unknown>;

async function list(tx: Tx, tenantId: string, query: TaskNoteQuery & { id?: string } = {}): Promise<TaskNote[]> {
  const conditions = ['task_notes.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
  if (query.date) { if (!isCalendarDate(query.date)) throw new Error('Choose a valid date.'); where((p) => `task_notes.note_date = ${p}`, query.date); }
  if (query.customerId) where((p) => `task_notes.customer_id = ${p}`, query.customerId);
  if (query.id) where((p) => `task_notes.id = ${p}`, query.id);
  const { rows } = await tx.query<Row>(
    `SELECT task_notes.*, customers.company_name AS customer_name FROM task_notes JOIN customers ON customers.tenant_id = task_notes.tenant_id AND customers.id = task_notes.customer_id
     WHERE ${conditions.join(' AND ')} ORDER BY task_notes.note_date DESC, task_notes.created_at DESC, task_notes.id COLLATE "C"`,
    values,
  );
  return rows.map(parseTaskNoteRow);
}

async function requireCustomer(tx: Tx, tenantId: string, customerId: string) {
  const { rows } = await tx.query('SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2', [customerId, tenantId]);
  if (!rows[0]) throw new Error(TASK_NOTE_CUSTOMER_MESSAGE);
}

export function createPgTaskNoteMethods(db: Database) {
  return {
    async listTaskNotes(context: TenantContext, query: TaskNoteQuery = {}): Promise<TaskNote[]> {
      return db.withTenant(context.tenantId, (tx) => list(tx, context.tenantId, query));
    },
    async createTaskNote(context: TenantContext, input: TaskNoteInput): Promise<TaskNote> {
      checkTaskNote(input);
      return db.withTenant(context.tenantId, async (tx) => {
        await requireCustomer(tx, context.tenantId, input.customerId);
        const id = `task-note-${crypto.randomUUID()}`; const timestamp = now();
        await tx.query('INSERT INTO task_notes (id, tenant_id, customer_id, note_date, note, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)', [id, context.tenantId, input.customerId, input.date, input.note.trim(), timestamp]);
        return (await list(tx, context.tenantId, { id }))[0];
      });
    },
    /** A full replace in one UPDATE, so the last save wins whole. */
    async updateTaskNote(context: TenantContext, id: string, input: TaskNoteInput): Promise<TaskNote> {
      checkTaskNote(input);
      return db.withTenant(context.tenantId, async (tx) => {
        const existing = await tx.query('SELECT 1 FROM task_notes WHERE id = $1 AND tenant_id = $2', [id, context.tenantId]);
        if (!existing.rows[0]) throw new Error(TASK_NOTE_NOT_FOUND);
        await requireCustomer(tx, context.tenantId, input.customerId);
        const { rowCount } = await tx.query('UPDATE task_notes SET customer_id = $1, note_date = $2, note = $3, updated_at = $4 WHERE id = $5 AND tenant_id = $6', [input.customerId, input.date, input.note.trim(), now(), id, context.tenantId]);
        if (!rowCount) throw new Error(TASK_NOTE_NOT_FOUND);
        return (await list(tx, context.tenantId, { id }))[0];
      });
    },
    async deleteTaskNote(context: TenantContext, id: string): Promise<void> {
      const { rowCount } = await db.withTenant(context.tenantId, (tx) => tx.query('DELETE FROM task_notes WHERE id = $1 AND tenant_id = $2', [id, context.tenantId]));
      if (!rowCount) throw new Error(TASK_NOTE_NOT_FOUND);
    },
  } satisfies Partial<TenantStore>;
}
