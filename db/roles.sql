-- The three database roles (ADR 0001, decision 5 and Consequences). Run it as the container superuser against
-- the application database. It is safe to run again: a second run changes nothing.
--
--   cbs_owner     owns the schema, runs migrations, the seed and the SQLite import. BYPASSRLS, because FORCE
--                 row-level security applies to the table owner and a copying migration would see no rows.
--   cbs_app       the runtime role. Owns nothing and has no BYPASSRLS, so row-level security always applies.
--   cbs_platform  BYPASSRLS, used only from withPlatform.
--
-- Table privileges are not granted here. Each migration grants them per table, so a pre-tenant table
-- (tenants, api_tokens) never reaches cbs_app by default.
--
-- Roles are cluster-wide but schema grants are per database. Run this file once in every database that the
-- app or the tests use, including the test template database.
--
-- Pass real passwords with `psql -v owner_password=... -v app_password=... -v platform_password=...`.
-- The defaults below are dev-only placeholders and must match .env.example.

\if :{?owner_password}
\else
  \set owner_password cbs_owner_dev_only
\endif
\if :{?app_password}
\else
  \set app_password cbs_app_dev_only
\endif
\if :{?platform_password}
\else
  \set platform_password cbs_platform_dev_only
\endif

SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['cbs_owner', 'cbs_app', 'cbs_platform']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE cbs_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD :'owner_password';
ALTER ROLE cbs_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE cbs_platform WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD :'platform_password';

ALTER SCHEMA public OWNER TO cbs_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cbs_app, cbs_platform;
