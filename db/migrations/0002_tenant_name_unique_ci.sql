-- Up Migration

-- Tenant names are unique regardless of case (ADR 0001, unit D5). The store has always refused a name that differs
-- from another only in case, but under a connection pool two creates can both pass that check. This index makes the
-- database refuse the second one, and the store reports it as a duplicate name.
CREATE UNIQUE INDEX tenants_lower_name ON tenants (lower(name));

-- Down Migration

DROP INDEX tenants_lower_name;
