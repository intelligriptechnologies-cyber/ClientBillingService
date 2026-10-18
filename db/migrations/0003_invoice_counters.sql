-- Up Migration

-- The per-tenant invoice counter (ADR 0001, unit D8). Under a connection pool, counting a tenant's invoices to
-- number the next one lets two issues take the same number. Issuing takes the next number with UPDATE ... RETURNING
-- on the tenant's row instead. The row stays locked until the issuing transaction ends, so issues take turns, and an
-- issue that rolls back gives its number back. A tenant with no row yet, such as one whose invoices arrived through
-- the seed or an import, gets one on its first issue, starting from the number of invoices it already has, which is
-- where numbering by count left off.
CREATE TABLE invoice_counters (
  tenant_id text PRIMARY KEY REFERENCES tenants (id),
  last_number bigint NOT NULL CHECK (last_number >= 0)
);

ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_counters USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- No DELETE for cbs_app: deleting a row would restart the tenant's numbering from its invoice count.
GRANT SELECT, INSERT, UPDATE ON invoice_counters TO cbs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_counters TO cbs_platform;

-- Down Migration

DROP TABLE invoice_counters;
