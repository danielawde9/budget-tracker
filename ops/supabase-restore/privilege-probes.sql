-- Budget Supabase scratch restore: privilege smoke test.
--
-- Each probe from privilege-probes.txt (passed as psql variable
-- probe_manifest) runs as its role inside a subtransaction that is always
-- rolled back. Only SQLSTATE 42501 counts as `denied`; a statement that
-- succeeds (even on zero rows) is `allowed`, and any other error is reported
-- with its SQLSTATE. The outer transaction is rolled back as well.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\pset footer off
\pset pager off

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog;

CREATE FUNCTION pg_temp.budget_privilege_probe(probe_role text, probe_action text, probe_object text)
  RETURNS text
  LANGUAGE plpgsql
  AS $budget_probe$
DECLARE
  target_relation regclass;
  target_routine regprocedure;
  first_column name;
  probe_statement text;
BEGIN
  IF probe_action = 'execute' THEN
    target_routine := to_regprocedure(probe_object);
    IF target_routine IS NULL THEN
      RETURN 'missing';
    END IF;
    SELECT format('SELECT %I.%I(%s)', namespace.nspname, routine.proname, coalesce((
        SELECT string_agg(format('NULL::%s', format_type(argument.type_oid, NULL)), ', ' ORDER BY argument.position)
        FROM unnest(routine.proargtypes::oid[]) WITH ORDINALITY AS argument(type_oid, position)
      ), ''))
      INTO probe_statement
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE routine.oid = target_routine;
  ELSE
    target_relation := to_regclass(probe_object);
    IF target_relation IS NULL THEN
      RETURN 'missing';
    END IF;
    SELECT attribute.attname INTO first_column
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = target_relation
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attgenerated = ''
    ORDER BY attribute.attnum
    LIMIT 1;
    probe_statement := CASE probe_action
      WHEN 'select' THEN format('SELECT 1 FROM %s LIMIT 0', target_relation)
      WHEN 'insert' THEN format('INSERT INTO %s DEFAULT VALUES', target_relation)
      WHEN 'update' THEN format('UPDATE %s SET %I = %I WHERE false', target_relation, first_column, first_column)
      WHEN 'delete' THEN format('DELETE FROM %s WHERE false', target_relation)
    END;
  END IF;

  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', probe_role);
    EXECUTE probe_statement;
    RAISE EXCEPTION USING ERRCODE = 'BRP01', MESSAGE = 'privilege probe succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN 'denied';
    WHEN SQLSTATE 'BRP01' THEN
      RETURN 'allowed';
    WHEN OTHERS THEN
      RETURN 'error ' || SQLSTATE;
  END;
END
$budget_probe$;

SELECT concat_ws('|', 'probe', probe.role_name, probe.action, probe.object_name,
  pg_temp.budget_privilege_probe(probe.role_name, probe.action, probe.object_name))
FROM (
  SELECT parts[1] AS role_name, parts[2] AS action, parts[3] AS object_name, manifest.line_number
  FROM regexp_split_to_table(:'probe_manifest', E'\n') WITH ORDINALITY AS manifest(line, line_number)
  CROSS JOIN LATERAL regexp_match(
    manifest.line,
    '^(anon|authenticated) (select|insert|update|delete|execute) ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*(\([a-z0-9_ ,]*\))?)$'
  ) AS parts
  WHERE manifest.line <> '' AND manifest.line !~ '^#'
) AS probe
ORDER BY probe.line_number;

ROLLBACK;
