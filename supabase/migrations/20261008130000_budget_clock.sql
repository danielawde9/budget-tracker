-- One private transaction clock for every business-date default and guard.
-- Tests replace this helper only inside their disposable database template.
create function budget.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now()
$$;
revoke all on function budget.clock_now() from public, anon, authenticated, service_role;

create or replace function budget.space_today(p_space uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select budget.space_date_at(p_space, budget.clock_now())
$$;

create or replace function public.clock_today(p_timezone text default 'Asia/Beirut')
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'BUDGET_NOT_AUTHENTICATED';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    perform budget.raise_budget('BUDGET_INVALID_TIMEZONE', jsonb_build_object('timezone', p_timezone));
  end if;
  return (budget.clock_now() at time zone p_timezone)::date;
end;
$$;
