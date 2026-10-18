import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { parseTaskNoteRow } from './rows';
import { checkTaskNote, isCalendarDate, TASK_NOTE_CUSTOMER_MESSAGE, TASK_NOTE_NOT_FOUND } from './rules';
import type { TaskNote, TaskNoteInput, TaskNoteQuery } from './types';

type Row = Record<string, unknown>;

export function createTaskNoteMethods(database: DatabaseSync) {
  function list(tenantId: string, query: TaskNoteQuery & { id?: string } = {}): TaskNote[] {
    const conditions = ['task_notes.tenant_id = ?']; const values: string[] = [tenantId];
    if (query.date) { if (!isCalendarDate(query.date)) throw new Error('Choose a valid date.'); conditions.push('task_notes.note_date = ?'); values.push(query.date); }
    if (query.customerId) { conditions.push('task_notes.customer_id = ?'); values.push(query.customerId); }
    if (query.id) { conditions.push('task_notes.id = ?'); values.push(query.id); }
    return (database.prepare(`SELECT task_notes.*, customers.company_name AS customer_name FROM task_notes JOIN customers ON customers.id = task_notes.customer_id WHERE ${conditions.join(' AND ')} ORDER BY task_notes.note_date DESC, task_notes.created_at DESC, task_notes.id`).all(...values) as Row[]).map(parseTaskNoteRow);
  }
  function requireCustomer(tenantId: string, customerId: string) {
    if (!database.prepare('SELECT 1 FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)) throw new Error(TASK_NOTE_CUSTOMER_MESSAGE);
  }
  return {
    listTaskNotes(context: TenantContext, query: TaskNoteQuery = {}): TaskNote[] {
      return list(context.tenantId, query);
    },
    createTaskNote(context: TenantContext, input: TaskNoteInput): TaskNote {
      checkTaskNote(input);
      requireCustomer(context.tenantId, input.customerId);
      const id = `task-note-${crypto.randomUUID()}`; const timestamp = now();
      database.prepare('INSERT INTO task_notes (id, tenant_id, customer_id, note_date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, context.tenantId, input.customerId, input.date, input.note.trim(), timestamp, timestamp);
      return list(context.tenantId, { id })[0];
    },
    updateTaskNote(context: TenantContext, id: string, input: TaskNoteInput): TaskNote {
      checkTaskNote(input);
      if (!database.prepare('SELECT 1 FROM task_notes WHERE id = ? AND tenant_id = ?').get(id, context.tenantId)) throw new Error(TASK_NOTE_NOT_FOUND);
      requireCustomer(context.tenantId, input.customerId);
      database.prepare('UPDATE task_notes SET customer_id = ?, note_date = ?, note = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(input.customerId, input.date, input.note.trim(), now(), id, context.tenantId);
      return list(context.tenantId, { id })[0];
    },
    deleteTaskNote(context: TenantContext, id: string): void {
      if (!database.prepare('DELETE FROM task_notes WHERE id = ? AND tenant_id = ?').run(id, context.tenantId).changes) throw new Error(TASK_NOTE_NOT_FOUND);
    },
  };
}
