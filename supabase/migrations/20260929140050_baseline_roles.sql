-- Baseline part 2 of 9: roles. The household commands run as a dedicated no-login role that owns
-- them (was created in the old 20260908170000 migration and granted in later ones).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'household_command_owner') then
    create role household_command_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;
grant household_command_owner to postgres;
-- Needed only while ownership is transferred in the grants part; revoked again there.
grant create on schema public, private to household_command_owner;
