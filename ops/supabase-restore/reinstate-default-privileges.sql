-- Budget Supabase scratch restore: reinstate public default privileges.
--
-- Grants back every item neutralize-default-privileges.sql removed, now that
-- the restored objects exist, and asserts each item is present again. Items the
-- application schema dump already restated are granted again as a no-op; the
-- fingerprint comparison proves parity with production.
DO $budget_restore$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT *
    FROM pg_temp.budget_restore_default_privileges
    ORDER BY owner_name, object_type, grantee_name NULLS FIRST, privilege_type
  LOOP
    EXECUTE pg_temp.budget_restore_default_privilege_command(
      'GRANT', item.owner_name, item.object_type, item.privilege_type,
      item.grantee_name, item.is_grantable);
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.budget_restore_default_privileges AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_default_acl AS entry
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = entry.defaclrole
      CROSS JOIN LATERAL pg_catalog.aclexplode(entry.defaclacl) AS granted
      LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = granted.grantee
      WHERE entry.defaclnamespace = 'public'::regnamespace
        AND owner_role.rolname = expected.owner_name
        AND entry.defaclobjtype = expected.object_type
        AND granted.privilege_type = expected.privilege_type
        AND grantee_role.rolname::text IS NOT DISTINCT FROM expected.grantee_name
        AND granted.is_grantable = expected.is_grantable
    )
  ) THEN
    RAISE EXCEPTION 'public default privileges were not reinstated';
  END IF;
END
$budget_restore$;
