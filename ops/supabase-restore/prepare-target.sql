-- Budget Supabase scratch restore: target preparation.
--
-- Runs first inside the single psql transaction rendered by
-- scripts/ops/supabase-scratch-restore.sh. It pins that transaction, refuses
-- the commit unless the stream's completion segment runs, proves the target
-- is a pristine supabase/postgres image, and drops the image's
-- placeholder Auth schema so the dumped Auth schema is created instead of
-- being skipped by the CLI's CREATE ... IF NOT EXISTS statements.

CREATE TEMPORARY TABLE budget_restore_state (
  transaction_id xid8 NOT NULL,
  complete boolean NOT NULL
) ON COMMIT DROP;

-- psql --single-transaction commits whatever it read when input ends, so a cut
-- stream would otherwise commit a partial restore. This deferred check runs at
-- COMMIT in every replication role and refuses unless the final segment ran.
CREATE FUNCTION pg_temp.budget_restore_require_completion()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $budget_restore$
BEGIN
  IF NOT (SELECT complete FROM pg_temp.budget_restore_state) THEN
    RAISE EXCEPTION 'restore stream ended before its completion segment';
  END IF;
  RETURN NULL;
END
$budget_restore$;

CREATE CONSTRAINT TRIGGER budget_restore_require_completion
  AFTER INSERT ON pg_temp.budget_restore_state
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pg_temp.budget_restore_require_completion();

ALTER TABLE pg_temp.budget_restore_state
  ENABLE ALWAYS TRIGGER budget_restore_require_completion;

INSERT INTO pg_temp.budget_restore_state (transaction_id, complete)
VALUES (pg_catalog.pg_current_xact_id(), false);

CREATE FUNCTION pg_temp.budget_restore_assert_single_transaction()
  RETURNS void
  LANGUAGE plpgsql
  AS $budget_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_temp.budget_restore_state
    WHERE transaction_id = pg_catalog.pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'restore stream left its single transaction';
  END IF;
END
$budget_restore$;

DO $budget_restore$
DECLARE
  image_schemas CONSTANT text[] := ARRAY[
    'auth', 'extensions', 'graphql', 'graphql_public', 'information_schema',
    'pg_catalog', 'pg_toast', 'pgbouncer', 'public', 'realtime', 'storage', 'vault'
  ];
  placeholder_tables CONSTANT text[] := ARRAY[
    'audit_log_entries', 'instances', 'refresh_tokens', 'schema_migrations', 'users'
  ];
  -- The image seeds auth.schema_migrations with these GoTrue versions
  -- (measured on supabase/postgres:17.6.1.166, 2026-09-11); every other
  -- placeholder table starts empty.
  placeholder_versions CONSTANT text[] := ARRAY[
    '20171026211738', '20171026211808', '20171026211834', '20180103212743',
    '20180108183307', '20180119214651', '20180125194653'
  ];
  empty_tables CONSTANT text[] := ARRAY['audit_log_entries', 'instances', 'refresh_tokens', 'users'];
  empty_table text;
  table_rows bigint;
BEGIN
  IF current_user <> 'supabase_admin'
    OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'scratch restore must run as the supabase_admin superuser';
  END IF;
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'scratch target is not PostgreSQL 17';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname::text <> ALL (image_schemas)
      AND namespace.nspname !~ '^pg_(toast_)?temp_[0-9]+$'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_type WHERE typnamespace = 'public'::regnamespace
  ) OR (
    SELECT pg_catalog.array_agg(relname::text ORDER BY relname)
    FROM pg_catalog.pg_class
    WHERE relnamespace = 'auth'::regnamespace AND relkind = 'r'
  ) IS DISTINCT FROM placeholder_tables THEN
    RAISE EXCEPTION 'scratch target is not pristine';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(version::text ORDER BY version)
    FROM auth.schema_migrations
  ) IS DISTINCT FROM placeholder_versions THEN
    RAISE EXCEPTION 'scratch target is not pristine';
  END IF;
  FOREACH empty_table IN ARRAY empty_tables LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM auth.%I', empty_table)
      INTO table_rows;
    IF table_rows <> 0 THEN
      RAISE EXCEPTION 'scratch target is not pristine';
    END IF;
  END LOOP;
END
$budget_restore$;

-- No CASCADE: an unexpected object in auth, or anything outside auth that
-- depends on the placeholder, fails the transaction instead of vanishing.
DROP TABLE auth.audit_log_entries, auth.instances, auth.refresh_tokens,
  auth.schema_migrations, auth.users;
DROP FUNCTION auth.email(), auth.role(), auth.uid();
DROP SCHEMA auth;
