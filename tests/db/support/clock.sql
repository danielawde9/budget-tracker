-- Installed only in the disposable Testcontainers template after migrations.
-- NULL preserves the transaction's real clock for suites that do not pin time.
create schema budget_test;
revoke all on schema budget_test from public, anon, authenticated, service_role;
create table budget_test.clock (
  singleton boolean primary key default true check (singleton),
  instant timestamptz
);
insert into budget_test.clock (instant) values (null);
revoke all on budget_test.clock from public, anon, authenticated, service_role;

create or replace function budget.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(instant, now()) from budget_test.clock where singleton
$$;
revoke all on function budget.clock_now() from public, anon, authenticated, service_role;
