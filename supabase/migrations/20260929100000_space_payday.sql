-- W4a-2 (stage A): a per-space payday, and the payday-anchored budget period on
-- the server clock (audit 2026-09-25 rank 11 / §6, plan-pack 46).
--
-- The period KEY stays `month_start` (the 1st of the month the period starts in);
-- only the period WINDOW is anchored on the payday. A payday of 1 is exactly
-- today's calendar month, so every existing expectation is the regression net.
--
-- Stage A adds the column and exposes the anchored period on `public.space_clock`;
-- it does NOT yet change any read path (that is stage B), and the client only reads
-- `currentMonth`, so behaviour is unchanged at the default payday of 1.

alter table public.spaces
  add column payday_day integer not null default 1;

alter table public.spaces
  add constraint spaces_payday_day_range check (payday_day between 1 and 31);

comment on column public.spaces.payday_day is
  'Day of month the budget period starts (1-31). 1 = calendar months.';

-- The period start for a space at an instant: the most recent payday on or before
-- the space-zone date. A payday of 29-31 is clamped to the month's last day, so it
-- stays valid in short months.
create function private.space_period_start(p_space_id uuid, p_at timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_today date := private.space_date(p_space_id, p_at);
  v_payday integer;
  v_month date;
  v_anchor date;
begin
  select greatest(1, least(31, coalesce(space.payday_day, 1)))
    into v_payday
    from public.spaces as space where space.id = p_space_id;
  v_payday := coalesce(v_payday, 1);

  v_month := (date_trunc('month', v_today))::date;
  v_anchor := least(
    v_month + (v_payday - 1),
    (v_month + interval '1 month' - interval '1 day')::date
  );
  if v_today >= v_anchor then
    return v_anchor;
  end if;

  v_month := (date_trunc('month', v_today - interval '1 month'))::date;
  return least(
    v_month + (v_payday - 1),
    (v_month + interval '1 month' - interval '1 day')::date
  );
end;
$$;
revoke all on function private.space_period_start(uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Replace the clock to also carry the anchored period and the payday. The
-- signature and the existing keys are unchanged, so no client change is required.
create or replace function public.space_clock(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_timezone text;
  v_payday integer;
  v_today date;
  v_period_start date;
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  select space.timezone, greatest(1, least(31, space.payday_day))
    into v_timezone, v_payday
    from public.spaces as space where space.id = p_space_id;
  if v_timezone is null then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_today := private.space_today(p_space_id);
  v_period_start := private.space_period_start(p_space_id, now());
  return jsonb_build_object(
    'timezone', v_timezone,
    'today', v_today,
    'currentMonth', (date_trunc('month', v_period_start))::date,
    'paydayDay', v_payday,
    'periodStart', v_period_start,
    'periodEnd', (v_period_start + interval '1 month' - interval '1 day')::date
  );
end;
$$;
revoke all on function public.space_clock(uuid) from public, anon, authenticated, service_role;
grant execute on function public.space_clock(uuid) to authenticated;
