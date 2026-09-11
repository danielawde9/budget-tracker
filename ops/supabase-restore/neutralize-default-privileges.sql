-- Budget Supabase scratch restore: neutralize public default privileges.
--
-- Supabase grants anon, authenticated, and service_role every privilege on
-- objects that postgres or supabase_admin create in public. A schema dump
-- restates ACLs only relative to built-in defaults, so without this step those
-- grants survive the restore (2026-09-11 drill defect 2). Snapshot every item,
-- revoke each one (a per-schema row disappears only when empty), and assert
-- none remain; reinstate-default-privileges.sql grants the snapshot back.

CREATE TEMPORARY TABLE budget_restore_default_privileges ON COMMIT DROP AS
SELECT
  owner_role.rolname::text AS owner_name,
  entry.defaclobjtype AS object_type,
  granted.privilege_type,
  grantee_role.rolname::text AS grantee_name,
  granted.is_grantable
FROM pg_catalog.pg_default_acl AS entry
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = entry.defaclrole
CROSS JOIN LATERAL pg_catalog.aclexplode(entry.defaclacl) AS granted
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = granted.grantee
WHERE entry.defaclnamespace = 'public'::regnamespace
  AND owner_role.rolname IN ('postgres', 'supabase_admin');

-- grantee_name NULL stands for PUBLIC.
CREATE FUNCTION pg_temp.budget_restore_default_privilege_command(
  command text,
  owner_name text,
  object_type "char",
  privilege_type text,
  grantee_name text,
  is_grantable boolean
)
  RETURNS text
  LANGUAGE plpgsql
  AS $budget_restore$
DECLARE
  object_keyword text := CASE object_type
    WHEN 'r' THEN 'TABLES'
    WHEN 'S' THEN 'SEQUENCES'
    WHEN 'f' THEN 'FUNCTIONS'
    WHEN 'T' THEN 'TYPES'
  END;
  grantee_sql text := CASE
    WHEN grantee_name IS NULL THEN 'PUBLIC'
    ELSE pg_catalog.quote_ident(grantee_name)
  END;
BEGIN
  IF object_keyword IS NULL OR privilege_type !~ '^[A-Z]+$' THEN
    RAISE EXCEPTION 'unsupported public default privilege % on object type %',
      privilege_type, object_type;
  END IF;
  IF command = 'GRANT' THEN
    RETURN pg_catalog.format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT %s ON %s TO %s%s',
      owner_name, privilege_type, object_keyword, grantee_sql,
      CASE WHEN is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END IF;
  RETURN pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE %s ON %s FROM %s',
    owner_name, privilege_type, object_keyword, grantee_sql);
END
$budget_restore$;

DO $budget_restore$
DECLARE
  item record;
BEGIN
  IF (SELECT count(*) FROM pg_temp.budget_restore_default_privileges) > 1024 THEN
    RAISE EXCEPTION 'public default privileges exceed the reviewed bound of 1024 items';
  END IF;
  FOR item IN
    SELECT *
    FROM pg_temp.budget_restore_default_privileges
    ORDER BY owner_name, object_type, grantee_name NULLS FIRST, privilege_type
  LOOP
    EXECUTE pg_temp.budget_restore_default_privilege_command(
      'REVOKE', item.owner_name, item.object_type, item.privilege_type,
      item.grantee_name, item.is_grantable);
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS entry
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = entry.defaclrole
    WHERE entry.defaclnamespace = 'public'::regnamespace
      AND owner_role.rolname IN ('postgres', 'supabase_admin')
  ) THEN
    RAISE EXCEPTION 'public default privileges remain after neutralization';
  END IF;
END
$budget_restore$;
