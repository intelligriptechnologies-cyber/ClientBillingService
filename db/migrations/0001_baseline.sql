-- Up Migration

-- Baseline schema from src/lib/store/schema.ts (ADR 0001, unit D3). Runs as cbs_owner, which owns every table.
-- Tenant isolation has three layers: tenant_id on every tenant row, composite foreign keys that carry tenant_id,
-- and forced row-level security keyed on the transaction-local setting app.tenant_id that withTenant sets.
-- Money is bigint minor units, rates are numeric(6,3), calendar days are date, instants are timestamptz.

CREATE TABLE tenants (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One membership per row: one Authelia username in one tenant with one role (ADR 0002, decision 2). The superadmin
-- is an Authelia group and has no row. authelia_username stays null until first arrival binds it by email.
CREATE TABLE users (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  email text NOT NULL,
  authelia_username text,
  role text NOT NULL CHECK (role IN ('admin', 'user')),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, authelia_username)
);
CREATE UNIQUE INDEX users_tenant_email ON users (tenant_id, lower(email));

CREATE TABLE tenant_records (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  label text NOT NULL
);

CREATE TABLE tenant_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants (id),
  company_name text NOT NULL,
  legal_name text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  invoice_prefix text NOT NULL,
  payment_terms_days integer NOT NULL,
  footer text NOT NULL DEFAULT '',
  invoice_template text NOT NULL,
  email_subject text NOT NULL,
  email_body text NOT NULL,
  smtp_host text NOT NULL DEFAULT '',
  smtp_port integer NOT NULL DEFAULT 587,
  smtp_user text NOT NULL DEFAULT '',
  smtp_password text NOT NULL DEFAULT '',
  smtp_from text NOT NULL DEFAULT '',
  log_retention_days integer NOT NULL DEFAULT 30,
  logo_data_url text NOT NULL DEFAULT '',
  stamp_data_url text NOT NULL DEFAULT '',
  signature_data_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL
);

CREATE TABLE tenant_lifecycle_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  action text NOT NULL CHECK (action IN ('created', 'updated', 'disabled', 'enabled')),
  detail text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE operational_logs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  kind text NOT NULL CHECK (kind IN ('feature-flow', 'error')),
  message text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE services (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  hsn_sac text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  monthly_minor bigint NOT NULL,
  quarterly_minor bigint NOT NULL,
  half_yearly_minor bigint NOT NULL,
  annual_minor bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE quotations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  quote_number text NOT NULL,
  customer_name text NOT NULL,
  customer_email text,
  status text NOT NULL CHECK (status IN ('draft')),
  archived_at timestamptz,
  total_minor bigint NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_number)
);

-- service_id is a copy of the service at quoting time, with no foreign key, as in SQLite.
CREATE TABLE quotation_lines (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  quotation_id text NOT NULL,
  service_id text NOT NULL,
  service_name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')),
  quantity integer NOT NULL,
  unit_price_minor bigint NOT NULL,
  line_total_minor bigint NOT NULL,
  FOREIGN KEY (tenant_id, quotation_id) REFERENCES quotations (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE invoice_formats (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  definition jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX invoice_formats_tenant_name ON invoice_formats (tenant_id, lower(name));
CREATE UNIQUE INDEX invoice_formats_one_default ON invoice_formats (tenant_id) WHERE is_default;

CREATE TABLE customers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  company_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  gstin text NOT NULL,
  state_code text NOT NULL DEFAULT '',
  billing_address text NOT NULL,
  invoice_delivery text NOT NULL CHECK (invoice_delivery IN ('monthly', 'quarterly', 'email', 'manual')),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  invoice_format_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_format_id) REFERENCES invoice_formats (tenant_id, id)
);

CREATE TABLE contracts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  customer_id text NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  value_minor bigint NOT NULL,
  payment_terms_days integer NOT NULL,
  billing_frequency text NOT NULL CHECK (billing_frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')),
  invoice_months jsonb NOT NULL,
  cycle_day integer NOT NULL,
  escalation_percent numeric(6, 3) NOT NULL,
  escalation_review_date date,
  renewal_notice_days integer NOT NULL,
  security_deposit_minor bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);

CREATE TABLE contract_services (
  tenant_id text NOT NULL REFERENCES tenants (id),
  contract_id text NOT NULL,
  service_id text NOT NULL,
  PRIMARY KEY (tenant_id, contract_id, service_id),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id)
);

CREATE TABLE contract_audit_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  contract_id text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE security_deposits (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  contract_id text NOT NULL,
  customer_id text NOT NULL,
  amount_minor bigint NOT NULL,
  settled_minor bigint NOT NULL DEFAULT 0,
  settlement_note text,
  settled_at timestamptz,
  status text NOT NULL CHECK (status IN ('held', 'settled')),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);

CREATE TABLE security_deposit_settlements (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  deposit_id text NOT NULL,
  amount_minor bigint NOT NULL,
  note text NOT NULL,
  settled_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, deposit_id) REFERENCES security_deposits (tenant_id, id)
);

CREATE TABLE invoices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  contract_id text,
  customer_id text NOT NULL,
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  taxable_minor bigint NOT NULL,
  gst_rate numeric(6, 3) NOT NULL,
  gst_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  paid_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('issued', 'paid', 'partial', 'overdue', 'void')),
  snapshot jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, invoice_number),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);

CREATE TABLE payments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  invoice_id text NOT NULL,
  payment_date date NOT NULL,
  amount_minor bigint NOT NULL,
  tds_minor bigint NOT NULL DEFAULT 0,
  write_off_minor bigint NOT NULL DEFAULT 0,
  method text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'card', 'cheque', 'other')),
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
);

CREATE TABLE payment_reminders (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  invoice_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
);

CREATE TABLE additional_services (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  customer_id text NOT NULL,
  contract_id text NOT NULL,
  service_date date NOT NULL,
  description text NOT NULL,
  price_minor bigint NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  billed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id)
);

CREATE TABLE task_notes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  customer_id text NOT NULL,
  note_date date NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);
CREATE INDEX task_notes_tenant_date ON task_notes (tenant_id, note_date DESC);

CREATE TABLE delivery_log (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  invoice_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email')),
  to_address text NOT NULL,
  cc_address text NOT NULL DEFAULT '',
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'not-configured')),
  error text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL,
  attempted_by text NOT NULL,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
);
CREATE INDEX delivery_log_invoice ON delivery_log (tenant_id, invoice_id, attempted_at DESC);

-- billing_period is a 'YYYY-MM' month label, not a date.
CREATE TABLE bulk_invoice_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  billing_period text NOT NULL,
  generated_count integer NOT NULL,
  skipped_count integer NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, billing_period)
);

-- Row-level security. FORCE applies the policy to the table owner too; cbs_owner and cbs_platform pass only
-- because they hold BYPASSRLS. Outside withTenant the setting is null or '', which matches no tenant.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE tenant_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_records USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE tenant_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_lifecycle_events USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE operational_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operational_logs USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON services USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotations USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_lines USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE invoice_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_formats FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_formats USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE contract_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_services USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE contract_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_audit_events USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE security_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_deposits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_deposits USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE security_deposit_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_deposit_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_deposit_settlements USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_reminders USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE additional_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE additional_services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON additional_services USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE task_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_notes USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_log USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE bulk_invoice_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_invoice_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bulk_invoice_runs USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Grants, per table. cbs_app reaches tenant tables only; tenants is pre-tenant and reached through withPlatform,
-- so cbs_app gets nothing on it. cbs_platform gets every table.

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_records TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_lifecycle_events TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON operational_logs TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotation_lines TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_formats TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_services TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_audit_events TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON security_deposits TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON security_deposit_settlements TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_reminders TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON additional_services TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_notes TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_log TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_invoice_runs TO cbs_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, tenant_records, tenant_settings, tenant_lifecycle_events, operational_logs, services, quotations,
  quotation_lines, invoice_formats, customers, contracts, contract_services, contract_audit_events, security_deposits,
  security_deposit_settlements, invoices, payments, payment_reminders, additional_services, task_notes, delivery_log,
  bulk_invoice_runs
  TO cbs_platform;

-- Down Migration

DROP TABLE bulk_invoice_runs, delivery_log, task_notes, additional_services, payment_reminders, payments, invoices,
  security_deposit_settlements, security_deposits, contract_audit_events, contract_services, contracts, customers,
  invoice_formats, quotation_lines, quotations, services, operational_logs, tenant_lifecycle_events, tenant_settings,
  tenant_records, users, tenants;
