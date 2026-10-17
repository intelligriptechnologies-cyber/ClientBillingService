import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import type { AppSession, TaskNote, TaskNoteInput, TaskNoteQuery } from './types';

function taskNoteFromRow(row: Record<string, unknown>): TaskNote { return { id: String(row.id), tenantId: String(row.tenant_id), customerId: String(row.customer_id), customerName: String(row.customer_name), date: String(row.note_date), note: String(row.note), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function validTaskNoteDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function validateTaskNote(input: TaskNoteInput): void { if (!input || typeof input.customerId !== 'string' || !input.customerId) throw new Error('Choose a customer.'); if (typeof input.date !== 'string' || !validTaskNoteDate(input.date)) throw new Error('Choose a valid date.'); if (typeof input.note !== 'string' || !input.note.trim()) throw new Error('Note is required.'); }

export function createTaskNoteMethods(database: DatabaseSync) {
  return {
    listTaskNotes(session: AppSession, query: TaskNoteQuery = {}): TaskNote[] {
      requireTenantMember(session);
      const conditions = ['task_notes.tenant_id = ?']; const values: string[] = [session.tenantId];
      if (query.date) { if (!validTaskNoteDate(query.date)) throw new Error('Choose a valid date.'); conditions.push('task_notes.note_date = ?'); values.push(query.date); }
      if (query.customerId) { conditions.push('task_notes.customer_id = ?'); values.push(query.customerId); }
      return (database.prepare(`SELECT task_notes.*, customers.company_name AS customer_name FROM task_notes JOIN customers ON customers.id = task_notes.customer_id WHERE ${conditions.join(' AND ')} ORDER BY task_notes.note_date DESC, task_notes.created_at DESC`).all(...values) as Record<string, unknown>[]).map(taskNoteFromRow);
    },
    createTaskNote(session: AppSession, input: TaskNoteInput): TaskNote {
      requireTenantMember(session); validateTaskNote(input);
      if (!database.prepare('SELECT 1 FROM customers WHERE id = ? AND tenant_id = ?').get(input.customerId, session.tenantId)) throw new Error('The selected customer does not belong to your tenant.');
      const id = `task-note-${crypto.randomUUID()}`; const timestamp = now();
      database.prepare('INSERT INTO task_notes (id, tenant_id, customer_id, note_date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, session.tenantId, input.customerId, input.date, input.note.trim(), timestamp, timestamp);
      return this.listTaskNotes(session).find((item) => item.id === id)!;
    },
    updateTaskNote(session: AppSession, id: string, input: TaskNoteInput): TaskNote {
      requireTenantMember(session); validateTaskNote(input);
      if (!database.prepare('SELECT 1 FROM task_notes WHERE id = ? AND tenant_id = ?').get(id, session.tenantId)) throw new Error('Task note not found.');
      if (!database.prepare('SELECT 1 FROM customers WHERE id = ? AND tenant_id = ?').get(input.customerId, session.tenantId)) throw new Error('The selected customer does not belong to your tenant.');
      const result = database.prepare('UPDATE task_notes SET customer_id = ?, note_date = ?, note = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(input.customerId, input.date, input.note.trim(), now(), id, session.tenantId);
      if (!result.changes) throw new Error('Task note not found.');
      return this.listTaskNotes(session).find((item) => item.id === id)!;
    },
    deleteTaskNote(session: AppSession, id: string): void {
      requireTenantMember(session);
      if (!database.prepare('DELETE FROM task_notes WHERE id = ? AND tenant_id = ?').run(id, session.tenantId).changes) throw new Error('Task note not found.');
    },
  };
}
