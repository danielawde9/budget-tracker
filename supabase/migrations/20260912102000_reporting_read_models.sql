create index financial_events_report_keyset_idx
  on public.financial_events (space_id, effective_date desc, created_at desc, id desc);

create function public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date)
returns table (period_month date, period_role text, currency public.currency_code, income_net_minor bigint, expense_net_minor bigint, wallet_delta_net_minor bigint)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_space_id is null or p_anchor_month is null or p_anchor_month <> date_trunc('month', p_anchor_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership and normalized month are required';
  end if;
  return query
  with periods as (select (p_anchor_month - interval '1 month')::date as period_start, 'previous'::text as role union all select p_anchor_month, 'current'),
  dimensions as (select periods.period_start, periods.role, currency.value::public.currency_code currency from periods cross join (values ('USD'), ('LBP')) currency(value)),
  movements as (
    select event.effective_date, wallet.currency, event.kind, event.reversal_of, movement.amount_minor
    from public.financial_events event join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = p_space_id
    join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = p_space_id
    where event.space_id = p_space_id and event.effective_date >= p_anchor_month - interval '1 month' and event.effective_date < p_anchor_month + interval '1 month'
  ), normalized as (
    select movement.*, coalesce(original.kind, movement.kind) semantic_kind,
      case when movement.reversal_of is null then movement.amount_minor else -movement.amount_minor end normalized_amount
    from movements movement left join public.financial_events original on original.id = movement.reversal_of and original.space_id = p_space_id
  )
  select dimensions.period_start, dimensions.role, dimensions.currency,
    coalesce(sum(case when normalized.semantic_kind = 'income' then normalized.normalized_amount else 0 end), 0),
    coalesce(sum(case when normalized.semantic_kind = 'expense' then -normalized.normalized_amount else 0 end), 0),
    coalesce(sum(normalized.amount_minor), 0)
  from dimensions left join normalized on normalized.currency = dimensions.currency and normalized.effective_date >= dimensions.period_start and normalized.effective_date < dimensions.period_start + interval '1 month'
  group by dimensions.period_start, dimensions.role, dimensions.currency order by dimensions.period_start, dimensions.currency;
end; $$;

create function public.report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid default null, p_currency public.currency_code default null, p_event_limit integer default 50)
returns table (event_id uuid, kind public.financial_event_kind, effective_date date, created_at timestamptz, reversal_of uuid, wallet_id uuid, wallet_name text, currency public.currency_code, amount_minor bigint, has_more boolean)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_space_id is null or p_from_date is null or p_to_date is null or p_to_date <= p_from_date or p_to_date > p_from_date + 366 or p_event_limit not between 1 and 100 or not private.is_active_member(p_space_id) then raise exception using errcode = '42501', message = 'a visible space and bounded report window are required'; end if;
  if p_wallet_id is not null and not exists (select 1 from public.wallets where id=p_wallet_id and space_id=p_space_id) then raise exception using errcode='42501', message='the requested wallet is not visible in this space'; end if;
  if p_wallet_id is not null and p_currency is not null and not exists (select 1 from public.wallets where id=p_wallet_id and space_id=p_space_id and currency=p_currency) then raise exception using errcode='P0001', message='wallet currency does not match the requested currency'; end if;
  return query with selected as (
    select event.id from public.financial_events event where event.space_id=p_space_id and event.effective_date >= p_from_date and event.effective_date < p_to_date
      and (p_wallet_id is null or exists (select 1 from public.wallet_movements m where m.event_id=event.id and m.wallet_id=p_wallet_id and m.space_id=p_space_id))
    order by event.effective_date desc, event.created_at desc, event.id desc limit p_event_limit + 1
  ), visible as (select id from selected limit p_event_limit), more as (select count(*) > p_event_limit has_more from selected)
  select event.id, event.kind, event.effective_date, event.created_at, event.reversal_of, wallet.id, wallet.name, wallet.currency, movement.amount_minor, more.has_more
  from visible join public.financial_events event on event.id=visible.id and event.space_id=p_space_id join public.wallet_movements movement on movement.event_id=event.id and movement.space_id=p_space_id join public.wallets wallet on wallet.id=movement.wallet_id and wallet.space_id=p_space_id cross join more
  where (p_wallet_id is null or wallet.id=p_wallet_id) and (p_currency is null or wallet.currency=p_currency)
  order by event.effective_date desc, event.created_at desc, event.id desc, wallet.id;
end; $$;

create function public.report_category_actual_vs_budget(p_space_id uuid, p_month date)
returns table (category_key text, category_name_en text, category_name_ar text, category_kind public.category_kind, currency public.currency_code, actual_net_minor bigint, budget_minor bigint, remaining_minor bigint)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_space_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then raise exception using errcode='42501', message='an active space membership and normalized month are required'; end if;
  return query with current_targets as (
    select distinct on (revision.space_id, revision.category_id, revision.currency) revision.category_id, revision.currency, revision.amount_minor
    from public.monthly_budget_plan_revisions revision where revision.space_id=p_space_id and revision.plan_kind='expense_category' and revision.month_start=p_month order by revision.space_id, revision.category_id, revision.currency, revision.id desc
  ), actuals as (
    select coalesce(category.category_id::text, 'uncategorized:expense') key, category.category_id, wallet.currency, sum(case when event.reversal_of is null then -movement.amount_minor else movement.amount_minor end) amount
    from public.financial_events event join public.wallet_movements movement on movement.event_id=event.id and movement.space_id=p_space_id join public.wallets wallet on wallet.id=movement.wallet_id and wallet.space_id=p_space_id
    left join public.financial_event_categories category on category.event_id=event.id and category.space_id=p_space_id
    left join public.financial_events original on original.id=event.reversal_of and original.space_id=p_space_id
    where event.space_id=p_space_id and event.effective_date >= p_month and event.effective_date < p_month + interval '1 month' and coalesce(original.kind,event.kind)='expense'
    group by coalesce(category.category_id::text, 'uncategorized:expense'), category.category_id, wallet.currency
  ), keys as (select category_id, currency from current_targets union select category_id, currency from actuals)
  select coalesce(category.id::text, 'uncategorized:expense'), category.name_en, category.name_ar, coalesce(category.kind, 'expense'::public.category_kind), keys.currency,
    coalesce(actuals.amount,0), coalesce(current_targets.amount_minor,0), coalesce(current_targets.amount_minor,0)-coalesce(actuals.amount,0)
  from keys left join public.categories category on category.id=keys.category_id and category.space_id=p_space_id left join current_targets on current_targets.category_id is not distinct from keys.category_id and current_targets.currency=keys.currency left join actuals on actuals.category_id is not distinct from keys.category_id and actuals.currency=keys.currency
  order by category.name_en nulls last, category.id, keys.currency;
end; $$;

revoke all on function public.report_monthly_cash_summary(uuid,date), public.report_wallet_activity(uuid,date,date,uuid,public.currency_code,integer), public.report_category_actual_vs_budget(uuid,date) from public, anon;
grant execute on function public.report_monthly_cash_summary(uuid,date), public.report_wallet_activity(uuid,date,date,uuid,public.currency_code,integer), public.report_category_actual_vs_budget(uuid,date) to authenticated;
