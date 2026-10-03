-- Forward fixes for confirmed reporting-foundation defects found while
-- verifying the future-planning reporting layer (task 02):
--   1. report_monthly_cash_summary and report_category_actual_vs_budget each
--      re-negated an already-correctly-signed reversal movement, doubling a
--      reversed income/expense instead of netting it to zero.
--   2. report_category_actual_vs_budget ran SECURITY INVOKER but read
--      monthly_budget_plan_revisions, whose privileges are fully revoked, so
--      every authenticated call failed with permission denied.
--   3. report_category_actual_vs_budget grouped actual spend by the exact
--      tagged category instead of rolling a subcategory's spend into its root.
--   4. report_wallet_activity's page-limit guard used `not between`, which is
--      NULL (never TRUE) for an explicit NULL limit, so a NULL p_event_limit
--      silently bypassed the 1..100 cap instead of being rejected.
-- None of these migrations edit prior files; every change here is
-- CREATE OR REPLACE against the existing function signatures.

create or replace function public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date)
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
  from dimensions left join normalized on normalized.currency = dimensions.currency and normalized.effective_date >= dimensions.period_start and normalized.effective_date < dimensions.period_start + interval '1 month'
  group by dimensions.period_start, dimensions.role, dimensions.currency order by dimensions.period_start, dimensions.currency;
end; $$;

create or replace function public.report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid default null, p_currency public.currency_code default null, p_event_limit integer default 50)
returns table (event_id uuid, kind public.financial_event_kind, effective_date date, created_at timestamptz, reversal_of uuid, wallet_id uuid, wallet_name text, currency public.currency_code, amount_minor bigint, has_more boolean)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_space_id is null or p_from_date is null or p_to_date is null or p_to_date <= p_from_date or p_to_date > p_from_date + 366 or p_event_limit is null or p_event_limit not between 1 and 100 or not private.is_active_member(p_space_id) then raise exception using errcode = '42501', message = 'a visible space and bounded report window are required'; end if;
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

create or replace function public.report_category_actual_vs_budget(p_space_id uuid, p_month date)
returns table (category_key text, category_name_en text, category_name_ar text, category_kind public.category_kind, currency public.currency_code, actual_net_minor bigint, budget_minor bigint, remaining_minor bigint)
language plpgsql security definer set search_path = pg_catalog, extensions
as $$
begin
  if p_space_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then raise exception using errcode='42501', message='an active space membership and normalized month are required'; end if;
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
    where event.space_id=p_space_id and event.effective_date >= p_month and event.effective_date < p_month + interval '1 month' and coalesce(original.kind,event.kind)='expense'
    group by coalesce(root.id::text, 'uncategorized:expense'), root.id, wallet.currency
  -- Bare "currency" here is ambiguous against the function's own OUT
  -- parameter of the same name; every reference must be CTE-qualified.
  ), keys as (select category_id, current_targets.currency from current_targets union select category_id, actuals.currency from actuals)
  select coalesce(category.id::text, 'uncategorized:expense'), category.name_en, category.name_ar, coalesce(category.kind, 'expense'::public.category_kind), keys.currency,
    coalesce(actuals.amount,0), coalesce(current_targets.amount_minor,0), coalesce(current_targets.amount_minor,0)-coalesce(actuals.amount,0)
  from keys left join public.categories category on category.id=keys.category_id and category.space_id=p_space_id left join current_targets on current_targets.category_id is not distinct from keys.category_id and current_targets.currency=keys.currency left join actuals on actuals.category_id is not distinct from keys.category_id and actuals.currency=keys.currency
  order by category.name_en nulls last, category.id, keys.currency;
end; $$;

-- report_category_actual_vs_budget is now DEFINER; keep the existing grant
-- boundary (authenticated only, no broadened raw table access).
revoke all on function public.report_category_actual_vs_budget(uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.report_category_actual_vs_budget(uuid,date) to authenticated;

-- Root-only monthly budget targets: a subcategory may never carry its own
-- target (targets live on the root; actual spend rolls up to it). No existing
-- row can violate this today because no live account has used this table yet.
create function private.reject_subcategory_budget_target()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_parent_category_id uuid;
begin
  if new.plan_kind = 'expense_category' then
    select category.parent_category_id into v_parent_category_id
    from public.categories as category
    where category.id = new.category_id and category.space_id = new.space_id;
    if v_parent_category_id is not null then
      raise exception using errcode = 'P0001', message = 'a monthly budget target must reference a root category, not a subcategory';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.reject_subcategory_budget_target() from public, anon, authenticated, service_role;

create trigger monthly_budget_plan_revisions_reject_subcategory_target
before insert on public.monthly_budget_plan_revisions
for each row execute function private.reject_subcategory_budget_target();

create or replace function private.set_monthly_budget_plan(
  p_space_id uuid,
  p_request_id uuid,
  p_category_id uuid,
  p_month date,
  p_currency public.currency_code,
  p_amount_minor text,
  p_expected_revision_id bigint,
  p_plan_kind text
)
returns table (id bigint, month_start date)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_month_start date;
  v_amount_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_id bigint;
  v_current_id bigint;
  v_category_archived_at timestamptz;
  v_category_parent_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_request_id is null or p_month is null or p_currency is null or p_plan_kind not in ('income', 'expense_category') then
    raise exception using errcode = 'P0001', message = 'monthly budget plan inputs are required';
  end if;
  if p_plan_kind = 'income' and p_category_id is not null then
    raise exception using errcode = 'P0001', message = 'income plans cannot have a category';
  end if;
  if p_plan_kind = 'expense_category' and p_category_id is null then
    raise exception using errcode = 'P0001', message = 'expense category targets require a category';
  end if;
  v_amount_minor := private.parse_nonnegative_minor_amount(p_amount_minor);
  v_month_start := date_trunc('month', p_month)::date;
  v_fingerprint := extensions.digest(
    'monthly_budget|' || p_plan_kind || '|' || coalesce(p_category_id::text, '') || '|' || v_month_start::text || '|' || p_currency::text || '|' || v_amount_minor::text || '|' || coalesce(p_expected_revision_id::text, ''),
    'sha256'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_space_id::text || '|' || p_request_id::text, 0));
  select revision.request_fingerprint, revision.id into v_existing_fingerprint, v_existing_id
  from public.monthly_budget_plan_revisions as revision
  where revision.space_id = p_space_id and revision.request_id = p_request_id;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;
    return query select v_existing_id, v_month_start;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_space_id::text || '|' || p_plan_kind || '|' || coalesce(p_category_id::text, '') || '|' || v_month_start::text || '|' || p_currency::text, 0));
  select revision.id into v_current_id
  from public.monthly_budget_plan_revisions as revision
  where revision.space_id = p_space_id and revision.month_start = v_month_start and revision.currency = p_currency
    and revision.plan_kind = p_plan_kind and revision.category_id is not distinct from p_category_id
  order by revision.id desc limit 1 for update;
  if v_current_id is distinct from p_expected_revision_id then
    raise exception using errcode = 'P0001', message = 'the monthly budget plan has changed; refresh and try again';
  end if;
  if p_plan_kind = 'expense_category' then
    select category.archived_at, category.parent_category_id into v_category_archived_at, v_category_parent_id from public.categories as category
    where category.id = p_category_id and category.space_id = p_space_id and category.kind = 'expense';
    if not found then raise exception using errcode = 'P0001', message = 'the requested expense category was not found'; end if;
    if v_category_parent_id is not null then
      raise exception using errcode = 'P0001', message = 'a monthly budget target must reference a root category, not a subcategory';
    end if;
    if v_category_archived_at is not null and v_amount_minor > 0 then
      raise exception using errcode = 'P0001', message = 'an archived category cannot receive a positive target';
    end if;
  end if;
  insert into public.monthly_budget_plan_revisions (
    space_id, request_id, request_fingerprint, plan_kind, month_start, currency, category_id, category_kind, amount_minor, expected_revision_id, actor_id
  ) values (
    p_space_id, p_request_id, v_fingerprint, p_plan_kind, v_month_start, p_currency, p_category_id,
    case when p_plan_kind = 'expense_category' then 'expense'::public.category_kind else null end,
    v_amount_minor, p_expected_revision_id, v_actor_id
  ) returning monthly_budget_plan_revisions.id into v_existing_id;
  return query select v_existing_id, v_month_start;
end;
$$;

-- v2 category page: adds the category_created_at cursor field the original
-- return type was missing (v1 took p_after_created_at but never returned a
-- created_at a client could feed back in) and a has_more flag, and emits one
-- row per (category, currency) that actually has a target or actual amount
-- rather than always cross-joining both currencies for every active category.
-- v1 is unchanged and kept for existing consumers.
create function public.monthly_budget_category_page_v2(
  p_space_id uuid,
  p_month date,
  p_after_created_at text default null,
  p_after_category_id uuid default null,
  p_after_currency public.currency_code default null,
  p_limit integer default 50
)
returns table (
  category_id uuid, category_created_at text, currency public.currency_code,
  name_en text, name_ar text, archived_at timestamptz,
  target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text,
  target_revision_id text, has_more boolean
)
language plpgsql security definer set search_path = pg_catalog, extensions
as $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  -- A JS client's Date object round-trips a timestamptz at millisecond
  -- precision, which can duplicate or drop rows across a page boundary when
  -- two rows share a microsecond-precision timestamp. Returning and accepting
  -- this cursor field as text (like the money fields already do for bigint)
  -- keeps full precision through that round trip; cast back here to compare.
  v_after_created_at timestamptz := p_after_created_at::timestamptz;
begin
  if p_month is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'monthly budget category page limit must be between 1 and 100';
  end if;
  if (p_after_created_at is null) <> (p_after_category_id is null)
    or (p_after_created_at is null) <> (p_after_currency is null) then
    raise exception using errcode = 'P0001', message = 'monthly budget category cursor is incomplete';
  end if;
  return query
  with latest as (
    select distinct on (revision.currency, revision.category_id) revision.*
    from public.monthly_budget_plan_revisions as revision
    where revision.space_id = p_space_id and revision.month_start = v_month_start
      and revision.plan_kind = 'expense_category'
    order by revision.currency, revision.category_id, revision.id desc
  ), expense_actual as (
    select wallet.currency, association.category_id, (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    join public.financial_event_categories as association on association.event_id = event.id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, currency.currency as selected_currency,
      target.amount_minor as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    cross join (values ('USD'::public.currency_code), ('LBP'::public.currency_code)) as currency(currency)
    left join latest as target on target.category_id = category.id and target.currency = currency.currency
    left join expense_actual as actual on actual.category_id = category.id and actual.currency = currency.currency
    where category.space_id = p_space_id and category.kind = 'expense'
      and category.parent_category_id is null
      and (target.id is not null or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.created_at::text, rows.selected_currency, rows.name_en, rows.name_ar, rows.archived_at,
    coalesce(rows.selected_target_minor, 0)::text,
    rows.selected_actual_spent_minor::text,
    greatest(coalesce(rows.selected_target_minor, 0) - rows.selected_actual_spent_minor, 0)::text,
    greatest(rows.selected_actual_spent_minor - coalesce(rows.selected_target_minor, 0), 0)::text,
    rows.selected_target_revision_id::text,
    count(*) over () > p_limit
  from rows
  where v_after_created_at is null
    or (rows.created_at, rows.selected_category_id, rows.selected_currency) > (v_after_created_at, p_after_category_id, p_after_currency)
  order by rows.created_at, rows.selected_category_id, rows.selected_currency
  limit p_limit;
end;
$$;

revoke all on function public.monthly_budget_category_page_v2(uuid, date, text, uuid, public.currency_code, integer) from public, anon, authenticated, service_role;
grant execute on function public.monthly_budget_category_page_v2(uuid, date, text, uuid, public.currency_code, integer) to authenticated;
