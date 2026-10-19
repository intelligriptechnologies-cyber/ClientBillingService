// The demo data from src/lib/store/schema.ts, for Postgres (ADR 0001, unit D3). Run it on purpose with
// `npm run db:seed`, as cbs_owner through DATABASE_MIGRATE_URL; nothing seeds on app start. Every insert is
// ON CONFLICT DO NOTHING, so a second run changes nothing. There is no superadmin row: the superadmin is an
// Authelia group (ADR 0002, decision 3). Each demo user gets an authelia_username and no password.
import { pathToFileURL } from 'node:url';
import pg from 'pg';

type Row = Record<string, unknown>;
type Queryable = Pick<pg.Client, 'query'>;

const SEEDED_AT = '2026-10-01T09:00:00.000Z';

const tenantSeeds = [
  { id: 'nexio', name: 'Nexio Hyper', adminEmail: 'Admin@nexio.com', userEmail: 'user@nexio.com' },
  { id: 'maasp', name: 'MAASP Associates', adminEmail: 'Admin@maasp.com', userEmail: 'user@massp.com' },
  { id: 'evo', name: 'Evo Fitness', adminEmail: 'Admin@evo.com', userEmail: 'user@evo.com' },
  { id: 'gripdata', name: 'Gripdata Analytics', adminEmail: 'Admin@gripdata.com', userEmail: 'user@gripdata.com' },
  { id: 'od', name: 'OD Badminton', adminEmail: 'Admin@od.com', userEmail: 'user@od.com' },
];

function demoRows(): Array<[table: string, rows: Row[]]> {
  const each = (build: (tenant: (typeof tenantSeeds)[number]) => Row | Row[]) => tenantSeeds.flatMap<Row>(build);
  const prefix = (name: string) => name.slice(0, 3).toUpperCase();
  const snapshot = (tenant: (typeof tenantSeeds)[number]) => ({ companyName: tenant.name, gstin: '', address: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', customerName: `${tenant.name} Customer`, customerEmail: `billing@${tenant.id}.example`, customerAddress: 'Demo billing address, Bengaluru', gstRate: 18, footer: 'Thank you for your business.' });
  const invoice = { taxable_minor: 100000, gst_rate: 18, gst_minor: 18000, total_minor: 118000, issued_at: SEEDED_AT };
  return [
    ['tenants', each((t) => ({ id: t.id, name: t.name, status: 'active', created_at: SEEDED_AT, updated_at: SEEDED_AT }))],
    ['users', each((t) => [
      { id: `${t.id}-admin`, tenant_id: t.id, name: `${t.name} Admin`, email: t.adminEmail, authelia_username: `${t.id}-admin`, role: 'admin', status: 'active', created_at: SEEDED_AT },
      { id: `${t.id}-user`, tenant_id: t.id, name: `${t.name} User`, email: t.userEmail, authelia_username: `${t.id}-user`, role: 'user', status: 'active', created_at: SEEDED_AT },
    ])],
    ['tenant_records', each((t) => ({ id: `${t.id}-baseline`, tenant_id: t.id, label: `${t.name} baseline demo record` }))],
    ['tenant_settings', each((t) => ({ tenant_id: t.id, company_name: t.name, invoice_prefix: prefix(t.name), payment_terms_days: 14, footer: 'Thank you for your business.', invoice_template: 'Invoice {{invoiceNumber}} for {{customerName}}', email_subject: 'Your invoice {{invoiceNumber}}', email_body: 'Hello {{customerName}}, please find your invoice attached.', updated_at: SEEDED_AT }))],
    ['customers', each((t) => ({ id: `${t.id}-customer`, tenant_id: t.id, company_name: `${t.name} Customer`, contact_name: 'Billing Contact', email: `billing@${t.id}.example`, phone: '+91 90000 00000', gstin: '29AAGCB7383J1Z4', state_code: '29', billing_address: 'Demo billing address, Bengaluru', invoice_delivery: 'monthly', status: 'active', created_at: SEEDED_AT, updated_at: SEEDED_AT }))],
    ['services', each((t) => ({ id: `${t.id}-service`, tenant_id: t.id, name: 'Managed billing service', description: 'Seeded recurring billing service', hsn_sac: '998311', status: 'active', monthly_minor: 100000, quarterly_minor: 280000, half_yearly_minor: 540000, annual_minor: 1000000, created_at: SEEDED_AT, updated_at: SEEDED_AT }))],
    ['contracts', each((t) => ({ id: `${t.id}-seed-contract`, tenant_id: t.id, customer_id: `${t.id}-customer`, name: `${t.name} managed billing contract`, start_date: '2026-01-01', end_date: '2026-12-31', value_minor: 100000, payment_terms_days: 14, billing_frequency: 'monthly', invoice_months: [], cycle_day: 1, escalation_percent: 0, escalation_review_date: null, renewal_notice_days: 30, security_deposit_minor: 25000, status: 'active', created_at: SEEDED_AT, updated_at: SEEDED_AT }))],
    ['contract_services', each((t) => ({ tenant_id: t.id, contract_id: `${t.id}-seed-contract`, service_id: `${t.id}-service` }))],
    ['security_deposits', each((t) => ({ id: `${t.id}-seed-deposit`, tenant_id: t.id, contract_id: `${t.id}-seed-contract`, customer_id: `${t.id}-customer`, amount_minor: 25000, settled_minor: 0, status: 'held', created_at: SEEDED_AT }))],
    ['invoices', each((t) => [
      { id: `${t.id}-invoice-001`, tenant_id: t.id, contract_id: `${t.id}-seed-contract`, customer_id: `${t.id}-customer`, invoice_number: `${prefix(t.name)}-2026-001`, invoice_date: '2026-10-01', due_date: '2026-10-15', ...invoice, paid_minor: 0, status: 'issued', snapshot: snapshot(t) },
      { id: `${t.id}-invoice-payment-001`, tenant_id: t.id, contract_id: `${t.id}-seed-contract`, customer_id: `${t.id}-customer`, invoice_number: `${prefix(t.name)}-2026-000`, invoice_date: '2026-09-01', due_date: '2026-09-15', ...invoice, paid_minor: 118000, status: 'paid', snapshot: snapshot(t) },
    ])],
    ['payments', each((t) => ({ id: `${t.id}-seed-payment`, tenant_id: t.id, invoice_id: `${t.id}-invoice-payment-001`, payment_date: '2026-09-10', amount_minor: 100000, tds_minor: 18000, write_off_minor: 0, method: 'bank_transfer', reference: 'SEED-PAID', notes: 'Seeded settled invoice.', recorded_at: SEEDED_AT }))],
  ];
}

/** Inserts rows that share one column set, skipping any that conflict. Objects and arrays go in as JSON, for jsonb columns. */
export async function insertRows(client: Queryable, table: string, rows: Row[]) {
  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = Object.values(row).map((value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : value));
    const result = await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, values);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/** Returns the rows inserted per table; a second run returns zeros. */
export async function seedDemo(client: Queryable) {
  const inserted: Record<string, number> = {};
  await client.query('BEGIN');
  try {
    for (const [table, rows] of demoRows()) inserted[table] = await insertRows(client, table, rows);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return inserted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_MIGRATE_URL;
  if (!connectionString) {
    console.error('Set DATABASE_MIGRATE_URL (the cbs_owner role) to seed the demo data.');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    console.log('Rows inserted per table:', await seedDemo(client));
  } finally {
    await client.end();
  }
}
