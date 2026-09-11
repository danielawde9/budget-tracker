-- Realtime provisions supabase_realtime_admin on hosted projects; the bare
-- supabase/postgres image lacks it, yet the CLI role dump still grants it a
-- parameter (2026-09-11 drill defect 1). All attributes are false and it is a
-- member of anon, authenticated, and service_role, as recovered from the Budget
-- Production fingerprint. The backup artifact itself stays unmodified.
DO $budget_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_realtime_admin'
  ) THEN
    CREATE ROLE supabase_realtime_admin
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
    GRANT anon, authenticated, service_role TO supabase_realtime_admin;
  END IF;
END
$budget_restore$;
