-- W4a-2 stage B slice 1: the reporting reads use the payday-anchored period.
--
-- Both functions keep their signatures and their month-key semantics; only the
-- date WINDOW they scan moves from the calendar month to
-- private.space_period_bounds(space, key). At the default payday of 1 that is
-- exactly the calendar month, so this is a no-op for every existing account.

-- The guarded public form of the period bounds, mirroring public.space_today and
-- public.space_clock. An invoker-report (or the client) may call it, and it
-- refuses a space the caller is not an active member of -- so the private helper
-- stays revoked and the public surface stays guarded.
create function public.space_period_bounds(p_space_id uuid, p_month date)
returns table (period_start date, period_end date)
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
begin
  if p_space_id is null or p_month is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'planning_not_authorized';
  end if;
  return query select bounds.period_start, bounds.period_end
    from private.space_period_bounds(p_space_id, p_month) bounds;
end;
$$;
revoke all on function public.space_period_bounds(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.space_period_bounds(uuid, date) to authenticated;

create or replace function public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date)
returns table (period_month date, period_role text, currency public.currency_code, income_net_minor bigint, expense_net_minor bigint, wallet_delta_net_minor bigint)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_current_start date;
  v_current_end date;
  v_previous_start date;
begin
  if p_space_id is null or p_anchor_month is null or p_anchor_month <> date_trunc('month', p_anchor_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership and normalized month are required';
  end if;
  select bounds.period_start, bounds.period_end into v_current_start, v_current_end
  from public.space_period_bounds(p_space_id, p_anchor_month) bounds;
  select bounds.period_start into v_previous_start
  from public.space_period_bounds(p_space_id, (date_trunc('month', p_anchor_month) - interval '1 month')::date) bounds;
  return query
  with periods as (
    select v_previous_start as period_start, v_current_start as period_end, 'previous'::text as role
    union all
    select v_current_start, v_current_end, 'current'
  ),
  dimensions as (select periods.period_start, periods.period_end, periods.role, currency.value::public.currency_code currency from periods cross join (values ('USD'), ('LBP')) currency(value)),
  movements as (
    select event.effective_date, wallet.currency, event.kind, event.reversal_of, movement.amount_minor
    from public.financial_events event join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = p_space_id
    join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = p_space_id
    where event.space_id = p_space_id and event.effective_date >= v_previous_start and event.effective_date < v_current_end
  ), normalized as (
    -- movement.amount_minor is already correctly signed for a reversal (it is
    -- the negation of the original movement); re-negating it here undid the
    -- cancellation and doubled the reversed amount instead of netting it.
    select movement.*, coalesce(original.kind, movement.kind) semantic_kind, movement.amount_minor as normalized_amount
    from movements movement left join public.financial_events original on original.id = movement.reversal_of and original.space_id = p_space_id
  )
  select dimensions.period_start, dimensions.role, dimensions.currency,
    coalesce(sum(case when normalized.semantic_kind = 'income' then normalized.normalized_amount else 0 end), 0)::bigint,
    coalesce(sum(case when normalized.semantic_kind = 'expense' then -normalized.normalized_amount else 0 end), 0)::bigint,
    coalesce(sum(normalized.amount_minor), 0)::bigint
  from dimensions left join normalized on normalized.currency = dimensions.currency and normalized.effective_date >= dimensions.period_start and normalized.effective_date < dimensions.period_end
  group by dimensions.period_start, dimensions.role, dimensions.currency order by dimensions.period_start, dimensions.currency;
end; $$;

create or replace function public.report_category_actual_vs_budget(p_space_id uuid, p_month date)
returns table (category_key text, category_name_en text, category_name_ar text, category_kind public.category_kind, currency public.currency_code, actual_net_minor bigint, budget_minor bigint, remaining_minor bigint)
language plpgsql security definer set search_path = pg_catalog, extensions
as $$
declare
  v_start date;
  v_end date;
begin
  if p_space_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then raise exception using errcode='42501', message='an active space membership and normalized month are required'; end if;
  select bounds.period_start, bounds.period_end into v_start, v_end
  from public.space_period_bounds(p_space_id, p_month) bounds;
  return query with current_targets as (
    select distinct on (revision.space_id, revision.category_id, revision.currency) revision.category_id, revision.currency, revision.amount_minor
    from public.monthly_budget_plan_revisions revision where revision.space_id=p_space_id and revision.plan_kind='expense_category' and revision.month_start=p_month order by revision.space_id, revision.category_id, revision.currency, revision.id desc
  ), actuals as (
    -- Roll a subcategory's spend into its root: association.category_id names
    -- the exact tagged category, but the target lives on the root, so group by
    -- coalesce(tagged.parent_category_id, tagged.id) instead of the tagged id.
    -- movement.amount_minor is already correctly signed for a reversal, so a
    -- single -sum(...) nets it, matching monthly_budget_currency_summary.
    select coalesce(root.id::text, 'uncategorized:expense') key, root.id as category_id, wallet.currency, (-sum(movement.amount_minor))::bigint amount
    from public.financial_events event join public.wallet_movements movement on movement.event_id=event.id and movement.space_id=p_space_id join public.wallets wallet on wallet.id=movement.wallet_id and wallet.space_id=p_space_id
    left join public.financial_event_categories category on category.event_id=event.id and category.space_id=p_space_id
    left join public.categories tagged on tagged.id=category.category_id and tagged.space_id=p_space_id
    left join public.categories root on root.id=coalesce(tagged.parent_category_id, tagged.id) and root.space_id=p_space_id
    left join public.financial_events original on original.id=event.reversal_of and original.space_id=p_space_id
    where event.space_id=p_space_id and event.effective_date >= v_start and event.effective_date < v_end and coalesce(original.kind,event.kind)='expense'
    group by coalesce(root.id::text, 'uncategorized:expense'), root.id, wallet.currency
  -- Bare "currency" here is ambiguous against the function's own OUT
  -- parameter of the same name; every reference must be CTE-qualified.
  ), keys as (select category_id, current_targets.currency from current_targets union select category_id, actuals.currency from actuals)
  select coalesce(category.id::text, 'uncategorized:expense'), category.name_en, category.name_ar, coalesce(category.kind, 'expense'::public.category_kind), keys.currency,
    coalesce(actuals.amount,0), coalesce(current_targets.amount_minor,0), coalesce(current_targets.amount_minor,0)-coalesce(actuals.amount,0)
  from keys left join public.categories category on category.id=keys.category_id and category.space_id=p_space_id left join current_targets on current_targets.category_id is not distinct from keys.category_id and current_targets.currency=keys.currency left join actuals on actuals.category_id is not distinct from keys.category_id and actuals.currency=keys.currency
  order by category.name_en nulls last, category.id, keys.currency;
end; $$;

-- report_category_actual_vs_budget is DEFINER; keep the existing grant boundary
-- (authenticated only, no broadened raw table access).
revoke all on function public.report_category_actual_vs_budget(uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.report_category_actual_vs_budget(uuid,date) to authenticated;
