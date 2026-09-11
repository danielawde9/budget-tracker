-- Budget Supabase catalog and data fingerprint, format v1.
--
-- One definition fingerprints both sides of a restore comparison: Budget
-- Production (read-only, as postgres, and only with Daniel's explicit approval)
-- and a restored scratch target (scripts/ops/supabase-scratch-restore.sh).
-- Every line is `kind|identity|details`; table rows appear only as count:md5
-- and non-allowlisted setting values only as md5. A NULL ACL is normalized to
-- acldefault() for its object kind and owner, so a never-granted object and an
-- explicit default ACL compare equal.
--
-- Scope: every schema the Supabase CLI dumps as application schema, plus auth
-- and supabase_migrations. The CLI's internal platform schemas are excluded
-- because the scratch image provides them differently. Row data of the five
-- Auth session-credential tables is excluded because the data dump omits it.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\pset footer off
\pset pager off

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;
SET LOCAL search_path = pg_catalog;
SET LOCAL "TimeZone" = 'UTC';
SET LOCAL "DateStyle" = 'ISO, YMD';
SET LOCAL "IntervalStyle" = 'postgres';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

SELECT 'budget-supabase-fingerprint-v1';

WITH scope AS (
  SELECT namespace.oid, namespace.nspname::text AS name, namespace.nspowner, namespace.nspacl
  FROM pg_namespace AS namespace
  WHERE namespace.nspname IN ('auth', 'supabase_migrations')
    OR NOT (
      namespace.nspname LIKE 'pg\_%'
      OR namespace.nspname LIKE 'timescaledb\_%'
      OR namespace.nspname LIKE '\_timescaledb\_%'
      OR namespace.nspname IN (
        'information_schema', '_analytics', '_realtime', '_supavisor', 'cron', 'dbdev',
        'etl', 'extensions', 'graphql', 'graphql_public', 'net', 'pgbouncer', 'pgmq',
        'pgsodium', 'pgsodium_masks', 'pgtle', 'realtime', 'repack', 'storage',
        'supabase_functions', 'tiger', 'tiger_data', 'topology', 'vault'
      )
    )
),
readable_setting (name) AS (
  VALUES ('search_path'), ('statement_timeout'), ('lock_timeout'),
    ('idle_in_transaction_session_timeout'), ('log_statement'),
    ('session_preload_libraries'), ('default_transaction_read_only')
),
configuration (identity, config) AS (
  SELECT 'function:' || routine.oid::regprocedure::text, routine.proconfig
  FROM pg_proc AS routine
  JOIN scope ON scope.oid = routine.pronamespace
  WHERE routine.proconfig IS NOT NULL
  UNION ALL
  SELECT
    'role:' || CASE WHEN setting.setrole = 0 THEN '*' ELSE pg_get_userbyid(setting.setrole)::text END
      || '|database:' || CASE
        WHEN setting.setdatabase = 0 THEN '*'
        ELSE (SELECT database.datname::text FROM pg_database AS database WHERE database.oid = setting.setdatabase)
      END,
    setting.setconfig
  FROM pg_db_role_setting AS setting
),
fingerprint (entry) AS (
  SELECT concat_ws('|', 'schema', scope.name,
    'owner=' || pg_get_userbyid(scope.nspowner),
    'acl=' || coalesce((
      SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C")
      FROM unnest(coalesce(scope.nspacl, acldefault('n', scope.nspowner))) AS item
    ), ''))
  FROM scope

  UNION ALL
  SELECT concat_ws('|', 'relation', scope.name || '.' || relation.relname,
    'kind=' || relation.relkind::text,
    'owner=' || pg_get_userbyid(relation.relowner),
    'rls=' || relation.relrowsecurity,
    'force_rls=' || relation.relforcerowsecurity,
    'options=' || coalesce(array_to_string(relation.reloptions, ','), ''),
    'definition=' || CASE
      WHEN relation.relkind IN ('v', 'm') THEN md5(pg_get_viewdef(relation.oid))
      ELSE ''
    END,
    'acl=' || coalesce((
      SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C")
      FROM unnest(coalesce(
        relation.relacl,
        acldefault(CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END::"char", relation.relowner)
      )) AS item
    ), ''))
  FROM pg_class AS relation
  JOIN scope ON scope.oid = relation.relnamespace
  WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')

  UNION ALL
  -- Position counts non-dropped columns only, so a production table with
  -- dropped columns still matches its freshly created restore.
  SELECT concat_ws('|', 'column', scope.name || '.' || relation.relname,
    row_number() OVER (PARTITION BY attribute.attrelid ORDER BY attribute.attnum),
    attribute.attname,
    format_type(attribute.atttypid, attribute.atttypmod),
    'not_null=' || attribute.attnotnull,
    'default=' || coalesce(translate(pg_get_expr(column_default.adbin, column_default.adrelid), E'\n\r', '  '), ''),
    'identity=' || attribute.attidentity::text,
    'generated=' || attribute.attgenerated::text,
    'collation=' || CASE WHEN attribute.attcollation = 0 THEN '' ELSE attribute.attcollation::regcollation::text END,
    'acl=' || coalesce((
      SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C")
      FROM unnest(attribute.attacl) AS item
    ), ''))
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN scope ON scope.oid = relation.relnamespace
  LEFT JOIN pg_attrdef AS column_default
    ON column_default.adrelid = attribute.attrelid AND column_default.adnum = attribute.attnum
  WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped

  UNION ALL
  SELECT concat_ws('|', 'constraint',
    scope.name || '.' || coalesce(relation.relname, constrained_type.typname),
    table_constraint.conname,
    table_constraint.contype,
    translate(pg_get_constraintdef(table_constraint.oid), E'\n\r', '  '))
  FROM pg_constraint AS table_constraint
  JOIN scope ON scope.oid = table_constraint.connamespace
  LEFT JOIN pg_class AS relation ON relation.oid = table_constraint.conrelid
  LEFT JOIN pg_type AS constrained_type ON constrained_type.oid = table_constraint.contypid

  UNION ALL
  SELECT concat_ws('|', 'index', scope.name || '.' || index_relation.relname,
    translate(pg_get_indexdef(index_relation.oid), E'\n\r', '  '))
  FROM pg_index AS table_index
  JOIN pg_class AS index_relation ON index_relation.oid = table_index.indexrelid
  JOIN scope ON scope.oid = index_relation.relnamespace

  UNION ALL
  SELECT concat_ws('|', 'policy', scope.name || '.' || relation.relname, policy.polname,
    'command=' || policy.polcmd::text,
    'permissive=' || policy.polpermissive,
    'roles=' || (
      SELECT string_agg(role_name, ',' ORDER BY role_name COLLATE "C")
      FROM (
        SELECT CASE WHEN role_oid = 0 THEN 'public' ELSE pg_get_userbyid(role_oid)::text END AS role_name
        FROM unnest(policy.polroles) AS role_oid
      ) AS policy_role
    ),
    'using=' || coalesce(translate(pg_get_expr(policy.polqual, policy.polrelid), E'\n\r', '  '), ''),
    'check=' || coalesce(translate(pg_get_expr(policy.polwithcheck, policy.polrelid), E'\n\r', '  '), ''))
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN scope ON scope.oid = relation.relnamespace

  UNION ALL
  SELECT concat_ws('|', 'trigger', scope.name || '.' || relation.relname, table_trigger.tgname,
    'enabled=' || table_trigger.tgenabled::text,
    translate(pg_get_triggerdef(table_trigger.oid), E'\n\r', '  '))
  FROM pg_trigger AS table_trigger
  JOIN pg_class AS relation ON relation.oid = table_trigger.tgrelid
  JOIN scope ON scope.oid = relation.relnamespace
  WHERE NOT table_trigger.tgisinternal

  UNION ALL
  SELECT concat_ws('|', 'function', routine.oid::regprocedure::text,
    'kind=' || routine.prokind::text,
    'owner=' || pg_get_userbyid(routine.proowner),
    'security_definer=' || routine.prosecdef,
    'volatility=' || routine.provolatile::text,
    'definition=' || md5(CASE
      WHEN routine.prokind = 'a' THEN routine.prosrc
      ELSE pg_get_functiondef(routine.oid)
    END),
    'acl=' || coalesce((
      SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C")
      FROM unnest(coalesce(routine.proacl, acldefault('f', routine.proowner))) AS item
    ), ''))
  FROM pg_proc AS routine
  JOIN scope ON scope.oid = routine.pronamespace

  UNION ALL
  SELECT concat_ws('|', 'type', scope.name || '.' || data_type.typname,
    'kind=' || data_type.typtype::text,
    'owner=' || pg_get_userbyid(data_type.typowner),
    'labels=' || coalesce((
      SELECT string_agg(label.enumlabel::text, ',' ORDER BY label.enumsortorder)
      FROM pg_enum AS label
      WHERE label.enumtypid = data_type.oid
    ), ''),
    'base=' || CASE
      WHEN data_type.typtype = 'd' THEN format_type(data_type.typbasetype, data_type.typtypmod)
      ELSE ''
    END,
    'acl=' || coalesce((
      SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C")
      FROM unnest(coalesce(data_type.typacl, acldefault('T', data_type.typowner))) AS item
    ), ''))
  FROM pg_type AS data_type
  JOIN scope ON scope.oid = data_type.typnamespace
  LEFT JOIN pg_class AS owning_relation ON owning_relation.oid = data_type.typrelid
  WHERE (data_type.typrelid = 0 OR owning_relation.relkind = 'c')
    AND NOT EXISTS (SELECT 1 FROM pg_type AS element_type WHERE element_type.typarray = data_type.oid)

  UNION ALL
  SELECT concat_ws('|', 'setting', configuration.identity, (
    SELECT string_agg(
      CASE
        WHEN split_part(item, '=', 1) IN (SELECT name FROM readable_setting) THEN item
        ELSE split_part(item, '=', 1) || '=md5:' || md5(item)
      END,
      ',' ORDER BY item COLLATE "C")
    FROM unnest(configuration.config) AS item
  ))
  FROM configuration

  UNION ALL
  SELECT concat_ws('|', 'default_acl',
    pg_get_userbyid(entry.defaclrole),
    CASE
      WHEN entry.defaclnamespace = 0 THEN '*'
      ELSE (SELECT namespace.nspname::text FROM pg_namespace AS namespace WHERE namespace.oid = entry.defaclnamespace)
    END,
    entry.defaclobjtype,
    (SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C") FROM unnest(entry.defaclacl) AS item))
  FROM pg_default_acl AS entry

  UNION ALL
  SELECT concat_ws('|', 'sequence', scope.name || '.' || relation.relname,
    'type=' || format_type(sequence_definition.seqtypid, NULL),
    'start=' || sequence_definition.seqstart,
    'increment=' || sequence_definition.seqincrement,
    'min=' || sequence_definition.seqmin,
    'max=' || sequence_definition.seqmax,
    'cache=' || sequence_definition.seqcache,
    'cycle=' || sequence_definition.seqcycle,
    'last_value=' || CASE
      WHEN NOT has_sequence_privilege(relation.oid, 'SELECT,USAGE') THEN 'unreadable'
      ELSE coalesce(pg_sequence_last_value(relation.oid)::text, 'unset')
    END)
  FROM pg_sequence AS sequence_definition
  JOIN pg_class AS relation ON relation.oid = sequence_definition.seqrelid
  JOIN scope ON scope.oid = relation.relnamespace
)
SELECT fingerprint.entry FROM fingerprint ORDER BY fingerprint.entry COLLATE "C";

WITH scope AS (
  SELECT namespace.oid, namespace.nspname::text AS name
  FROM pg_namespace AS namespace
  WHERE namespace.nspname IN ('auth', 'supabase_migrations')
    OR NOT (
      namespace.nspname LIKE 'pg\_%'
      OR namespace.nspname LIKE 'timescaledb\_%'
      OR namespace.nspname LIKE '\_timescaledb\_%'
      OR namespace.nspname IN (
        'information_schema', '_analytics', '_realtime', '_supavisor', 'cron', 'dbdev',
        'etl', 'extensions', 'graphql', 'graphql_public', 'net', 'pgbouncer', 'pgmq',
        'pgsodium', 'pgsodium_masks', 'pgtle', 'realtime', 'repack', 'storage',
        'supabase_functions', 'tiger', 'tiger_data', 'topology', 'vault'
      )
    )
)
SELECT format(
  'SELECT %L || count(*) || '':'' || md5(coalesce(string_agg(row_hash, '''' ORDER BY row_hash COLLATE "C"), '''')) FROM (SELECT md5(source_row::text) AS row_hash FROM %I.%I AS source_row) AS hashed_rows',
  'data|' || scope.name || '.' || relation.relname || '|',
  scope.name,
  relation.relname)
FROM pg_class AS relation
JOIN scope ON scope.oid = relation.relnamespace
WHERE relation.relkind = 'r'
  AND NOT (
    scope.name = 'auth'
    AND relation.relname IN ('flow_state', 'mfa_amr_claims', 'one_time_tokens', 'refresh_tokens', 'sessions')
  )
ORDER BY scope.name COLLATE "C", relation.relname COLLATE "C"
\gexec

COMMIT;
