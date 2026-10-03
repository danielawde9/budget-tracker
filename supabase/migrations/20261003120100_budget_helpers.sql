-- Budget v2 helpers: the one clock, membership, balances and exact splitting.
-- All live in schema `budget`, which the browser roles cannot use.

create function budget.month_start(p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', p_day)::date
$$;

-- The calendar date of a moment in the space's own timezone.
create function budget.space_date_at(p_space uuid, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone s.timezone)::date from budget.spaces s where s.id = p_space
$$;

-- "Today" for a space: the single clock every date default and check uses.
create function budget.space_today(p_space uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select budget.space_date_at(p_space, now())
$$;

-- The caller must be a member of the space. Raised as 42501 so PostgREST
-- reports a permission failure, never data.
create function budget.require_member(p_space uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or p_space is null or not exists (
    select 1 from budget.space_members m where m.space_id = p_space and m.user_id = v_user
  ) then
    raise exception using errcode = '42501', message = 'BUDGET_NOT_MEMBER';
  end if;
end;
$$;

-- Serializes every money write in one space (single row lock, held to commit).
create function budget.lock_space(p_space uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from budget.spaces where id = p_space for update;
  if not found then
    perform budget.raise_budget('BUDGET_NOT_FOUND', jsonb_build_object('spaceId', p_space));
  end if;
end;
$$;

create function budget.item_balance(p_item uuid, p_currency budget.currency)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount_minor), 0)::bigint
  from budget.item_lines
  where item_id = p_item and currency = p_currency
$$;

create function budget.item_balance_on(p_item uuid, p_currency budget.currency, p_on date)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.amount_minor), 0)::bigint
  from budget.item_lines l
  join budget.entries e on e.id = l.entry_id
  where l.item_id = p_item and l.currency = p_currency and e.occurred_on <= p_on
$$;

create function budget.wallet_balance(p_wallet uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount_minor), 0)::bigint from budget.wallet_lines where wallet_id = p_wallet
$$;

create function budget.ready_item(p_space uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from budget.items where space_id = p_space and kind = 'ready'
$$;

-- Splits p_total by basis points exactly.
-- The planned share is floor(total × Σbps / 10000); each part is floored and
-- the remaining units go one each to the largest remainders, ties to the
-- earlier position. The result always sums to the planned share. The loop
-- that hands out units runs fewer times than there are parts.
create function budget.split_by_bps(p_total bigint, p_bps integer[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer := coalesce(array_length(p_bps, 1), 0);
  v_sum_bps bigint := 0;
  v_target bigint;
  v_parts bigint[] := '{}';
  v_remainders numeric[] := '{}';
  v_assigned bigint := 0;
  v_left bigint;
  v_best integer;
begin
  if p_total is null or p_total < 0 then
    perform budget.raise_budget('BUDGET_INVALID_AMOUNT', jsonb_build_object('total', p_total));
  end if;
  if v_count = 0 then
    return '{}';
  end if;
  for i in 1 .. v_count loop
    if p_bps[i] is null or p_bps[i] < 0 or p_bps[i] > 10000 then
      perform budget.raise_budget('BUDGET_INVALID_PERCENT', jsonb_build_object('position', i));
    end if;
    v_sum_bps := v_sum_bps + p_bps[i];
  end loop;
  if v_sum_bps > 10000 then
    perform budget.raise_budget('BUDGET_PLAN_OVER_100', jsonb_build_object('bps', v_sum_bps));
  end if;

  v_target := floor(p_total::numeric * v_sum_bps / 10000)::bigint;
  for i in 1 .. v_count loop
    v_parts := v_parts || floor(p_total::numeric * p_bps[i] / 10000)::bigint;
    v_remainders := v_remainders || ((p_total::numeric * p_bps[i]) % 10000);
    v_assigned := v_assigned + v_parts[i];
  end loop;

  v_left := v_target - v_assigned;
  while v_left > 0 loop
    v_best := 0;
    for j in 1 .. v_count loop
      if v_remainders[j] >= 0 and (v_best = 0 or v_remainders[j] > v_remainders[v_best]) then
        v_best := j;
      end if;
    end loop;
    if v_best = 0 then
      perform budget.raise_budget('BUDGET_SPLIT_FAILED', jsonb_build_object('total', p_total));
    end if;
    v_parts[v_best] := v_parts[v_best] + 1;
    v_remainders[v_best] := -1;
    v_left := v_left - 1;
  end loop;
  return v_parts;
end;
$$;

revoke all on all functions in schema budget from public, anon, authenticated, service_role;
