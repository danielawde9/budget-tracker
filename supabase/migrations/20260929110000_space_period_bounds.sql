-- W4a-2 stage B (foundation): the anchored period bounds for a period KEY.
--
-- `p_month` is the period key -- the 1st of the month the period starts in, which
-- the schema enforces on plan revisions, allocation snapshots and goal targets.
-- `private.space_period_bounds` returns the window [period_start, period_end) for
-- that key, with the boundary on the space's payday.
--
-- For the default payday of 1 this is exactly the calendar month, so every call
-- site that adopts it is a no-op at the default and the existing suite stays the
-- regression net. `private.space_period_anchor` is the key-based form (the payday
-- in a given month, clamped in short months); stage A's `private.space_period_start`
-- remains the "most recent payday at or before now" form the clock uses.
--
-- This migration only ADDS the helpers. The read functions are converted to call
-- them in the following stage-B slices, one area at a time.

create function private.space_period_anchor(p_space_id uuid, p_month date)
returns date
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_payday integer;
  v_month date := (date_trunc('month', p_month))::date;
begin
  select greatest(1, least(31, coalesce(space.payday_day, 1)))
    into v_payday
    from public.spaces as space where space.id = p_space_id;
  v_payday := coalesce(v_payday, 1);
  return least(
    v_month + (v_payday - 1),
    (v_month + interval '1 month' - interval '1 day')::date
  );
end;
$$;
revoke all on function private.space_period_anchor(uuid, date)
  from public, anon, authenticated, service_role;

create function private.space_period_bounds(p_space_id uuid, p_month date)
returns table (period_start date, period_end date)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    private.space_period_anchor(p_space_id, p_month) as period_start,
    private.space_period_anchor(
      p_space_id,
      (date_trunc('month', p_month) + interval '1 month')::date
    ) as period_end;
$$;
revoke all on function private.space_period_bounds(uuid, date)
  from public, anon, authenticated, service_role;
