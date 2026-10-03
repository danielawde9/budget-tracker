-- The protected creation command calls extensions.gen_random_uuid(). Restore
-- the schema permission from the household foundation after hosted ACL drift.
-- This grants no access to Auth records, invitation keys, or financial tables.
grant usage on schema extensions to household_command_owner;
