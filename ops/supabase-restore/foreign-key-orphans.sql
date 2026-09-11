-- Budget Supabase scratch restore: foreign-key orphan check.
--
-- The CLI data dump loads with session_replication_role = replica, so foreign
-- keys are not enforced while rows arrive. This read-only check counts child
-- rows without a parent for every foreign key in the scratch database and
-- prints `fk|schema.table|constraint|orphan_rows`.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\pset footer off
\pset pager off

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL row_security = off;
SET LOCAL search_path = pg_catalog;

SELECT format(
  'SELECT %L || count(*) FROM %I.%I AS child WHERE (%s AND NOT EXISTS (SELECT 1 FROM %I.%I AS parent WHERE %s))%s',
  'fk|' || child_namespace.nspname || '.' || child_table.relname || '|' || foreign_key.conname || '|',
  child_namespace.nspname,
  child_table.relname,
  key_columns.all_present,
  parent_namespace.nspname,
  parent_table.relname,
  key_columns.matching_parent,
  CASE
    WHEN foreign_key.confmatchtype = 'f'
      THEN format(' OR num_nonnulls(%s) NOT IN (0, %s)', key_columns.child_list, key_columns.column_count)
    ELSE ''
  END)
FROM pg_constraint AS foreign_key
JOIN pg_class AS child_table ON child_table.oid = foreign_key.conrelid
JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_table.relnamespace
JOIN pg_class AS parent_table ON parent_table.oid = foreign_key.confrelid
JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_table.relnamespace
CROSS JOIN LATERAL (
  SELECT
    string_agg(format('child.%I IS NOT NULL', child_column.attname), ' AND ' ORDER BY key_column.position) AS all_present,
    string_agg(format('parent.%I = child.%I', parent_column.attname, child_column.attname), ' AND ' ORDER BY key_column.position) AS matching_parent,
    string_agg(format('child.%I', child_column.attname), ', ' ORDER BY key_column.position) AS child_list,
    count(*) AS column_count
  FROM unnest(foreign_key.conkey, foreign_key.confkey) WITH ORDINALITY AS key_column(child_attnum, parent_attnum, position)
  JOIN pg_attribute AS child_column
    ON child_column.attrelid = foreign_key.conrelid AND child_column.attnum = key_column.child_attnum
  JOIN pg_attribute AS parent_column
    ON parent_column.attrelid = foreign_key.confrelid AND parent_column.attnum = key_column.parent_attnum
) AS key_columns
WHERE foreign_key.contype = 'f'
  AND foreign_key.conparentid = 0
ORDER BY 1
\gexec

COMMIT;
