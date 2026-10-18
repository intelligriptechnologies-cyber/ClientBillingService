/**
 * The per-database half of db/roles.sql, run as a superuser on each new database. The roles are cluster-wide and
 * already exist. The isolation test asserts these grants on every clone. Playwright's global setup runs it too, and
 * cannot load the migrator, so this module imports nothing.
 */
export const SCHEMA_GRANTS = `
  ALTER SCHEMA public OWNER TO cbs_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO cbs_app, cbs_platform;
`;
