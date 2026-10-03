-- Allocation projections (task 06): the canonical ordinary-activity helper
-- plus four public, read-only reconciliation contracts. No write, no RLS
-- change to existing tables; only new private/public functions.

create function private.planning_ordinary_activity(p_space_id uuid, p_from date, p_to date)
returns table(event_id uuid, effective_date date, currency public.currency_code,
  root_id uuid, income_minor numeric, expense_minor numeric, cash_minor numeric)
language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if p_space_id is null or p_from is null or p_to is null or p_to <= p_from
    or p_to > p_from + 366 or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  return query
  select e.id,e.effective_date,w.currency,
    coalesce(c.parent_category_id,c.id) as root_id,
    case when coalesce(o.kind,e.kind)='income' then m.amount_minor::numeric else 0 end,
    case when coalesce(o.kind,e.kind)='expense' then -m.amount_minor::numeric else 0 end,
    m.amount_minor::numeric
  from public.financial_events e
  join public.wallet_movements m on m.event_id=e.id and m.space_id=e.space_id
  join public.wallets w on w.id=m.wallet_id and w.space_id=e.space_id
  left join public.financial_events o on o.id=e.reversal_of and o.space_id=e.space_id
  left join public.financial_event_categories ec on ec.event_id=e.id and ec.space_id=e.space_id
  left join public.financial_event_categories oc on oc.event_id=o.id and oc.space_id=e.space_id
  left join public.categories c on c.id=coalesce(ec.category_id,oc.category_id) and c.space_id=e.space_id
  where e.space_id=p_space_id and e.effective_date>=p_from and e.effective_date<p_to;
end;
$$;
revoke all on function private.planning_ordinary_activity(uuid,date,date)
  from public,anon,authenticated,service_role;

-- Task 2: allocation_month_state. One snapshot-consistent read of the
-- reconciled plan-vs-actual header plus every group row (real, unmapped,
-- uncategorized). A root can only ever be mapped to a spending group
-- (enforced by check_allocation_template), so a future group's actual is
-- always its linked loan commitment, never root-mapped expense activity.
create function public.allocation_month_state(
  p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint default null
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_month date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_has_plan boolean := false;
  v_actual_income numeric := 0;
  v_expense numeric := 0;
  v_loan_actual bigint := 0;
  v_loan_remaining bigint := 0;
  v_income_after_spending numeric;
  v_current_income_id bigint;
  v_child_plan_changed boolean := false;
  v_standalone_root_targets numeric := 0;
  v_standalone_debt numeric := 0;
  v_future_excess numeric := 0;
  v_left_to_allocate numeric := 0;
  v_groups jsonb := '[]'::jsonb;
  v_unmapped_actual numeric := 0;
  v_unmapped_target numeric := 0;
  v_uncategorized_actual numeric := 0;
  v_result jsonb;
begin
  if p_space_id is null or p_month is null or p_currency is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_month := p_month;

  if p_snapshot_id is not null then
    select * into v_snapshot from public.allocation_month_snapshots
      where id = p_snapshot_id and space_id = p_space_id and currency = p_currency and month_start = v_month;
    if not found then
      raise exception using errcode='P0001', message='the requested snapshot does not belong to this space, currency, and month';
    end if;
    v_has_plan := true;
  else
    select * into v_snapshot from public.allocation_month_snapshots
      where space_id = p_space_id and currency = p_currency and month_start = v_month
      order by id desc limit 1;
    v_has_plan := found;
  end if;

  select coalesce(sum(activity.income_minor), 0), coalesce(sum(activity.expense_minor), 0)
    into v_actual_income, v_expense
    from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
    where activity.currency = p_currency;
  v_income_after_spending := v_actual_income - v_expense;

  select coalesce(summary.actual_repayment_minor,0), coalesce(summary.remaining_reservation_minor,0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);

  select id into v_current_income_id from public.monthly_budget_plan_revisions
    where space_id = p_space_id and currency = p_currency and month_start = v_month and plan_kind = 'income'
    order by id desc limit 1;

  if v_has_plan then
    if v_current_income_id is distinct from v_snapshot.income_plan_revision_id then
      v_child_plan_changed := true;
    end if;
    if exists (
      select 1 from public.allocation_month_roots root
      left join lateral (
        select revision.id from public.monthly_budget_plan_revisions revision
        where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
          and revision.plan_kind = 'expense_category' and revision.category_id = root.category_id
        order by revision.id desc limit 1
      ) current_head on true
      where root.snapshot_id = v_snapshot.id and current_head.id is distinct from root.target_revision_id
    ) then
      v_child_plan_changed := true;
    end if;

    select coalesce(sum(root.target_minor),0) into v_standalone_root_targets
      from public.allocation_month_roots root where root.snapshot_id = v_snapshot.id and root.group_id is null;

    select
      case when commitment.group_id is null then coalesce(commitment.observed_actual_minor,0) + coalesce(commitment.observed_remaining_minor,0) else 0 end,
      case when commitment.group_id is not null then
        greatest(coalesce(commitment.observed_actual_minor,0) + coalesce(commitment.observed_remaining_minor,0) - coalesce(target_group.target_minor,0), 0)
      else 0 end
      into v_standalone_debt, v_future_excess
      from public.allocation_month_commitments commitment
      left join public.allocation_month_groups target_group
        on target_group.snapshot_id = commitment.snapshot_id and target_group.group_id = commitment.group_id
      where commitment.snapshot_id = v_snapshot.id;

    v_left_to_allocate := v_snapshot.unallocated_minor - v_standalone_root_targets - v_standalone_debt - v_future_excess;

    -- Real group rows: spending groups' actual is root-mapped expense
    -- activity; a future group's actual is its linked commitment only.
    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'groupId', month_group.group_id, 'rowKind', month_group.purpose,
        'nameEn', month_group.name_en, 'nameAr', month_group.name_ar, 'order', month_group.display_order,
        'targetMinor', month_group.target_minor::text,
        'actualMinor', (case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0)
          else coalesce(group_actual.actual, 0) end)::text,
        'varianceMinor', (month_group.target_minor - (case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0)
          else coalesce(group_actual.actual, 0) end))::text,
        'basisPoints', month_group.basis_points,
        'actualShareOfIncomeBps', case when v_actual_income > 0 then
          floor((case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0) else coalesce(group_actual.actual, 0) end) * 10000 / v_actual_income)::text
          else null end,
        'hasPlan', true
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join public.allocation_month_commitments commitment_actual
        on commitment_actual.snapshot_id = month_group.snapshot_id and commitment_actual.group_id = month_group.group_id
      left join (
        select root.group_id, sum(activity.expense_minor) as actual
        from public.allocation_month_roots root
        join private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
          on activity.root_id = root.category_id and activity.currency = p_currency
        where root.snapshot_id = v_snapshot.id and root.group_id is not null
        group by root.group_id
      ) group_actual on group_actual.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );

    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
      where activity.currency = p_currency and activity.root_id is not null
        and not exists (
          select 1 from public.allocation_month_roots root
          where root.snapshot_id = v_snapshot.id and root.category_id = activity.root_id and root.group_id is not null
        );
    v_unmapped_target := v_standalone_root_targets;
  else
    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
      where activity.currency = p_currency and activity.root_id is not null;
  end if;

  select coalesce(sum(activity.expense_minor), 0) into v_uncategorized_actual
    from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
    where activity.currency = p_currency and activity.root_id is null;

  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'unmapped', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', v_unmapped_target::text, 'actualMinor', v_unmapped_actual::text,
    'varianceMinor', (v_unmapped_target - v_unmapped_actual)::text, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_unmapped_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', v_unmapped_target <> 0
  ));
  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'uncategorized', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', null, 'actualMinor', v_uncategorized_actual::text, 'varianceMinor', null, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_uncategorized_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', false
  ));

  v_result := jsonb_build_object(
    'snapshotId', v_snapshot.id::text, 'templateRevisionId', v_snapshot.template_revision_id::text,
    'incomeRevisionId', v_snapshot.income_plan_revision_id::text, 'hasPlan', v_has_plan,
    'plannedIncomeMinor', case when v_has_plan then v_snapshot.base_income_minor::text else null end,
    'actualIncomeMinor', v_actual_income::text, 'expenseMinor', v_expense::text,
    'incomeAfterSpendingMinor', v_income_after_spending::text,
    'ownDebtPaidMinor', v_loan_actual::text, 'remainingDebtMinor', v_loan_remaining::text,
    'leftToAllocateMinor', case when v_has_plan then v_left_to_allocate::text else null end,
    'childPlanChanged', v_child_plan_changed, 'asOf', now(), 'groups', v_groups
  );
  return v_result;
end;
$$;
revoke all on function public.allocation_month_state(uuid,date,public.currency_code,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.allocation_month_state(uuid,date,public.currency_code,bigint)
  to authenticated;

create function public.allocation_category_page(
  p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint,
  p_group_id uuid default null, p_after_root_id uuid default null, p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_month date;
  v_snapshot_exists boolean;
  v_rows jsonb;
  v_row_count integer;
  v_next_root_id uuid;
  v_has_more boolean;
begin
  if p_space_id is null or p_month is null or p_currency is null or p_snapshot_id is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;

  select exists(
    select 1 from public.allocation_month_snapshots
    where id = p_snapshot_id and space_id = p_space_id and currency = p_currency and month_start = v_month
  ) into v_snapshot_exists;
  if not v_snapshot_exists then
    raise exception using errcode='P0001', message='the requested snapshot does not belong to this space, currency, and month';
  end if;

  with page as (
    select root.category_id as root_id, category.name_en, category.name_ar,
      root.target_minor, coalesce(activity.actual, 0) as actual_minor, root.group_id
    from public.allocation_month_roots root
    join public.categories category on category.id = root.category_id and category.space_id = p_space_id
    left join (
      select act.root_id, sum(act.expense_minor) as actual
      from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) act
      where act.currency = p_currency
      group by act.root_id
    ) activity on activity.root_id = root.category_id
    where root.snapshot_id = p_snapshot_id
      and (p_group_id is null or root.group_id = p_group_id)
      and (p_after_root_id is null or root.category_id > p_after_root_id)
    order by root.category_id
    limit p_limit + 1
  )
  , numbered as (select page.*, row_number() over (order by root_id) as rn from page)
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'rootId', root_id, 'nameEn', name_en, 'nameAr', name_ar,
      'targetMinor', target_minor::text, 'actualMinor', actual_minor::text,
      'varianceMinor', (target_minor - actual_minor)::text, 'hasPlan', true, 'groupId', group_id
    ) order by root_id), '[]'::jsonb) from numbered where rn <= p_limit),
    (select count(*) from numbered where rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select root_id from numbered where rn = p_limit)
  into v_rows, v_row_count, v_has_more, v_next_root_id;

  return jsonb_build_object('rows', v_rows, 'nextRootId', case when v_has_more then v_next_root_id else null end, 'hasMore', coalesce(v_has_more, false));
end;
$$;
revoke all on function public.allocation_category_page(uuid,date,public.currency_code,bigint,uuid,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.allocation_category_page(uuid,date,public.currency_code,bigint,uuid,uuid,integer)
  to authenticated;

create function public.allocation_history_page(
  p_space_id uuid, p_month date, p_currency public.currency_code, p_before_id bigint default null, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_month date;
  v_rows jsonb;
  v_has_more boolean;
  v_next_id bigint;
begin
  if p_space_id is null or p_month is null or p_currency is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;

  with page as (
    select id, created_at, actor_id, base_income_minor, template_revision_id
    from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
      and (p_before_id is null or id < p_before_id)
    order by id desc
    limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'snapshotId', id::text, 'createdAt', created_at, 'actorId', actor_id,
      'plannedIncomeMinor', base_income_minor::text, 'templateRevisionId', template_revision_id::text
    ) order by id desc) filter (where rn <= p_limit), '[]'::jsonb),
    bool_or(rn > p_limit),
    min(id) filter (where rn <= p_limit)
  into v_rows, v_has_more, v_next_id
  from (select page.*, row_number() over (order by id desc) as rn from page) page;

  return jsonb_build_object('rows', v_rows, 'nextId', case when v_has_more then v_next_id::text else null end, 'hasMore', coalesce(v_has_more, false));
end;
$$;
revoke all on function public.allocation_history_page(uuid,date,public.currency_code,bigint,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.allocation_history_page(uuid,date,public.currency_code,bigint,integer)
  to authenticated;

-- generate_series is bounded by the validated 1..12 p_month_count; every
-- month in range is present (including empty ones), never silently skipped.
create function public.allocation_trend(
  p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_months jsonb;
begin
  if p_space_id is null or p_currency is null or p_first_month is null
    or p_first_month <> date_trunc('month', p_first_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_month_count is null or p_month_count < 1 or p_month_count > 12 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with series as (
    select (p_first_month + (n * interval '1 month'))::date as month_start
    from generate_series(0, p_month_count - 1) as n
  ), income_expense as (
    select date_trunc('month', activity.effective_date)::date as month_start,
      sum(activity.income_minor) as income, sum(activity.expense_minor) as expense
    from private.planning_ordinary_activity(p_space_id, p_first_month, (p_first_month + (p_month_count * interval '1 month'))::date) activity
    where activity.currency = p_currency
    group by date_trunc('month', activity.effective_date)::date
  ), loans as (
    select series.month_start, summary.actual_repayment_minor
    from series
    cross join lateral public.loan_monthly_currency_summary(p_space_id, series.month_start) as summary
    where summary.currency = p_currency
  ), snapshots as (
    select distinct on (snapshot.month_start) snapshot.month_start, snapshot.base_income_minor
    from public.allocation_month_snapshots snapshot
    where snapshot.space_id = p_space_id and snapshot.currency = p_currency
      and snapshot.month_start >= p_first_month and snapshot.month_start < (p_first_month + (p_month_count * interval '1 month'))::date
    order by snapshot.month_start, snapshot.id desc
  )
  select jsonb_agg(jsonb_build_object(
    'month', series.month_start, 'incomeMinor', coalesce(ie.income,0)::text, 'expenseMinor', coalesce(ie.expense,0)::text,
    'ownDebtPaidMinor', coalesce(loans.actual_repayment_minor,0)::text,
    'hasPlan', snap.month_start is not null, 'plannedIncomeMinor', snap.base_income_minor::text
  ) order by series.month_start)
  into v_months
  from series
  left join income_expense ie on ie.month_start = series.month_start
  left join loans on loans.month_start = series.month_start
  left join snapshots snap on snap.month_start = series.month_start;

  return jsonb_build_object('months', coalesce(v_months, '[]'::jsonb));
end;
$$;
revoke all on function public.allocation_trend(uuid,public.currency_code,date,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.allocation_trend(uuid,public.currency_code,date,integer)
  to authenticated;
