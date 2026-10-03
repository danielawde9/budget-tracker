-- Selected payday periods: bounded flows, cumulative stocks, immutable approved bounds.
CREATE OR REPLACE FUNCTION private.space_period_bounds(p_space_id uuid, p_month date)
RETURNS TABLE(period_start date,period_end date) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  select coalesce(d.period_start,private.space_period_anchor(p_space_id,p_month)),
    coalesce(d.end_exclusive,private.space_period_anchor(p_space_id,(date_trunc('month',p_month)+interval '1 month')::date))
  from (values(1)) seed(n) left join public.space_period_definitions d on d.space_id=p_space_id and d.period_key=date_trunc('month',p_month)::date;
$$;

-- Resolve a civil date to a plan key without assuming that payday is the first.
CREATE FUNCTION private.space_period_key_at_date(p_space_id uuid,p_date date)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 select coalesce((select d.period_key from public.space_period_definitions d where d.space_id=p_space_id and p_date>=d.period_start and p_date<d.end_exclusive order by d.period_key desc limit 1),
 case when p_date>=private.space_period_anchor(p_space_id,p_date) then date_trunc('month',p_date)::date else (date_trunc('month',p_date)-interval '1 month')::date end);
$$;
REVOKE ALL ON FUNCTION private.space_period_key_at_date(uuid,date) FROM PUBLIC,anon,authenticated,service_role;

-- Compatible selected-asOf stock projection for the loans gateway and nested summaries.
CREATE FUNCTION public.loan_period_balances(p_space_id uuid,p_period_key date)
RETURNS TABLE(loan_id uuid,space_id uuid,direction public.loan_direction,currency public.currency_code,outstanding_minor text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
declare v_asof date;
begin
 if p_space_id is null or p_period_key is null or not private.is_active_member(p_space_id) then raise exception using errcode='42501',message='planning_not_authorized'; end if;
 v_asof:=(private.space_period_context(p_space_id,p_period_key)->>'asOf')::date;
 return query select l.id,l.space_id,l.direction,l.currency,coalesce(sum(p.principal_delta_minor) filter(where e.effective_date<=v_asof),0)::text
 from public.loans l left join public.loan_postings p on p.loan_id=l.id and p.space_id=l.space_id
 left join public.financial_events e on e.id=p.event_id and e.space_id=l.space_id
 where l.space_id=p_space_id group by l.id;
end; $$;
REVOKE ALL ON FUNCTION public.loan_period_balances(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.loan_period_balances(uuid,date) TO authenticated;

-- Exact historical target/head pairs, paged by immutable goal UUID. C2 supplies remembered defaults.
CREATE FUNCTION public.goal_period_target_page(p_space_id uuid,p_period_key date,p_currency public.currency_code,p_after_goal_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS TABLE("goalId" text,"amountMinor" text,"expectedRevisionId" text,"defaultGroupId" text,"hasMore" boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
begin
 if p_space_id is null or not private.is_active_member(p_space_id) then raise exception using errcode='42501',message='planning_not_authorized'; end if;
 if p_period_key is null or not isfinite(p_period_key) or p_period_key<>date_trunc('month',p_period_key)::date or p_currency is null or p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='planning_invalid_input'; end if;
 return query with candidates as (
  select g.id,t.amount_minor,t.id revision_id from public.goals g
  left join lateral(select r.id,r.amount_minor from public.goal_monthly_target_revisions r where r.space_id=p_space_id and r.goal_id=g.id and r.month_start=p_period_key order by r.id desc limit 1)t on true
  join lateral(select r.state from public.goal_revisions r where r.goal_id=g.id order by r.id desc limit 1) state on true
  where g.space_id=p_space_id and g.currency=p_currency and (p_after_goal_id is null or g.id>p_after_goal_id)
   and (state.state in ('active','paused') or t.id is not null)
  order by g.id limit p_limit+1
 ) select c.id::text,coalesce(c.amount_minor,0)::text,c.revision_id::text,null::text,(select count(*)>p_limit from candidates)
 from candidates c order by c.id limit p_limit;
end; $$;
REVOKE ALL ON FUNCTION public.goal_period_target_page(uuid,date,public.currency_code,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.goal_period_target_page(uuid,date,public.currency_code,uuid,integer) TO authenticated;
ALTER TABLE public.budget_month_closes DROP CONSTRAINT budget_month_closes_check1;

-- Keep the bounded activity reader's nonempty-window contract; the asOf filter makes future flows empty.
CREATE FUNCTION private.planning_period_activity(p_space_id uuid,p_period_key date)
RETURNS TABLE(event_id uuid,effective_date date,currency public.currency_code,root_id uuid,income_minor numeric,expense_minor numeric,cash_minor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 select a.* from (select private.space_period_context(p_space_id,p_period_key) c) context
 cross join lateral private.planning_ordinary_activity(p_space_id,(c->>'start')::date,(c->>'endExclusive')::date) a
 where a.effective_date<=(c->>'asOf')::date;
$$;
REVOKE ALL ON FUNCTION private.planning_period_activity(uuid,date) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.monthly_budget_category_page(p_space_id uuid, p_month date, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_category_id uuid DEFAULT NULL::uuid, p_after_currency public.currency_code DEFAULT NULL::public.currency_code, p_limit integer DEFAULT 50) RETURNS TABLE(category_id uuid, name_en text, name_ar text, archived_at timestamp with time zone, currency public.currency_code, target_minor bigint, actual_spent_minor bigint, remaining_minor bigint, overspent_minor bigint, target_revision_id bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_month_start date := date_trunc('month', p_month)::date;
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
    where event.space_id = p_space_id and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, currency.currency as selected_currency,
      coalesce(target.amount_minor, 0)::bigint as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    cross join (values ('USD'::public.currency_code), ('LBP'::public.currency_code)) as currency(currency)
    left join latest as target on target.category_id = category.id and target.currency = currency.currency
    left join expense_actual as actual on actual.category_id = category.id and actual.currency = currency.currency
    where category.space_id = p_space_id and category.kind = 'expense'
      and (category.archived_at is null or coalesce(target.amount_minor, 0) <> 0 or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.name_en, rows.name_ar, rows.archived_at, rows.selected_currency,
    rows.selected_target_minor, rows.selected_actual_spent_minor,
    greatest(rows.selected_target_minor - rows.selected_actual_spent_minor, 0)::bigint,
    greatest(rows.selected_actual_spent_minor - rows.selected_target_minor, 0)::bigint,
    rows.selected_target_revision_id
  from rows
  where p_after_created_at is null
    or (rows.created_at, rows.selected_category_id, rows.selected_currency) > (p_after_created_at, p_after_category_id, p_after_currency)
  order by rows.created_at, rows.selected_category_id, rows.selected_currency
  limit p_limit;
end;
$$;

CREATE OR REPLACE FUNCTION public.monthly_budget_category_page_v2(p_space_id uuid, p_month date, p_after_created_at text DEFAULT NULL::text, p_after_category_id uuid DEFAULT NULL::uuid, p_after_currency public.currency_code DEFAULT NULL::public.currency_code, p_limit integer DEFAULT 50) RETURNS TABLE(category_id uuid, category_created_at text, currency public.currency_code, name_en text, name_ar text, archived_at timestamp with time zone, target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text, target_revision_id text, has_more boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
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
    where event.space_id = p_space_id and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
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

CREATE OR REPLACE FUNCTION public.monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text DEFAULT NULL::text, p_after_category_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100) RETURNS TABLE(category_id uuid, category_created_at text, name_en text, name_ar text, archived_at timestamp with time zone, target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text, target_revision_id text, has_more boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_month_start date := date_trunc('month', p_month)::date;
  v_after_created_at timestamptz := p_after_created_at::timestamptz;
begin
  if p_month is null or p_currency is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'monthly budget category page limit must be between 1 and 100';
  end if;
  if (p_after_created_at is null) <> (p_after_category_id is null) then
    raise exception using errcode = 'P0001', message = 'monthly budget category cursor is incomplete';
  end if;
  return query
  with latest as (
    select distinct on (revision.category_id) revision.*
    from public.monthly_budget_plan_revisions as revision
    where revision.space_id = p_space_id and revision.month_start = v_month_start
      and revision.currency = p_currency and revision.plan_kind = 'expense_category'
    order by revision.category_id, revision.id desc
  ), expense_actual as (
    select coalesce(tagged.parent_category_id, tagged.id) as root_id,
      (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id and wallet.currency = p_currency
    join public.financial_event_categories as association on association.event_id = event.id
    join public.categories as tagged on tagged.id = association.category_id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by coalesce(tagged.parent_category_id, tagged.id)
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, target.amount_minor as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    left join latest as target on target.category_id = category.id
    left join expense_actual as actual on actual.root_id = category.id
    where category.space_id = p_space_id and category.kind = 'expense'
      and category.parent_category_id is null
      and (category.archived_at is null or coalesce(target.amount_minor, 0) <> 0 or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.created_at::text, rows.name_en, rows.name_ar, rows.archived_at,
    coalesce(rows.selected_target_minor, 0)::text,
    rows.selected_actual_spent_minor::text,
    greatest(coalesce(rows.selected_target_minor, 0) - rows.selected_actual_spent_minor, 0)::text,
    greatest(rows.selected_actual_spent_minor - coalesce(rows.selected_target_minor, 0), 0)::text,
    rows.selected_target_revision_id::text,
    count(*) over () > p_limit
  from rows
  where v_after_created_at is null
    or (rows.created_at, rows.selected_category_id) > (v_after_created_at, p_after_category_id)
  order by rows.created_at, rows.selected_category_id
  limit p_limit;
end;
$$;

CREATE OR REPLACE FUNCTION public.monthly_budget_currency_summary(p_space_id uuid, p_month date) RETURNS TABLE(currency public.currency_code, planned_income_minor bigint, actual_income_minor bigint, category_target_total_minor bigint, category_actual_spent_minor bigint, uncategorized_spent_minor bigint, category_overspent_minor bigint, actual_loan_repayment_minor bigint, remaining_loan_reservation_minor bigint, loan_commitment_minor bigint, unallocated_minor bigint, overallocated_minor bigint, income_plan_revision_id bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
   v_month_start date := date_trunc('month', p_month)::date;
begin
  if p_month is null or not private.is_active_member(p_space_id) then raise exception using errcode = '42501', message = 'an active space membership is required'; end if;
  return query
  with latest as (
    select distinct on (r.plan_kind, r.currency, r.category_id) r.* from public.monthly_budget_plan_revisions r
    where r.space_id = p_space_id and r.month_start = v_month_start order by r.plan_kind, r.currency, r.category_id, r.id desc
  ), currencies as (
    select wallet.currency from public.wallets as wallet where wallet.space_id = p_space_id
    union select latest.currency from latest
    union select loan_summary.currency from public.loan_monthly_currency_summary(p_space_id, v_month_start) as loan_summary
  ), plan as (
    select latest.currency, coalesce(max(latest.amount_minor) filter (where latest.plan_kind = 'income'), 0)::bigint as income,
      coalesce(sum(latest.amount_minor) filter (where latest.plan_kind = 'expense_category'), 0)::bigint as targets,
      max(latest.id) filter (where latest.plan_kind = 'income') as income_revision_id from latest group by latest.currency
  ), loans as (
    select loan_summary.currency, loan_summary.actual_repayment_minor, loan_summary.remaining_reservation_minor
    from public.loan_monthly_currency_summary(p_space_id, v_month_start) as loan_summary
  ), expense_actual as (
    select wallet.currency, association.category_id, (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    left join public.financial_event_categories as association on association.event_id = event.id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), income_actual as (
    select wallet.currency, sum(movement.amount_minor)::bigint as received_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
      and coalesce(original.kind, event.kind) = 'income'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency
  ), expense_summary as (
    select expense_actual.currency, coalesce(sum(expense_actual.spent_minor) filter (where expense_actual.category_id is not null), 0)::bigint as categorized_minor,
      coalesce(sum(expense_actual.spent_minor) filter (where expense_actual.category_id is null), 0)::bigint as uncategorized_minor
    from expense_actual group by expense_actual.currency
  ), overspent as (
    select target.currency, coalesce(sum(greatest(coalesce(actual.spent_minor, 0) - target.amount_minor, 0)), 0)::bigint as amount_minor
    from latest as target left join expense_actual as actual on actual.currency = target.currency and actual.category_id = target.category_id
    where target.plan_kind = 'expense_category' group by target.currency
  )
  select c.currency, coalesce(p.income,0), coalesce(i.received_minor,0), coalesce(p.targets,0), coalesce(e.categorized_minor,0), coalesce(e.uncategorized_minor,0), coalesce(o.amount_minor,0),
    coalesce(l.actual_repayment_minor,0), coalesce(l.remaining_reservation_minor,0),
    (coalesce(l.actual_repayment_minor,0) + coalesce(l.remaining_reservation_minor,0))::bigint,
    greatest(coalesce(p.income,0) - coalesce(p.targets,0) - coalesce(l.actual_repayment_minor,0) - coalesce(l.remaining_reservation_minor,0), 0)::bigint,
    greatest(-(coalesce(p.income,0) - coalesce(p.targets,0) - coalesce(l.actual_repayment_minor,0) - coalesce(l.remaining_reservation_minor,0)), 0)::bigint,
    p.income_revision_id
  from currencies c left join plan p using(currency) left join loans l using(currency)
    left join income_actual i using(currency) left join expense_summary e using(currency) left join overspent o using(currency)
  order by c.currency;
end;
$$;

CREATE OR REPLACE FUNCTION public.allocation_category_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint, p_group_id uuid DEFAULT NULL::uuid, p_after_root_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
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
      root.target_minor, coalesce(link.carry_minor, 0) as carry_minor,
      coalesce(activity.actual, 0) as actual_minor, root.group_id
    from public.allocation_month_roots root
    join public.categories category on category.id = root.category_id and category.space_id = p_space_id
    left join public.budget_month_carry_links link
      on link.target_snapshot_id = root.snapshot_id and link.root_id = root.category_id
    left join (
      select act.root_id, sum(act.expense_minor) as actual
      from private.planning_period_activity(p_space_id,p_month) act
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
      'targetMinor', target_minor::text, 'carryMinor', carry_minor::text,
      'effectiveTargetMinor', (target_minor + carry_minor)::text,
      'actualMinor', actual_minor::text,
      'varianceMinor', (target_minor + carry_minor - actual_minor)::text, 'hasPlan', true, 'groupId', group_id
    ) order by root_id), '[]'::jsonb) from numbered where rn <= p_limit),
    (select count(*) from numbered where rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select root_id from numbered where rn = p_limit)
  into v_rows, v_row_count, v_has_more, v_next_root_id;

  return jsonb_build_object('rows', v_rows, 'nextRootId', case when v_has_more then v_next_root_id else null end, 'hasMore', coalesce(v_has_more, false));
end;
$$;

CREATE OR REPLACE FUNCTION public.allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
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
  v_standalone_goal_targets numeric := 0;
  v_standalone_debt numeric := 0;
  v_future_excess numeric := 0;
  v_left_to_allocate numeric := 0;
  v_groups jsonb := '[]'::jsonb;
  v_unmapped_actual numeric := 0;
  v_unmapped_target numeric := 0;
  v_unmapped_carry numeric := 0;
  v_uncategorized_actual numeric := 0;
  v_carry_total numeric := 0;
  v_carry_source_close_id bigint;
  v_carry_needs_review boolean := false;
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
    from private.planning_period_activity(p_space_id,p_month) activity
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

    select coalesce(sum(carry.carry_minor), 0), max(carry.source_close_id),
      coalesce(sum(carry.carry_minor) filter (where carry.group_id is null), 0)
      into v_carry_total, v_carry_source_close_id, v_unmapped_carry
      from private.allocation_snapshot_carry(v_snapshot.id) carry;
    v_carry_needs_review := private.allocation_snapshot_carry_needs_review(v_snapshot.id);

    select coalesce(sum(root.target_minor),0) into v_standalone_root_targets
      from public.allocation_month_roots root where root.snapshot_id = v_snapshot.id and root.group_id is null;
    select coalesce(sum(goal_line.amount_minor),0) into v_standalone_goal_targets
      from public.allocation_month_goal_lines goal_line where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is null;

    select case when commitment.group_id is null then coalesce(commitment.observed_actual_minor,0) + coalesce(commitment.observed_remaining_minor,0) else 0 end
      into v_standalone_debt
      from public.allocation_month_commitments commitment
      where commitment.snapshot_id = v_snapshot.id;

    select coalesce(sum(greatest(
        coalesce(commitment_for_group.debt_committed,0) + coalesce(goal_for_group.goal_committed,0) - month_group.target_minor, 0
      )),0) into v_future_excess
      from public.allocation_month_groups month_group
      left join (
        select commitment.group_id, commitment.observed_actual_minor + commitment.observed_remaining_minor as debt_committed
        from public.allocation_month_commitments commitment
        where commitment.snapshot_id = v_snapshot.id and commitment.group_id is not null
      ) commitment_for_group on commitment_for_group.group_id = month_group.group_id
      left join (
        select goal_line.group_id, sum(goal_line.amount_minor) as goal_committed
        from public.allocation_month_goal_lines goal_line
        where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is not null
        group by goal_line.group_id
      ) goal_for_group on goal_for_group.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id and month_group.purpose = 'future';

    -- Carry is a distinct adjustment, never salary: left-to-allocate is
    -- still measured against base expected income only.
    v_left_to_allocate := v_snapshot.unallocated_minor - v_standalone_root_targets - v_standalone_goal_targets - v_standalone_debt - v_future_excess;

    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'groupId', month_group.group_id, 'rowKind', month_group.purpose,
        'nameEn', month_group.name_en, 'nameAr', month_group.name_ar, 'order', month_group.display_order,
        'targetMinor', month_group.target_minor::text,
        'carryMinor', coalesce(group_carry.carry_minor, 0)::text,
        'effectiveTargetMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0))::text,
        'actualMinor', (case when month_group.purpose = 'future' then case when commitment_actual.group_id is not null then v_loan_actual else 0 end + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end)::text,
        'varianceMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0)
          - (case when month_group.purpose = 'future' then case when commitment_actual.group_id is not null then v_loan_actual else 0 end + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end))::text,
        'basisPoints', month_group.basis_points,
        'actualShareOfIncomeBps', case when v_actual_income > 0 then
          floor((case when month_group.purpose = 'future' then case when commitment_actual.group_id is not null then v_loan_actual else 0 end + coalesce(goal_actual.actual, 0) else coalesce(group_actual.actual, 0) end) * 10000 / v_actual_income)::text
          else null end,
        'hasPlan', true
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join public.allocation_month_commitments commitment_actual
        on commitment_actual.snapshot_id = month_group.snapshot_id and commitment_actual.group_id = month_group.group_id
      left join (
        select root.group_id, sum(activity.expense_minor) as actual
        from public.allocation_month_roots root
        join private.planning_period_activity(p_space_id,p_month) activity
          on activity.root_id = root.category_id and activity.currency = p_currency
        where root.snapshot_id = v_snapshot.id and root.group_id is not null
        group by root.group_id
      ) group_actual on group_actual.group_id = month_group.group_id
      left join (
        select goal_line.group_id, sum(monthly.net) as actual
        from public.allocation_month_goal_lines goal_line
        cross join lateral (
          select coalesce(sum(el.amount_minor),0) as net
          from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
          where el.goal_id = goal_line.goal_id and ge.effective_date >= v_start and ge.effective_date < v_end and ge.effective_date <= v_asof
        ) monthly
        where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is not null
        group by goal_line.group_id
      ) goal_actual on goal_actual.group_id = month_group.group_id
      left join (
        select carry.group_id, sum(carry.carry_minor) as carry_minor
        from private.allocation_snapshot_carry(v_snapshot.id) carry
        where carry.group_id is not null
        group by carry.group_id
      ) group_carry on group_carry.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );

    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_period_activity(p_space_id,p_month) activity
      where activity.currency = p_currency and activity.root_id is not null
        and not exists (
          select 1 from public.allocation_month_roots root
          where root.snapshot_id = v_snapshot.id and root.category_id = activity.root_id and root.group_id is not null
        );
    v_unmapped_target := v_standalone_root_targets;
  else
    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_period_activity(p_space_id,p_month) activity
      where activity.currency = p_currency and activity.root_id is not null;
  end if;

  select coalesce(sum(activity.expense_minor), 0) into v_uncategorized_actual
    from private.planning_period_activity(p_space_id,p_month) activity
    where activity.currency = p_currency and activity.root_id is null;

  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'unmapped', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', v_unmapped_target::text,
    'carryMinor', v_unmapped_carry::text,
    'effectiveTargetMinor', (v_unmapped_target + v_unmapped_carry)::text,
    'actualMinor', v_unmapped_actual::text,
    'varianceMinor', (v_unmapped_target + v_unmapped_carry - v_unmapped_actual)::text, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_unmapped_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', v_unmapped_target <> 0
  ));
  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'uncategorized', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', null, 'carryMinor', null, 'effectiveTargetMinor', null,
    'actualMinor', v_uncategorized_actual::text, 'varianceMinor', null, 'basisPoints', null,
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
    'childPlanChanged', v_child_plan_changed,
    'carryMinor', v_carry_total::text, 'carrySourceCloseId', v_carry_source_close_id::text,
    'carryNeedsReview', v_carry_needs_review,
    'asOf', now(), 'groups', v_groups
  );
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION public.allocation_trend(p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
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
    select series.month_start,
      sum(activity.income_minor) as income, sum(activity.expense_minor) as expense
    from series cross join lateral (select private.space_period_context(p_space_id,series.month_start) c) context
    cross join lateral private.planning_period_activity(p_space_id,series.month_start) activity
    where activity.currency = p_currency
    group by series.month_start
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

CREATE OR REPLACE FUNCTION public.loan_monthly_plan(p_space_id uuid, p_month date) RETURNS TABLE(loan_id uuid, currency public.currency_code, direction public.loan_direction, target_minor bigint, actual_repayment_minor bigint, remaining_reservation_minor bigint, due_amount_minor bigint, expected_collection_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_month date := date_trunc('month', p_month)::date;
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  with latest_target as (
    select distinct on (revision.loan_id)
      revision.loan_id,
      revision.target_minor
    from public.loan_monthly_target_revisions as revision
    where revision.space_id = p_space_id
      and revision.target_month = v_month
    order by revision.loan_id, revision.created_at desc, revision.id desc
  ),
  actual_repayments as (
    select
      posting.loan_id,
      coalesce(sum(posting.repayment_effect_minor), 0)::bigint as actual_repayment_minor
    from public.loan_postings as posting
    join public.financial_events as event on event.id = posting.event_id
    where posting.space_id = p_space_id
      and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
    group by posting.loan_id
  )
  select
    loan.id,
    loan.currency,
    loan.direction,
    coalesce(target.target_minor, 0)::bigint,
    greatest(coalesce(actual.actual_repayment_minor, 0), 0)::bigint,
    least(
      greatest(
        coalesce(target.target_minor, 0) - greatest(coalesce(actual.actual_repayment_minor, 0), 0),
        0
      ),
      balance.outstanding_minor::bigint
    )::bigint,
    case
      when loan.due_date >= v_start and loan.due_date < v_end then balance.outstanding_minor::bigint
      else 0
    end::bigint,
    case when loan.direction = 'they_owe_me' then balance.outstanding_minor::bigint else 0 end::bigint
  from public.loans as loan
  join public.loan_period_balances(p_space_id,date_trunc('month',p_month)::date) as balance on balance.loan_id = loan.id
  left join latest_target as target on target.loan_id = loan.id
  left join actual_repayments as actual on actual.loan_id = loan.id
  where loan.space_id = p_space_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_monthly_currency_summary(p_space_id uuid, p_month date) RETURNS TABLE(currency public.currency_code, owed_to_me_minor bigint, i_owe_minor bigint, due_amount_minor bigint, planned_repayment_minor bigint, actual_repayment_minor bigint, remaining_reservation_minor bigint, expected_collection_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select
    plan.currency,
    coalesce(sum(case when plan.direction = 'they_owe_me' then balance.outstanding_minor::bigint else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then balance.outstanding_minor::bigint else 0 end), 0)::bigint,
    coalesce(sum(plan.due_amount_minor), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.target_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.actual_repayment_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.remaining_reservation_minor else 0 end), 0)::bigint,
    coalesce(sum(plan.expected_collection_minor), 0)::bigint
  from public.loan_monthly_plan(p_space_id, p_month) as plan
  join public.loan_period_balances(p_space_id,date_trunc('month',p_month)::date) as balance on balance.loan_id = plan.loan_id
  group by plan.currency;
end;
$$;

CREATE OR REPLACE FUNCTION private.budget_month_close_facts(p_space_id uuid, p_currency public.currency_code, p_month date, p_snapshot_id bigint, p_fact_cap integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_next_month date;
  v_count bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_currency is null or p_month is null or p_snapshot_id is null
    or p_fact_cap is null or p_fact_cap < 0 or p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_next_month := least(v_end,v_asof+1);

  -- Cheap early refusal before building the digest input.
  select count(*) into v_count
  from public.financial_events event
  join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = event.space_id
  join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = event.space_id
  left join public.financial_events original on original.id = event.reversal_of and original.space_id = event.space_id
  where event.space_id = p_space_id and event.effective_date >= v_start and event.effective_date < v_next_month
    and wallet.currency = p_currency and coalesce(original.kind, event.kind) in ('income', 'expense');
  if v_count > p_fact_cap then
    raise exception using errcode='54000', message='range_too_large';
  end if;

  with facts as (
    select event.id as event_id, movement.id as movement_id, event.effective_date, event.kind as event_kind,
      coalesce(original.kind, event.kind) as semantic_kind,
      category.id as category_id, coalesce(category.parent_category_id, category.id) as root_id,
      movement.amount_minor
    from public.financial_events event
    join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = event.space_id
    join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = event.space_id
    left join public.financial_events original on original.id = event.reversal_of and original.space_id = event.space_id
    left join public.financial_event_categories event_category
      on event_category.event_id = event.id and event_category.space_id = event.space_id
    left join public.financial_event_categories original_category
      on original_category.event_id = original.id and original_category.space_id = event.space_id
    left join public.categories category
      on category.id = coalesce(event_category.category_id, original_category.category_id) and category.space_id = event.space_id
    where event.space_id = p_space_id and event.effective_date >= v_start and event.effective_date < v_next_month
      and wallet.currency = p_currency and coalesce(original.kind, event.kind) in ('income', 'expense')
  ), totals as (
    select count(*) as fact_count,
      coalesce(sum(amount_minor::numeric) filter (where semantic_kind = 'income'), 0) as income_minor,
      coalesce(sum(-amount_minor::numeric) filter (where semantic_kind = 'expense'), 0) as spending_minor,
      extensions.digest(
        '{"version":1,"currency":' || to_jsonb(p_currency::text)::text
          || ',"month":' || to_jsonb(p_month)::text
          || ',"count":' || count(*)::text
          || ',"facts":[' || coalesce(string_agg(jsonb_build_array(
            event_id, movement_id, effective_date, event_kind, semantic_kind, category_id, root_id, amount_minor::text
          )::text, ',' order by event_id, movement_id), '') || ']}',
        'sha256') as fact_digest
    from facts
  ), root_actuals as (
    select snapshot_root.category_id as root_id,
      coalesce(sum(-fact.amount_minor::numeric) filter (where fact.semantic_kind = 'expense'), 0) as actual_minor
    from public.allocation_month_roots snapshot_root
    left join facts fact on fact.root_id = snapshot_root.category_id
    where snapshot_root.snapshot_id = p_snapshot_id
    group by snapshot_root.category_id
  )
  select jsonb_build_object(
    'factCount', totals.fact_count::text,
    'factDigest', encode(totals.fact_digest, 'hex'),
    'incomeMinor', totals.income_minor::text,
    'spendingMinor', totals.spending_minor::text,
    'roots', coalesce((select jsonb_object_agg(root_actuals.root_id::text, root_actuals.actual_minor::text) from root_actuals), '{}'::jsonb)
  ) into v_result
  from totals;

  if (v_result->>'factCount')::bigint > p_fact_cap then
    raise exception using errcode='54000', message='range_too_large';
  end if;
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION private.budget_month_close_preview(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_today date := private.space_today(p_space_id);
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_head public.budget_month_closes%rowtype;
  v_has_head boolean;
  v_facts jsonb;
  v_roots jsonb;
  v_restatement boolean := false;
  v_preview jsonb;
begin
  if (private.space_period_context(p_space_id,p_month)->>'endExclusive')::date > v_today then
    raise exception using errcode='22023', message='budget_month_not_ended';
  end if;

  select * into v_snapshot from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = p_month
    order by id desc limit 1;
  if not found then
    raise exception using errcode='P0001', message='budget_month_close_requires_plan';
  end if;

  select * into v_head from public.budget_month_closes
    where space_id = p_space_id and currency = p_currency and month_start = p_month
    order by id desc limit 1;
  v_has_head := found;

  v_facts := private.budget_month_close_facts(p_space_id, p_currency, p_month, v_snapshot.id, 100000);

  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', snapshot_root.category_id, 'nameEn', category.name_en, 'nameAr', category.name_ar,
      'groupId', snapshot_root.group_id,
      'baseMinor', snapshot_root.target_minor::text,
      'carryMinor', coalesce(link.carry_minor, 0)::text,
      'effectiveMinor', (snapshot_root.target_minor + coalesce(link.carry_minor, 0))::text,
      'actualMinor', coalesce(v_facts->'roots'->>snapshot_root.category_id::text, '0'),
      'outgoingCarryMinor', (case when coalesce(policy.enabled, false)
        then snapshot_root.target_minor + coalesce(link.carry_minor, 0)
          - coalesce((v_facts->'roots'->>snapshot_root.category_id::text)::numeric, 0)
        else 0 end)::text,
      'enabled', coalesce(policy.enabled, false),
      'policyRevisionId', policy.id::text,
      'carrySourceCloseId', link.source_close_id::text
    ) order by snapshot_root.category_id), '[]'::jsonb)
  into v_roots
  from public.allocation_month_roots snapshot_root
  join public.categories category on category.id = snapshot_root.category_id and category.space_id = p_space_id
  left join lateral (
    select revision.id, revision.enabled from public.rollover_policy_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.root_id = snapshot_root.category_id
    order by revision.id desc limit 1
  ) policy on true
  left join public.budget_month_carry_links link
    on link.target_snapshot_id = snapshot_root.snapshot_id and link.root_id = snapshot_root.category_id
  where snapshot_root.snapshot_id = v_snapshot.id;

  -- Restatement is required exactly when re-closing now would freeze
  -- something different from the latest close.
  if v_has_head then
    v_restatement := v_head.source_snapshot_id is distinct from v_snapshot.id
      or encode(v_head.fact_digest, 'hex') is distinct from (v_facts->>'factDigest')
      or v_head.fact_count::text is distinct from (v_facts->>'factCount')
      or (select coalesce(jsonb_agg(jsonb_build_object(
            'categoryId', close_root.root_id, 'baseMinor', close_root.base_target_minor::text,
            'carryMinor', close_root.incoming_carry_minor::text, 'actualMinor', close_root.actual_minor::text,
            'outgoingCarryMinor', close_root.outgoing_carry_minor::text, 'enabled', close_root.enabled,
            'policyRevisionId', close_root.policy_revision_id::text
          ) order by close_root.root_id), '[]'::jsonb)
          from public.budget_month_close_roots close_root where close_root.close_id = v_head.id)
        is distinct from
         (select coalesce(jsonb_agg(jsonb_build_object(
            'categoryId', root->'categoryId', 'baseMinor', root->'baseMinor', 'carryMinor', root->'carryMinor',
            'actualMinor', root->'actualMinor', 'outgoingCarryMinor', root->'outgoingCarryMinor',
            'enabled', root->'enabled', 'policyRevisionId', root->'policyRevisionId'
          ) order by (root->>'categoryId')::uuid), '[]'::jsonb)
          from jsonb_array_elements(v_roots) root);
  end if;

  v_preview := jsonb_build_object(
    'month', p_month, 'currency', p_currency,
    'expectedCloseId', case when v_has_head then v_head.id::text else null end,
    'snapshotId', v_snapshot.id::text,
    'incomeMinor', v_facts->'incomeMinor', 'spendingMinor', v_facts->'spendingMinor',
    'factCount', v_facts->'factCount', 'factDigest', v_facts->'factDigest',
    'restatementRequired', v_restatement, 'roots', v_roots
  );
  return v_preview || jsonb_build_object('previewHash', encode(extensions.digest(jsonb_build_object(
    'version', 1, 'kind', 'budget_month_close', 'spaceId', p_space_id,
    'expectedCloseIdInput', p_expected_close_id::text, 'preview', v_preview
  )::text, 'sha256'), 'hex'));
end;
$$;

CREATE OR REPLACE FUNCTION public.publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_month date;
  v_income_minor bigint;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_snapshot_id bigint;
  v_template_space uuid;
  v_template_currency public.currency_code;
  v_template_groups jsonb;
  v_group_targets jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_category_ids uuid[] := '{}';
  v_entry jsonb;
  v_category_id uuid;
  v_amount_minor bigint;
  v_expected_revision_id bigint;
  v_required_missing integer;
  v_existing_positive_goals integer;
  v_over_target_groups integer;
  v_loan_group_purpose text;
  v_loan_group_target bigint;
  v_loan_actual bigint;
  v_loan_remaining bigint;
  v_income_child_request uuid;
  v_income_id bigint;
  v_income_month date;
  v_child_request uuid;
  v_root_revision_id bigint;
  v_snapshot_id bigint;
  v_group_count integer;
  v_root_count integer;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_month is null or p_currency is null
    or p_template_revision_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;
  v_income_minor := private.planning_minor(p_income_minor);
  if p_root_targets is null or jsonb_typeof(p_root_targets) is distinct from 'array'
    or jsonb_array_length(p_root_targets) > 200 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  for v_entry in select value from jsonb_array_elements(p_root_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['categoryId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('publish_allocation_month', v_actor, jsonb_build_object(
    'month', v_month, 'currency', p_currency, 'expectedSnapshotId', p_expected_snapshot_id,
    'templateRevisionId', p_template_revision_id, 'expectedIncomeRevisionId', p_expected_income_revision_id,
    'incomeMinor', v_income_minor::text, 'rootTargets', v_canonical_roots, 'loanGroupId', p_loan_group_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'publish_allocation_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  if v_current_snapshot_id is distinct from p_expected_snapshot_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select count(*) into v_existing_positive_goals
  from (
    select revision.goal_id from public.goal_monthly_target_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
  ) required
  cross join lateral (
    select latest.amount_minor from public.goal_monthly_target_revisions latest
    where latest.goal_id = required.goal_id and latest.space_id = p_space_id
      and latest.currency = p_currency and latest.month_start = v_month
    order by latest.id desc limit 1
  ) latest_target
  where latest_target.amount_minor > 0;
  if v_existing_positive_goals <> 0 then
    raise exception using errcode='P0001', message='existing positive goal targets must be included via publish_allocation_month_v2';
  end if;

  -- The template need not be the latest revision -- the caller deliberately
  -- selected it -- but it must be a real revision belonging to this exact
  -- space and currency.
  select space_id, currency into v_template_space, v_template_currency
    from public.allocation_template_revisions where id = p_template_revision_id;
  if not found or v_template_space is distinct from p_space_id or v_template_currency is distinct from p_currency then
    raise exception using errcode='P0001', message='the selected template does not belong to this space and currency';
  end if;

  v_template_groups := (
    select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
    from public.allocation_template_lines line where line.template_id = p_template_revision_id
  );
  v_group_targets := (select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', g.group_id, 'targetMinor', g.target_minor, 'isResidual', g.is_residual
    )), '[]'::jsonb) from private.allocate_planning_income(v_income_minor::text, v_template_groups) g);

  -- Complete-set rule: every template-mapped root, plus every category that
  -- currently has a positive manual target this month/currency, must appear
  -- in this submission (a stopped target is submitted explicitly as zero).
  select count(*) into v_required_missing
  from (
    select template_root.category_id from public.allocation_template_roots template_root
    where template_root.template_id = p_template_revision_id
    union
    select revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
      and revision.plan_kind = 'expense_category'
  ) required
  left join public.monthly_budget_plan_revisions latest_target
    on latest_target.space_id = p_space_id and latest_target.currency = p_currency
    and latest_target.month_start = v_month and latest_target.plan_kind = 'expense_category'
    and latest_target.category_id = required.category_id
  where (latest_target.amount_minor is null or latest_target.amount_minor > 0)
    and not (required.category_id = any(v_category_ids));
  if v_required_missing <> 0 then
    raise exception using errcode='P0001', message='every template-mapped root and existing positive target must be included in a complete-set publication';
  end if;

  -- Fail fast on group overallocation (the deferred check re-verifies this
  -- exactly against the snapshot rows once they are actually inserted).
  select count(*) into v_over_target_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select tr.group_id, sum((rt->>'amountMinor')::bigint) as root_total
    from jsonb_array_elements(v_canonical_roots) rt
    join public.allocation_template_roots tr
      on tr.template_id = p_template_revision_id and tr.category_id = (rt->>'categoryId')::uuid
    group by tr.group_id
  ) mapped on mapped.group_id = group_target.group_id
  where coalesce(mapped.root_total, 0) > group_target.target_minor;
  if v_over_target_groups <> 0 then
    raise exception using errcode='P0001', message='the requested root targets exceed their spending group target';
  end if;

  -- Loan pool: a linked group must be an included Future group large enough
  -- for the observed commitment; a standalone loan pool has no group-fit
  -- constraint and may be saved even while overallocated.
  select coalesce(summary.actual_repayment_minor, 0), coalesce(summary.remaining_reservation_minor, 0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);
  if p_loan_group_id is not null then
    select (g->>'targetMinor')::bigint into v_loan_group_target
      from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = p_loan_group_id;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = p_loan_group_id and space_id = p_space_id and currency = p_currency;
    if v_loan_group_target is null or v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='the loan pool group must be an included Future group';
    end if;
    if v_loan_actual + v_loan_remaining > v_loan_group_target then
      raise exception using errcode='P0001', message='the observed loan commitment does not fit its linked Future group';
    end if;
  end if;

  -- Publish the income plan, then each root target, in category-UUID order,
  -- each under a request ID deterministically derived from this command's
  -- own request ID so a retry with the same parent request replays the same
  -- children instead of minting new revisions.
  v_income_child_request := private.planning_child_request(p_request_id, 'income:' || p_currency::text || ':' || v_month::text);
  select id, month_start into v_income_id, v_income_month
    from public.set_monthly_income_plan(p_space_id, v_income_child_request, v_month, p_currency, v_income_minor::text, p_expected_income_revision_id);

  perform private.ensure_space_period_definition(p_space_id,p_month);
  insert into public.allocation_month_snapshots (
    space_id, currency, month_start, template_revision_id, income_plan_revision_id, expected_snapshot_id,
    base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, goal_line_count, request_id, actor_id
  ) values (
    p_space_id, p_currency, v_month, p_template_revision_id, v_income_id, p_expected_snapshot_id,
    v_income_minor,
    (select coalesce((g->>'targetMinor')::bigint, 0) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is true),
    (select count(*) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true),
    jsonb_array_length(v_canonical_roots), 1, 0, p_request_id, v_actor
  ) returning id into v_snapshot_id;

  insert into public.allocation_month_groups (snapshot_id, group_id, space_id, currency, name_en, name_ar, purpose, display_order, basis_points, target_minor)
  select v_snapshot_id, line.group_id, p_space_id, p_currency, line.name_en, line.name_ar, grp.purpose, line.display_order, line.basis_points,
    (select (g->>'targetMinor')::bigint from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = line.group_id)
  from public.allocation_template_lines line
  join public.allocation_groups grp on grp.id = line.group_id and grp.space_id = p_space_id
  where line.template_id = p_template_revision_id;

  for v_entry in select value from jsonb_array_elements(v_canonical_roots) loop
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'category:' || v_category_id::text || ':' || p_currency::text || ':' || v_month::text);
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
    insert into public.allocation_month_roots (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
    values (
      v_snapshot_id, v_category_id,
      (select template_root.group_id from public.allocation_template_roots template_root
        where template_root.template_id = p_template_revision_id and template_root.category_id = v_category_id),
      p_space_id, p_currency, v_root_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  insert into public.allocation_month_commitments (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
  values (v_snapshot_id, p_space_id, p_currency, p_loan_group_id, 'loan_pool', v_loan_actual, v_loan_remaining);

  v_result := jsonb_build_object('snapshotId', v_snapshot_id::text, 'incomeRevisionId', v_income_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'publish_allocation_month', v_fingerprint, v_actor, v_result);

  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_month date;
  v_income_minor bigint;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_snapshot_id bigint;
  v_template_space uuid;
  v_template_currency public.currency_code;
  v_template_groups jsonb;
  v_group_targets jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_canonical_goals jsonb := '[]'::jsonb;
  v_category_ids uuid[] := '{}';
  v_goal_ids uuid[] := '{}';
  v_entry jsonb;
  v_category_id uuid;
  v_goal_id uuid;
  v_amount_minor bigint;
  v_expected_revision_id bigint;
  v_required_missing integer;
  v_required_missing_goals integer;
  v_over_target_groups integer;
  v_over_target_goal_groups integer;
  v_loan_group_purpose text;
  v_loan_group_target bigint;
  v_loan_actual bigint;
  v_loan_remaining bigint;
  v_income_child_request uuid;
  v_income_id bigint;
  v_income_month date;
  v_child_request uuid;
  v_root_revision_id bigint;
  v_goal_revision_id bigint;
  v_snapshot_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_month is null or p_currency is null
    or p_template_revision_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;
  v_income_minor := private.planning_minor(p_income_minor);
  if p_root_targets is null or jsonb_typeof(p_root_targets) is distinct from 'array'
    or jsonb_array_length(p_root_targets) > 200 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_goal_targets is null or jsonb_typeof(p_goal_targets) is distinct from 'array'
    or jsonb_array_length(p_goal_targets) > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  for v_entry in select value from jsonb_array_elements(p_root_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['categoryId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  for v_entry in select value from jsonb_array_elements(p_goal_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','groupId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['goalId','groupId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'groupId') not in ('string','null')
      or (jsonb_typeof(v_entry->'groupId') = 'string' and (v_entry->>'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_goal_id := (v_entry->>'goalId')::uuid;
    if v_goal_id = any(v_goal_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_goal_ids := array_append(v_goal_ids, v_goal_id);
    v_canonical_goals := v_canonical_goals || jsonb_build_array(jsonb_build_object(
      'goalId', v_goal_id, 'groupId', v_entry->'groupId', 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_goals := (select coalesce(jsonb_agg(g order by g->>'goalId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_goals) g);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('publish_allocation_month_v2', v_actor, jsonb_build_object(
    'month', v_month, 'currency', p_currency, 'expectedSnapshotId', p_expected_snapshot_id,
    'templateRevisionId', p_template_revision_id, 'expectedIncomeRevisionId', p_expected_income_revision_id,
    'incomeMinor', v_income_minor::text, 'rootTargets', v_canonical_roots, 'loanGroupId', p_loan_group_id,
    'goalTargets', v_canonical_goals
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'publish_allocation_month_v2', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  if v_current_snapshot_id is distinct from p_expected_snapshot_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select space_id, currency into v_template_space, v_template_currency
    from public.allocation_template_revisions where id = p_template_revision_id;
  if not found or v_template_space is distinct from p_space_id or v_template_currency is distinct from p_currency then
    raise exception using errcode='P0001', message='the selected template does not belong to this space and currency';
  end if;

  v_template_groups := (
    select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
    from public.allocation_template_lines line where line.template_id = p_template_revision_id
  );
  v_group_targets := (select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', g.group_id, 'targetMinor', g.target_minor, 'isResidual', g.is_residual
    )), '[]'::jsonb) from private.allocate_planning_income(v_income_minor::text, v_template_groups) g);

  select count(*) into v_required_missing
  from (
    select template_root.category_id from public.allocation_template_roots template_root
    where template_root.template_id = p_template_revision_id
    union
    select revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
      and revision.plan_kind = 'expense_category'
  ) required
  left join public.monthly_budget_plan_revisions latest_target
    on latest_target.space_id = p_space_id and latest_target.currency = p_currency
    and latest_target.month_start = v_month and latest_target.plan_kind = 'expense_category'
    and latest_target.category_id = required.category_id
  where (latest_target.amount_minor is null or latest_target.amount_minor > 0)
    and not (required.category_id = any(v_category_ids));
  if v_required_missing <> 0 then
    raise exception using errcode='P0001', message='every template-mapped root and existing positive target must be included in a complete-set publication';
  end if;

  -- Complete-set rule for goals: every goal with a currently positive
  -- monthly target this month/currency must appear (zero explicitly clears
  -- it; omission rejects). Goals have no template mapping to union in.
  select count(*) into v_required_missing_goals
  from (
    select distinct revision.goal_id from public.goal_monthly_target_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
  ) required
  cross join lateral (
    select latest.amount_minor from public.goal_monthly_target_revisions latest
    where latest.goal_id = required.goal_id and latest.space_id = p_space_id
      and latest.currency = p_currency and latest.month_start = v_month
    order by latest.id desc limit 1
  ) latest_target
  where latest_target.amount_minor > 0 and not (required.goal_id = any(v_goal_ids));
  if v_required_missing_goals <> 0 then
    raise exception using errcode='P0001', message='every existing positive goal target must be included in a complete-set publication';
  end if;

  select count(*) into v_over_target_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select tr.group_id, sum((rt->>'amountMinor')::bigint) as root_total
    from jsonb_array_elements(v_canonical_roots) rt
    join public.allocation_template_roots tr
      on tr.template_id = p_template_revision_id and tr.category_id = (rt->>'categoryId')::uuid
    group by tr.group_id
  ) mapped on mapped.group_id = group_target.group_id
  where coalesce(mapped.root_total, 0) > group_target.target_minor;
  if v_over_target_groups <> 0 then
    raise exception using errcode='P0001', message='the requested root targets exceed their spending group target';
  end if;

  select coalesce(summary.actual_repayment_minor, 0), coalesce(summary.remaining_reservation_minor, 0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);
  if p_loan_group_id is not null then
    select (g->>'targetMinor')::bigint into v_loan_group_target
      from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = p_loan_group_id;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = p_loan_group_id and space_id = p_space_id and currency = p_currency;
    if v_loan_group_target is null or v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='the loan pool group must be an included Future group';
    end if;
    if v_loan_actual + v_loan_remaining > v_loan_group_target then
      raise exception using errcode='P0001', message='the observed loan commitment does not fit its linked Future group';
    end if;
  end if;

  -- Every goal target linked to a group must target an included Future
  -- group, and debt commitment plus goal targets together must not exceed
  -- that group's own target.
  for v_entry in select value from jsonb_array_elements(v_canonical_goals) loop
    if v_entry->>'groupId' is null then
      continue;
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_group_targets) g
      where (g->>'groupId')::uuid = (v_entry->>'groupId')::uuid and (g->>'isResidual')::boolean is not true
    ) then
      raise exception using errcode='P0001', message='a goal target must link to an included group';
    end if;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = (v_entry->>'groupId')::uuid and space_id = p_space_id and currency = p_currency;
    if v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='a goal target must link to a Future group';
    end if;
  end loop;

  select count(*) into v_over_target_goal_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select (gt->>'groupId')::uuid as group_id, sum((gt->>'amountMinor')::bigint) as goal_total
    from jsonb_array_elements(v_canonical_goals) gt where gt->>'groupId' is not null
    group by (gt->>'groupId')::uuid
  ) goal_sum on goal_sum.group_id = group_target.group_id
  where coalesce(goal_sum.goal_total, 0)
    + (case when group_target.group_id = p_loan_group_id then v_loan_actual + v_loan_remaining else 0 end)
    > group_target.target_minor;
  if v_over_target_goal_groups <> 0 then
    raise exception using errcode='P0001', message='the requested goal targets and debt commitment exceed their Future group target';
  end if;

  v_income_child_request := private.planning_child_request(p_request_id, 'income:' || p_currency::text || ':' || v_month::text);
  select id, month_start into v_income_id, v_income_month
    from public.set_monthly_income_plan(p_space_id, v_income_child_request, v_month, p_currency, v_income_minor::text, p_expected_income_revision_id);

  perform private.ensure_space_period_definition(p_space_id,p_month);
  insert into public.allocation_month_snapshots (
    space_id, currency, month_start, template_revision_id, income_plan_revision_id, expected_snapshot_id,
    base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, goal_line_count, request_id, actor_id
  ) values (
    p_space_id, p_currency, v_month, p_template_revision_id, v_income_id, p_expected_snapshot_id,
    v_income_minor,
    (select coalesce((g->>'targetMinor')::bigint, 0) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is true),
    (select count(*) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true),
    jsonb_array_length(v_canonical_roots), 1, jsonb_array_length(v_canonical_goals), p_request_id, v_actor
  ) returning id into v_snapshot_id;

  insert into public.allocation_month_groups (snapshot_id, group_id, space_id, currency, name_en, name_ar, purpose, display_order, basis_points, target_minor)
  select v_snapshot_id, line.group_id, p_space_id, p_currency, line.name_en, line.name_ar, grp.purpose, line.display_order, line.basis_points,
    (select (g->>'targetMinor')::bigint from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = line.group_id)
  from public.allocation_template_lines line
  join public.allocation_groups grp on grp.id = line.group_id and grp.space_id = p_space_id
  where line.template_id = p_template_revision_id;

  for v_entry in select value from jsonb_array_elements(v_canonical_roots) loop
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'category:' || v_category_id::text || ':' || p_currency::text || ':' || v_month::text);
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
    insert into public.allocation_month_roots (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
    values (
      v_snapshot_id, v_category_id,
      (select template_root.group_id from public.allocation_template_roots template_root
        where template_root.template_id = p_template_revision_id and template_root.category_id = v_category_id),
      p_space_id, p_currency, v_root_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  for v_entry in select value from jsonb_array_elements(v_canonical_goals) loop
    v_goal_id := (v_entry->>'goalId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'goal:' || v_goal_id::text || ':' || p_currency::text || ':' || v_month::text);
    v_goal_revision_id := (public.set_goal_monthly_target(
      p_space_id, v_child_request, v_goal_id, v_month, v_entry->>'amountMinor', v_expected_revision_id
    )->>'revisionId')::bigint;
    insert into public.allocation_month_goal_lines (snapshot_id, goal_id, space_id, currency, month_start, group_id, target_revision_id, amount_minor)
    values (
      v_snapshot_id, v_goal_id, p_space_id, p_currency, v_month,
      nullif(v_entry->>'groupId', '')::uuid, v_goal_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  insert into public.allocation_month_commitments (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
  values (v_snapshot_id, p_space_id, p_currency, p_loan_group_id, 'loan_pool', v_loan_actual, v_loan_remaining);

  v_result := jsonb_build_object('snapshotId', v_snapshot_id::text, 'incomeRevisionId', v_income_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'publish_allocation_month_v2', v_fingerprint, v_actor, v_result);

  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_preview jsonb;
  v_published jsonb;
  v_snapshot_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_source_snapshot_id is null
    or p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date
    or p_accepted_preview_hash is null or p_accepted_preview_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('copy_allocation_month', v_actor, jsonb_build_object(
    'currency', p_currency, 'sourceSnapshotId', p_source_snapshot_id::text, 'targetMonth', p_target_month,
    'expectedTargetSnapshotId', p_expected_target_snapshot_id::text, 'acceptedPreviewHash', p_accepted_preview_hash
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'copy_allocation_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  v_preview := private.month_copy_preview(p_space_id, p_currency, p_source_snapshot_id, p_target_month);
  if (v_preview->>'expectedTargetSnapshotId') is distinct from p_expected_target_snapshot_id::text
    or (v_preview->>'previewHash') is distinct from p_accepted_preview_hash then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  -- The accepted preview is published through the existing v2 command under
  -- a request ID derived from this command's own, so v2 keeps every one of
  -- its own checks (complete set, group fit, loan re-observation).
  perform private.ensure_space_period_definition(p_space_id,(v_preview->>'sourceMonth')::date);
  v_published := public.publish_allocation_month_v2(
    p_space_id, private.planning_child_request(p_request_id, 'copy_allocation_month:publish'),
    p_target_month, p_currency, p_expected_target_snapshot_id,
    (v_preview->>'templateRevisionId')::bigint, (v_preview->>'expectedIncomeRevisionId')::bigint,
    v_preview->>'incomeMinor',
    (select coalesce(jsonb_agg(jsonb_build_object(
        'categoryId', root->'categoryId', 'amountMinor', root->'baseMinor', 'expectedRevisionId', root->'expectedRevisionId'
      )), '[]'::jsonb) from jsonb_array_elements(v_preview->'roots') root),
    (v_preview->>'loanGroupId')::uuid,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'goalId', goal->'goalId', 'groupId', goal->'groupId', 'amountMinor', goal->'targetMinor',
        'expectedRevisionId', goal->'expectedRevisionId'
      )), '[]'::jsonb) from jsonb_array_elements(v_preview->'goals') goal)
  );
  v_snapshot_id := (v_published->>'snapshotId')::bigint;

  insert into public.budget_month_carry_links (
    space_id, currency, source_close_id, source_month_start, target_snapshot_id, target_month_start,
    root_id, carry_minor, actor_id
  )
  select p_space_id, p_currency, (carry->>'sourceCloseId')::bigint, (p_target_month - interval '1 month')::date,
    v_snapshot_id, p_target_month, (carry->>'rootId')::uuid, (carry->>'carryMinor')::numeric, v_actor
  from jsonb_array_elements(v_preview->'carrySources') carry;

  v_result := jsonb_build_object(
    'snapshotId', v_snapshot_id::text, 'sourceSnapshotId', p_source_snapshot_id::text,
    'previewHash', p_accepted_preview_hash
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'copy_allocation_month', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_preview jsonb;
  v_snapshot_id bigint;
  v_close_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_month is null
    or p_accepted_preview_hash is null or p_accepted_preview_hash !~ '^[0-9a-f]{64}$'
    or p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('close_budget_month', v_actor, jsonb_build_object(
    'currency', p_currency, 'month', p_month, 'expectedCloseId', p_expected_close_id::text,
    'acceptedPreviewHash', p_accepted_preview_hash
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'close_budget_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Recompute under the space lock: a posting committed since the preview
  -- changes the fact digest and therefore the hash.
  v_preview := private.budget_month_close_preview(p_space_id, p_currency, p_month, p_expected_close_id);
  if (v_preview->>'expectedCloseId') is distinct from p_expected_close_id::text
    or (v_preview->>'previewHash') is distinct from p_accepted_preview_hash then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;
  v_snapshot_id := (v_preview->>'snapshotId')::bigint;

  perform private.ensure_space_period_definition(p_space_id,p_month);
  insert into public.budget_month_closes (
    space_id, currency, month_start, source_snapshot_id, expected_close_id, fact_digest, fact_count, root_count,
    closed_income_minor, closed_spending_minor, request_id, actor_id
  ) values (
    p_space_id, p_currency, p_month, v_snapshot_id, p_expected_close_id, decode(v_preview->>'factDigest', 'hex'),
    (v_preview->>'factCount')::bigint, jsonb_array_length(v_preview->'roots'),
    (v_preview->>'incomeMinor')::numeric, (v_preview->>'spendingMinor')::numeric, p_request_id, v_actor
  ) returning id into v_close_id;

  insert into public.budget_month_close_roots (
    close_id, space_id, currency, month_start, source_snapshot_id, root_id, policy_revision_id, enabled,
    base_target_minor, incoming_carry_minor, actual_minor, outgoing_carry_minor
  )
  select v_close_id, p_space_id, p_currency, p_month, v_snapshot_id, (root->>'categoryId')::uuid,
    (root->>'policyRevisionId')::bigint, (root->>'enabled')::boolean, (root->>'baseMinor')::bigint,
    (root->>'carryMinor')::numeric, (root->>'actualMinor')::numeric, (root->>'outgoingCarryMinor')::numeric
  from jsonb_array_elements(v_preview->'roots') root;

  v_result := jsonb_build_object(
    'closeId', v_close_id::text, 'previewHash', p_accepted_preview_hash, 'restatesCloseId', p_expected_close_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'close_budget_month', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION private.planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS TABLE(group_id uuid, group_target_minor numeric, debt_commitment_minor numeric, goal_topups_minor numeric, saved_goal_targets_minor numeric, original_debt_commitment_minor numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month date := private.space_period_key_at_date(p_space_id,p_as_of);
  v_context jsonb := private.space_period_context(p_space_id,v_month);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_month_end date := v_end-1;
  v_snapshot_id bigint;
  v_has_snapshot boolean := false;
  v_commitment_group_id uuid;
  v_commitment_original numeric := 0;
  v_live_debt numeric := 0;
begin
  select id into v_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  v_has_snapshot := v_snapshot_id is not null;

  if v_has_snapshot then
    select commitment.group_id, commitment.observed_actual_minor + commitment.observed_remaining_minor
      into v_commitment_group_id, v_commitment_original
      from public.allocation_month_commitments commitment where commitment.snapshot_id = v_snapshot_id;
  end if;

  select coalesce(sum(greatest(plan.remaining_reservation_minor, coalesce(sched.remaining_minor, 0))), 0)
    into v_live_debt
  from public.loan_monthly_plan(p_space_id, v_month) plan
  left join (
    select so.loan_id, sum(greatest(so.expected_minor - stl.settled_minor, 0)) as remaining_minor
    from public.scheduled_occurrences so
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.space_id = p_space_id and so.currency = p_currency and so.loan_id is not null
      and so.due_date <= v_month_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
    group by so.loan_id
  ) sched on sched.loan_id = plan.loan_id
  where plan.currency = p_currency and plan.direction = 'i_owe_them';

  return query
  with buckets as (
    select month_group.group_id as bucket_id, month_group.target_minor::numeric as bucket_target
    from public.allocation_month_groups month_group
    where v_has_snapshot and month_group.snapshot_id = v_snapshot_id and month_group.purpose = 'future'
    union all
    select null::uuid, null::numeric
  ), goal_rows as (
    select relevant.goal_id,
      saved.group_id as bucket_id,
      coalesce(saved.amount_minor, 0)::numeric as saved_target,
      greatest(coalesce(saved.amount_minor, 0) - coalesce((
        select sum(el.amount_minor) from public.goal_earmark_lines el
        join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = relevant.goal_id and ge.effective_date >= v_start and ge.effective_date < v_end and ge.effective_date <= p_as_of
      ), 0), 0) as u_minor
    from private.goal_coverage_set(p_space_id, p_currency, p_as_of) relevant
    left join public.allocation_month_goal_lines saved
      on v_has_snapshot and saved.snapshot_id = v_snapshot_id and saved.goal_id = relevant.goal_id
  )
  -- Debt attaches to whichever bucket the snapshot's loan pool names
  -- (v_commitment_group_id, defaulting to null/standalone when no snapshot
  -- exists at all) -- never gated on v_has_snapshot itself, so a live debt
  -- fact still surfaces via the standalone bucket even before any month is
  -- ever published.
  select buckets.bucket_id, buckets.bucket_target,
    case when buckets.bucket_id is not distinct from v_commitment_group_id then v_live_debt else 0 end,
    coalesce((select sum(goal_rows.u_minor) from goal_rows where goal_rows.bucket_id is not distinct from buckets.bucket_id), 0),
    coalesce((select sum(goal_rows.saved_target) from goal_rows where goal_rows.bucket_id is not distinct from buckets.bucket_id), 0),
    case when buckets.bucket_id is not distinct from v_commitment_group_id then coalesce(v_commitment_original, 0) else 0 end
  from buckets;
end;
$$;

CREATE OR REPLACE FUNCTION private.planning_expense_buckets(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_month_end date, p_horizon_end date) RETURNS TABLE(group_id uuid, root_id uuid, budget_remaining_minor numeric, unpaid_bills_minor numeric, goal_overlap_minor numeric, commitment_minor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  with snapshot as (
    select id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = private.space_period_key_at_date(p_space_id,p_as_of)
    order by id desc limit 1
  ), root_targets as (
    select r.category_id as root_id, r.group_id,
      r.target_minor::numeric + coalesce(link.carry_minor, 0) as target_minor
    from public.allocation_month_roots r
    left join public.budget_month_carry_links link
      on link.target_snapshot_id = r.snapshot_id and link.root_id = r.category_id
    where r.snapshot_id = (select id from snapshot)
  ), group_targets as (
    select g.group_id,
      g.target_minor::numeric + coalesce((
        select sum(link.carry_minor)
        from public.budget_month_carry_links link
        join public.allocation_month_roots r on r.snapshot_id = link.target_snapshot_id and r.category_id = link.root_id
        where link.target_snapshot_id = g.snapshot_id and r.group_id = g.group_id
      ), 0) as target_minor
    from public.allocation_month_groups g
    where g.snapshot_id = (select id from snapshot) and g.purpose = 'spending'
  ), spent as (
    select act.root_id, sum(act.expense_minor) as spent_minor
    from private.planning_ordinary_activity(p_space_id, (private.space_period_context(p_space_id,private.space_period_key_at_date(p_space_id,p_as_of))->>'start')::date, p_as_of + 1) act
    where act.currency = p_currency and act.root_id is not null
    group by act.root_id
  ), unpaid_bills as (
    select coalesce(cat.parent_category_id, cat.id) as root_id, so.id as occurrence_id,
      greatest(so.expected_minor - stl.settled_minor, 0) as remaining_minor
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind = 'expense'
    left join public.categories cat on cat.id = so.category_id and cat.space_id = p_space_id
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.space_id = p_space_id and so.currency = p_currency
      and so.due_date <= p_month_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
  ), coverage as (
    select * from private.planning_goal_bill_coverage(p_space_id, p_currency, p_as_of, p_horizon_end)
  ), bill_totals as (
    select unpaid_bills.root_id, sum(unpaid_bills.remaining_minor) as o_minor,
      coalesce(sum(coverage.applied_minor), 0) as g_minor
    from unpaid_bills
    left join coverage on coverage.occurrence_id = unpaid_bills.occurrence_id
    group by unpaid_bills.root_id
  ), mapped_group_totals as (
    select root_targets.group_id,
      coalesce(sum(spent.spent_minor), 0) as spent_minor,
      coalesce(sum(bill_totals.o_minor), 0) as o_minor,
      coalesce(sum(bill_totals.g_minor), 0) as g_minor
    from root_targets
    left join spent on spent.root_id = root_targets.root_id
    left join bill_totals on bill_totals.root_id = root_targets.root_id
    where root_targets.group_id is not null
    group by root_targets.group_id
  ), group_buckets as (
    select group_targets.group_id, null::uuid as root_id,
      greatest(group_targets.target_minor - coalesce(mapped_group_totals.spent_minor, 0), 0) as b_minor,
      coalesce(mapped_group_totals.o_minor, 0) as o_minor, coalesce(mapped_group_totals.g_minor, 0) as g_minor
    from group_targets
    left join mapped_group_totals on mapped_group_totals.group_id = group_targets.group_id
  ), unmapped_root_buckets as (
    select null::uuid as group_id, root_targets.root_id,
      greatest(root_targets.target_minor - coalesce(spent.spent_minor, 0), 0) as b_minor,
      coalesce(bill_totals.o_minor, 0) as o_minor, coalesce(bill_totals.g_minor, 0) as g_minor
    from root_targets
    left join spent on spent.root_id = root_targets.root_id
    left join bill_totals on bill_totals.root_id = root_targets.root_id
    where root_targets.group_id is null
  ), untargeted_bill_buckets as (
    select null::uuid as group_id, bill_totals.root_id,
      0::numeric as b_minor, bill_totals.o_minor, bill_totals.g_minor
    from bill_totals
    where not exists (
      select 1 from root_targets where root_targets.root_id is not distinct from bill_totals.root_id
    )
  ), buckets as (
    select * from group_buckets
    union all select * from unmapped_root_buckets
    union all select * from untargeted_bill_buckets
  )
  select buckets.group_id, buckets.root_id, buckets.b_minor, buckets.o_minor, buckets.g_minor,
    greatest(buckets.b_minor, buckets.o_minor) - least(buckets.g_minor, greatest(buckets.b_minor, buckets.o_minor))
  from buckets;
$$;

CREATE OR REPLACE FUNCTION public.available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_today date := private.space_today(p_space_id);
  v_month date;
  v_month_end date;
  v_horizon_end date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_has_snapshot boolean := false;
  v_missing_count integer := 0;
  v_backlog_count integer := 0;
  v_unmaterialized_count integer := 0;
  v_state text;
  v_needs_review boolean := false;
  v_cash numeric := 0;
  v_claims numeric := 0;
  v_received_income numeric := 0;
  v_ordinary_spending numeric := 0;
  v_uncategorized numeric := 0;
  v_days_remaining integer;
  v_expense_commitments numeric;
  v_debt_commitments numeric;
  v_goal_topups numeric;
  v_future_headroom numeric;
  v_available numeric;
  v_deficit numeric;
  v_spendable numeric;
  v_daily_guide numeric;
  v_groups jsonb := '[]'::jsonb;
  v_current_income_id bigint;
begin
  if p_space_id is null or p_currency is null or p_as_of_date is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_as_of_date <> v_today then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_month := private.space_period_key_at_date(p_space_id,v_today);
  v_month_end := (private.space_period_context(p_space_id,v_month)->>'endExclusive')::date-1;
  v_horizon_end := v_today + 89;
  v_days_remaining := (v_month_end - v_today) + 1;

  v_cash := private.goal_cash_pool(p_space_id, p_currency, v_today);
  v_claims := private.goal_space_earmarked_total(p_space_id, p_currency, v_today);

  select coalesce(sum(activity.income_minor), 0), coalesce(sum(activity.expense_minor), 0),
    coalesce(sum(activity.expense_minor) filter (where activity.root_id is null), 0)
    into v_received_income, v_ordinary_spending, v_uncategorized
    from private.planning_ordinary_activity(p_space_id, (private.space_period_context(p_space_id,v_month)->>'start')::date, v_today + 1) activity
    where activity.currency = p_currency;

  select * into v_snapshot from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  v_has_snapshot := found;

  if v_has_snapshot then
    v_missing_count := private.planning_materialization_gap(p_space_id, p_currency, v_today, v_horizon_end);
    if v_missing_count = 0 then
      v_backlog_count := private.planning_unpaid_backlog_count(p_space_id, p_currency, v_today, v_horizon_end);
    end if;
  end if;

  if not v_has_snapshot then
    v_state := 'unplanned';
  elsif v_missing_count > 0 or v_backlog_count > 500 then
    v_state := 'incomplete';
  else
    v_state := 'ready';
  end if;

  -- unmaterializedCount reports "how many things need materializing before
  -- this number can be trusted," never the ordinary unpaid-bill count of a
  -- healthy plan. v_backlog_count is computed (and only computed) once
  -- v_missing_count is already known to be zero, so it is meaningful only
  -- as the specific >500 trigger the brief names, never as a generic bill
  -- count: report it only when it actually exceeded that cap.
  if v_missing_count > 0 then
    v_unmaterialized_count := v_missing_count;
  elsif v_backlog_count > 500 then
    v_unmaterialized_count := v_backlog_count;
  end if;

  if v_state = 'ready' then
    select id into v_current_income_id from public.monthly_budget_plan_revisions
      where space_id = p_space_id and currency = p_currency and month_start = v_month and plan_kind = 'income'
      order by id desc limit 1;
    if v_current_income_id is distinct from v_snapshot.income_plan_revision_id then
      v_needs_review := true;
    end if;
    if not v_needs_review and exists (
      select 1 from public.allocation_month_roots root
      left join lateral (
        select revision.id from public.monthly_budget_plan_revisions revision
        where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
          and revision.plan_kind = 'expense_category' and revision.category_id = root.category_id
        order by revision.id desc limit 1
      ) current_head on true
      where root.snapshot_id = v_snapshot.id and current_head.id is distinct from root.target_revision_id
    ) then
      v_needs_review := true;
    end if;
    if not v_needs_review and exists (
      select 1 from public.allocation_month_goal_lines goal_line
      left join lateral (
        select revision.id from public.goal_monthly_target_revisions revision
        where revision.goal_id = goal_line.goal_id and revision.space_id = p_space_id
          and revision.currency = p_currency and revision.month_start = v_month
        order by revision.id desc limit 1
      ) current_head on true
      where goal_line.snapshot_id = v_snapshot.id and current_head.id is distinct from goal_line.target_revision_id
    ) then
      v_needs_review := true;
    end if;

    select coalesce(sum(bucket.commitment_minor), 0) into v_expense_commitments
      from private.planning_expense_buckets(p_space_id, p_currency, v_today, v_month_end, v_horizon_end) bucket;

    select coalesce(sum(commitment.debt_commitment_minor), 0), coalesce(sum(commitment.goal_topups_minor), 0),
      coalesce(sum(greatest(
        commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor, 0
      )) filter (where commitment.group_target_minor is not null), 0)
      into v_debt_commitments, v_goal_topups, v_future_headroom
      from private.planning_cash_commitments(p_space_id, p_currency, v_today) commitment;

    v_available := v_cash - v_claims - v_expense_commitments - v_debt_commitments - v_goal_topups - v_future_headroom;
    v_deficit := greatest(-v_available, 0);
    v_spendable := greatest(v_available, 0);
    v_daily_guide := floor(v_spendable / v_days_remaining);

    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', month_group.group_id, 'nameEn', month_group.name_en, 'nameAr', month_group.name_ar,
        'budgetRemainingMinor',
          (case when month_group.purpose = 'future'
            then commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor
            else bucket.budget_remaining_minor end)::text,
        'unpaidBillsMinor', (case when month_group.purpose = 'future' then null else bucket.unpaid_bills_minor::text end),
        'goalOverlapMinor', (case when month_group.purpose = 'future' then null else bucket.goal_overlap_minor::text end),
        'commitmentMinor',
          (case when month_group.purpose = 'future'
            then commitment.debt_commitment_minor + commitment.goal_topups_minor
              + greatest(commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor, 0)
            else coalesce(bucket.commitment_minor, 0) end)::text
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join private.planning_expense_buckets(p_space_id, p_currency, v_today, v_month_end, v_horizon_end) bucket
        on bucket.group_id = month_group.group_id
      left join private.planning_cash_commitments(p_space_id, p_currency, v_today) commitment
        on commitment.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );
  end if;

  return jsonb_build_object(
    'currency', p_currency, 'asOf', p_as_of_date, 'state', v_state, 'needsReview', v_needs_review,
    'snapshotId', case when v_has_snapshot then v_snapshot.id::text else null end,
    'cashMinor', v_cash::text, 'goalClaimsMinor', v_claims::text,
    'expenseCommitmentsMinor', case when v_state = 'ready' then v_expense_commitments::text else null end,
    'debtCommitmentsMinor', case when v_state = 'ready' then v_debt_commitments::text else null end,
    'goalTopupsMinor', case when v_state = 'ready' then v_goal_topups::text else null end,
    'futureHeadroomMinor', case when v_state = 'ready' then v_future_headroom::text else null end,
    'availableMinor', case when v_state = 'ready' then v_available::text else null end,
    'deficitMinor', case when v_state = 'ready' then v_deficit::text else null end,
    'spendableMinor', case when v_state = 'ready' then v_spendable::text else null end,
    'dailyExtraGuideMinor', case when v_state = 'ready' then v_daily_guide::text else null end,
    'daysRemaining', v_days_remaining,
    'receivedIncomeMinor', v_received_income::text, 'ordinarySpendingMinor', v_ordinary_spending::text,
    'incomeMinusSpendingMinor', (v_received_income - v_ordinary_spending)::text,
    'uncategorizedMinor', v_uncategorized::text,
    'unmaterializedCount', v_unmaterialized_count,
    'groups', v_groups
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.record_goal_earmark(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text, p_expected_head text, p_accept_underfunded boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_goal public.goals%rowtype;
  v_state text;
  v_target_minor bigint;
  v_amount_minor bigint;
  v_today date;
  v_earmarked numeric; v_fulfilled numeric; v_head text;
  v_max_reserve numeric;
  v_space_total numeric;
  v_cash_pool numeric;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_goal_id is null or p_action is null
    or p_amount_minor is null or p_expected_head is null or p_accept_underfunded is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_action not in ('reserve','release') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_expected_head !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_amount_minor := private.planning_minor(p_amount_minor, true);
  v_today := private.space_today(p_space_id);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('record_goal_earmark', v_actor, jsonb_build_object(
    'goalId', p_goal_id, 'action', p_action, 'amountMinor', v_amount_minor::text,
    'expectedHead', p_expected_head, 'acceptUnderfunded', p_accept_underfunded
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'record_goal_earmark', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;
  select state, target_minor into v_state, v_target_minor from public.goal_revisions where goal_id = p_goal_id order by id desc limit 1;

  select earmarked_minor, fulfilled_minor, head into v_earmarked, v_fulfilled, v_head
    from private.goal_financing_state(p_goal_id, v_today);
  if v_head is distinct from p_expected_head then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if p_action = 'reserve' then
    if v_state <> 'active' then
      raise exception using errcode='P0001', message='a reserve requires an active goal';
    end if;
    v_max_reserve := greatest(v_target_minor - v_earmarked - v_fulfilled, 0);
    if v_amount_minor > v_max_reserve then
      raise exception using errcode='P0001', message='the reserve exceeds the goal''s remaining room';
    end if;
    if not p_accept_underfunded then
      select coalesce(sum(t), 0) into v_space_total from (
        select private.goal_space_earmarked_total(p_space_id, v_goal.currency, v_today) as t
      ) totals;
      v_cash_pool := greatest(private.goal_cash_pool(p_space_id, v_goal.currency, v_today), 0);
      if v_space_total + v_amount_minor > v_cash_pool then
        raise exception using errcode='22023', message='goal_underfunded_confirmation_required';
      end if;
    end if;
    insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id, effective_date)
      values (p_space_id, v_goal.currency, 'reserve', 1, p_request_id, v_actor, v_today) returning id into v_event_id;
    insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
      values (v_event_id, p_goal_id, p_space_id, v_goal.currency, v_amount_minor);
  else
    if v_amount_minor > v_earmarked then
      raise exception using errcode='P0001', message='the release exceeds the goal''s current earmark';
    end if;
    insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id, effective_date)
      values (p_space_id, v_goal.currency, 'release', 1, p_request_id, v_actor, v_today) returning id into v_event_id;
    insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
      values (v_event_id, p_goal_id, p_space_id, v_goal.currency, -v_amount_minor);
  end if;

  v_result := jsonb_build_object('eventId', v_event_id::text, 'goalId', p_goal_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'record_goal_earmark', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.move_goal_earmark(p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text, p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_from public.goals%rowtype;
  v_to public.goals%rowtype;
  v_to_state text; v_to_target bigint;
  v_amount_minor bigint;
  v_today date;
  v_from_earmarked numeric; v_from_fulfilled numeric; v_from_head text;
  v_to_earmarked numeric; v_to_fulfilled numeric; v_to_head text;
  v_max_reserve numeric;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_from_goal_id is null or p_to_goal_id is null
    or p_amount_minor is null or p_expected_from_head is null or p_expected_to_head is null or p_accept_underfunded is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_from_goal_id = p_to_goal_id then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_expected_from_head !~ '^[0-9a-f]{64}$' or p_expected_to_head !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_amount_minor := private.planning_minor(p_amount_minor, true);
  v_today := private.space_today(p_space_id);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('move_goal_earmark', v_actor, jsonb_build_object(
    'fromGoalId', p_from_goal_id, 'toGoalId', p_to_goal_id, 'amountMinor', v_amount_minor::text,
    'expectedFromHead', p_expected_from_head, 'expectedToHead', p_expected_to_head, 'acceptUnderfunded', p_accept_underfunded
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'move_goal_earmark', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_from from public.goals where id = p_from_goal_id and space_id = p_space_id;
  select * into v_to from public.goals where id = p_to_goal_id and space_id = p_space_id;
  if v_from.id is null or v_to.id is null then
    raise exception using errcode='P0001', message='both goals must belong to the requested space';
  end if;
  if v_from.currency is distinct from v_to.currency then
    raise exception using errcode='P0001', message='a move requires both goals to share a currency';
  end if;

  select earmarked_minor, fulfilled_minor, head into v_from_earmarked, v_from_fulfilled, v_from_head
    from private.goal_financing_state(p_from_goal_id, v_today);
  select earmarked_minor, fulfilled_minor, head into v_to_earmarked, v_to_fulfilled, v_to_head
    from private.goal_financing_state(p_to_goal_id, v_today);
  if v_from_head is distinct from p_expected_from_head or v_to_head is distinct from p_expected_to_head then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if v_amount_minor > v_from_earmarked then
    raise exception using errcode='P0001', message='the move exceeds the source goal''s current earmark';
  end if;
  select state, target_minor into v_to_state, v_to_target from public.goal_revisions where goal_id = p_to_goal_id order by id desc limit 1;
  if v_to_state <> 'active' then
    raise exception using errcode='P0001', message='a move destination requires an active goal';
  end if;
  v_max_reserve := greatest(v_to_target - v_to_earmarked - v_to_fulfilled, 0);
  if v_amount_minor > v_max_reserve then
    raise exception using errcode='P0001', message='the move exceeds the destination goal''s remaining room';
  end if;

  insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id, effective_date)
    values (p_space_id, v_from.currency, 'move', 2, p_request_id, v_actor, v_today) returning id into v_event_id;
  insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor) values
    (v_event_id, p_from_goal_id, p_space_id, v_from.currency, -v_amount_minor),
    (v_event_id, p_to_goal_id, p_space_id, v_from.currency, v_amount_minor);

  v_result := jsonb_build_object('eventId', v_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'move_goal_earmark', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.reverse_goal_earmark(p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_original public.goal_earmark_events%rowtype;
  v_today date;
  v_entry jsonb;
  v_expected_goal_ids uuid[] := '{}';
  v_original_goal_ids uuid[];
  v_head text;
  v_new_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_event_id is null or p_expected_heads is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_expected_heads) is distinct from 'array' or jsonb_array_length(p_expected_heads) not between 1 and 2 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_expected_heads) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','head']) is not true or (v_entry - array['goalId','head']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'head') is distinct from 'string'
      or (v_entry->>'head') !~ '^[0-9a-f]{64}$'
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_expected_goal_ids := array_append(v_expected_goal_ids, (v_entry->>'goalId')::uuid);
  end loop;
  v_today := private.space_today(p_space_id);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('reverse_goal_earmark', v_actor, jsonb_build_object(
    'eventId', p_event_id, 'expectedHeads', (select coalesce(jsonb_agg(e order by e->>'goalId'), '[]'::jsonb) from jsonb_array_elements(p_expected_heads) e)
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'reverse_goal_earmark', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_original from public.goal_earmark_events where id = p_event_id and space_id = p_space_id for update;
  if not found or v_original.operation = 'reverse' then
    raise exception using errcode='P0001', message='the requested event cannot be reversed';
  end if;
  if exists(select 1 from public.goal_earmark_events where reversal_of = p_event_id) then
    raise exception using errcode='P0001', message='the requested event already has a reversal';
  end if;

  select coalesce(array_agg(distinct goal_id order by goal_id), '{}') into v_original_goal_ids
    from public.goal_earmark_lines where event_id = p_event_id;
  if (select array_agg(x order by x) from unnest(v_expected_goal_ids) x) is distinct from v_original_goal_ids then
    raise exception using errcode='P0001', message='expected heads must name exactly the original event''s goals';
  end if;

  for v_entry in select value from jsonb_array_elements(p_expected_heads) loop
    select head into v_head from private.goal_financing_state((v_entry->>'goalId')::uuid, v_today);
    if v_head is distinct from (v_entry->>'head') then
      raise exception using errcode='40001', message='planning_stale_revision';
    end if;
  end loop;

  insert into public.goal_earmark_events (space_id, currency, operation, reversal_of, line_count, request_id, actor_id, effective_date)
    values (p_space_id, v_original.currency, 'reverse', p_event_id, v_original.line_count, p_request_id, v_actor, v_today)
    returning id into v_new_event_id;
  insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
    select v_new_event_id, goal_id, space_id, currency, -amount_minor
    from public.goal_earmark_lines where event_id = p_event_id;

  v_result := jsonb_build_object('eventId', v_new_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'reverse_goal_earmark', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.revise_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint, p_definition jsonb, p_milestones jsonb, p_state text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_goal public.goals%rowtype;
  v_current_revision_id bigint;
  v_name_en text; v_name_ar text; v_note text;
  v_target_minor bigint; v_deadline date; v_contribution_mode text; v_monthly_minor bigint; v_priority integer;
  v_canonical_milestones jsonb;
  v_entry jsonb;
  v_milestone_ids uuid[] := '{}';
  v_bad_kind_change integer;
  v_earmarked numeric;
  v_revision_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_goal_id is null or p_expected_revision_id is null
    or p_definition is null or p_milestones is null or p_state is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_state not in ('active','paused','closed') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object'
    or (p_definition ?& array['kind','currency','nameEn','nameAr','note','targetMinor','deadline','contributionMode','monthlyAmountMinor','priority']) is not true
    or (p_definition - array['kind','currency','nameEn','nameAr','note','targetMinor','deadline','contributionMode','monthlyAmountMinor','priority']) <> '{}'::jsonb
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'kind') is distinct from 'string' or (p_definition->>'kind') not in ('reserve','purchase') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'currency') is distinct from 'string' or (p_definition->>'currency') not in ('USD','LBP') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'nameEn') not in ('string','null') or jsonb_typeof(p_definition->'nameAr') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'note') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_name_en := nullif(p_definition->>'nameEn', '');
  v_name_ar := nullif(p_definition->>'nameAr', '');
  v_note := p_definition->>'note';
  v_target_minor := private.planning_minor(p_definition->>'targetMinor', true);
  if jsonb_typeof(p_definition->'deadline') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if nullif(p_definition->>'deadline','') is not null and not pg_input_is_valid(p_definition->>'deadline', 'date') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_deadline := nullif(p_definition->>'deadline', '')::date;
  if jsonb_typeof(p_definition->'contributionMode') is distinct from 'string'
    or (p_definition->>'contributionMode') not in ('manual_monthly','by_deadline')
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_contribution_mode := p_definition->>'contributionMode';
  if jsonb_typeof(p_definition->'monthlyAmountMinor') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_monthly_minor := case when p_definition->>'monthlyAmountMinor' is null then null
    else private.planning_minor(p_definition->>'monthlyAmountMinor', false) end;
  if jsonb_typeof(p_definition->'priority') is distinct from 'number'
    or (p_definition->>'priority')::numeric <> floor((p_definition->>'priority')::numeric)
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_priority := (p_definition->>'priority')::integer;
  if v_priority < 0 or v_priority > 999 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  if jsonb_typeof(p_milestones) is distinct from 'array' or jsonb_array_length(p_milestones) > 20 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_milestones) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['id','kind','labelEn','labelAr','thresholdMinor','dueDate','ordinal']) is not true
      or (v_entry - array['id','kind','labelEn','labelAr','thresholdMinor','dueDate','ordinal']) <> '{}'::jsonb
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'kind') not in ('amount','checklist')
      or jsonb_typeof(v_entry->'labelEn') not in ('string','null')
      or jsonb_typeof(v_entry->'labelAr') not in ('string','null')
      or jsonb_typeof(v_entry->'thresholdMinor') not in ('string','null')
      or jsonb_typeof(v_entry->'dueDate') not in ('string','null')
      or (nullif(v_entry->>'dueDate','') is not null and not pg_input_is_valid(v_entry->>'dueDate', 'date'))
      or (nullif(v_entry->>'thresholdMinor','') is not null and v_entry->>'thresholdMinor' !~ '^[0-9]+$')
      or jsonb_typeof(v_entry->'ordinal') is distinct from 'number'
      or (v_entry->>'ordinal')::numeric <> floor((v_entry->>'ordinal')::numeric)
      or (v_entry->>'ordinal')::numeric not between 0 and 19
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    if (v_entry->>'id')::uuid = any(v_milestone_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_milestone_ids := array_append(v_milestone_ids, (v_entry->>'id')::uuid);
  end loop;
  v_canonical_milestones := (select coalesce(jsonb_agg(m order by m->>'id'), '[]'::jsonb) from jsonb_array_elements(p_milestones) m);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('revise_goal_plan', v_actor, jsonb_build_object(
    'goalId', p_goal_id, 'expectedRevisionId', p_expected_revision_id, 'definition', p_definition,
    'milestones', v_canonical_milestones, 'state', p_state
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'revise_goal_plan', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;
  if (p_definition->>'kind') is distinct from v_goal.kind or (p_definition->>'currency') is distinct from v_goal.currency::text then
    raise exception using errcode='P0001', message='a goal revision cannot change its kind or currency';
  end if;

  select id into v_current_revision_id from public.goal_revisions
    where goal_id = p_goal_id order by id desc limit 1;
  if v_current_revision_id is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if p_state = 'closed' then
    select earmarked_minor into v_earmarked from private.goal_financing_state(p_goal_id, private.space_today(p_space_id));
    if v_earmarked <> 0 then
      raise exception using errcode='P0001', message='closing a goal requires its current earmark to be zero';
    end if;
  end if;

  -- A milestone identity already carrying checklist events cannot change kind
  -- or move to another goal (the goal is fixed by the identity's own FK; only
  -- the kind can drift across revisions without this check).
  select count(*) into v_bad_kind_change
  from jsonb_array_elements(p_milestones) m
  join public.goal_milestones existing on existing.id = (m->>'id')::uuid and existing.goal_id = p_goal_id
  where exists(select 1 from public.goal_milestone_events ev where ev.milestone_id = existing.id)
    and exists(
      select 1 from public.goal_revision_milestones grm
      where grm.milestone_id = existing.id and grm.kind is distinct from (m->>'kind')
    );
  if v_bad_kind_change <> 0 then
    raise exception using errcode='P0001', message='a milestone with checklist history cannot change kind';
  end if;

  insert into public.goal_revisions (
    goal_id, space_id, currency, expected_revision_id, name_en, name_ar, note, target_minor, deadline,
    contribution_mode, monthly_minor, priority, state, milestone_count, request_id, actor_id
  ) values (
    p_goal_id, p_space_id, v_goal.currency, p_expected_revision_id, v_name_en, v_name_ar, v_note, v_target_minor, v_deadline,
    v_contribution_mode, v_monthly_minor, v_priority, p_state, jsonb_array_length(p_milestones), p_request_id, v_actor
  ) returning id into v_revision_id;

  for v_entry in select value from jsonb_array_elements(p_milestones) loop
    insert into public.goal_milestones (id, goal_id, space_id, currency)
      values ((v_entry->>'id')::uuid, p_goal_id, v_goal.space_id, v_goal.currency)
      on conflict (id) do nothing;
    insert into public.goal_revision_milestones (
      revision_id, milestone_id, goal_id, space_id, currency, kind, label_en, label_ar, threshold_minor, due_date, ordinal
    ) values (
      v_revision_id, (v_entry->>'id')::uuid, p_goal_id, v_goal.space_id, v_goal.currency, v_entry->>'kind',
      nullif(v_entry->>'labelEn',''), nullif(v_entry->>'labelAr',''),
      case when v_entry->>'thresholdMinor' is null then null else private.planning_minor(v_entry->>'thresholdMinor', true) end,
      nullif(v_entry->>'dueDate','')::date, (v_entry->>'ordinal')::integer
    );
  end loop;

  v_result := jsonb_build_object('goalId', p_goal_id::text, 'revisionId', v_revision_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'revise_goal_plan', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION private.check_goal_earmark_event(p_event_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_event public.goal_earmark_events%rowtype;
  v_original public.goal_earmark_events%rowtype;
  v_line_count integer;
  v_positive_count integer;
  v_negative_count integer;
  v_distinct_goals integer;
  v_line_sum bigint;
  v_reverse_mismatch integer;
  v_bad_balance integer;
  v_as_of date;
begin
  select * into v_event from public.goal_earmark_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='goal_earmark_event_missing';
  end if;
  v_as_of := greatest(private.space_today(v_event.space_id), v_event.effective_date);

  select count(*), count(*) filter (where amount_minor > 0), count(*) filter (where amount_minor < 0),
    count(distinct goal_id), coalesce(sum(amount_minor),0)
    into v_line_count, v_positive_count, v_negative_count, v_distinct_goals, v_line_sum
    from public.goal_earmark_lines where event_id = p_event_id;

  if v_line_count is distinct from v_event.line_count then
    raise exception using errcode='23514', message='goal_earmark_line_count_mismatch';
  end if;

  if v_event.operation = 'reserve' then
    if v_line_count <> 1 or v_positive_count <> 1 then
      raise exception using errcode='23514', message='goal_earmark_reserve_shape_invalid';
    end if;
  elsif v_event.operation = 'release' then
    if v_line_count <> 1 or v_negative_count <> 1 then
      raise exception using errcode='23514', message='goal_earmark_release_shape_invalid';
    end if;
  elsif v_event.operation = 'move' then
    if v_line_count <> 2 or v_distinct_goals <> 2 or v_positive_count <> 1
      or v_negative_count <> 1 or v_line_sum <> 0 then
      raise exception using errcode='23514', message='goal_earmark_move_shape_invalid';
    end if;
  elsif v_event.operation = 'reverse' then
    select * into v_original from public.goal_earmark_events where id = v_event.reversal_of for update;
    if not found or v_original.operation = 'reverse' then
      raise exception using errcode='23514', message='goal_earmark_reverse_target_invalid';
    end if;
    if v_line_count is distinct from v_original.line_count then
      raise exception using errcode='23514', message='goal_earmark_reverse_shape_invalid';
    end if;
    select count(*) into v_reverse_mismatch
    from public.goal_earmark_lines orig
    where orig.event_id = v_original.id
      and not exists(
        select 1 from public.goal_earmark_lines rev
        where rev.event_id = p_event_id and rev.goal_id = orig.goal_id and rev.amount_minor = -orig.amount_minor
      );
    if v_reverse_mismatch <> 0 then
      raise exception using errcode='23514', message='goal_earmark_reverse_shape_invalid';
    end if;
  end if;

  -- Same definitions as the reserve command (audit C1): earmark net of linked
  -- purchases plus what those purchases fulfilled must stay within the target,
  -- and the net earmark may never go below zero. Evaluated as of the later of
  -- Space-local "today" and this event's own effective_date (v_as_of above), not
  -- Space-local "today" alone: every RPC-written event posts at today, so v_as_of
  -- equals today for all of them and this is a no-op change for the command
  -- path, but an owner-level insert backdating effective_date into the future
  -- can no longer hide its own contribution from this check by outrunning
  -- "today". UTC "today" matches the command until the Spec 1 space clock
  -- replaces both together.
  select count(*) into v_bad_balance
  from (
    select el.goal_id, sum(el.amount_minor) as event_contribution,
      state.earmarked_minor, state.fulfilled_minor,
      (select target_minor from public.goal_revisions where goal_id = el.goal_id order by id desc limit 1) as target
    from public.goal_earmark_lines el
    cross join lateral private.goal_financing_state(el.goal_id, v_as_of) state
    where el.event_id = p_event_id
    group by el.goal_id, state.earmarked_minor, state.fulfilled_minor
  ) totals
  where earmarked_minor < 0
    or (v_event.operation <> 'reverse' and event_contribution > 0 and earmarked_minor + fulfilled_minor > target);
  if v_bad_balance <> 0 then
    raise exception using errcode='23514', message='goal_earmark_balance_invalid';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := (private.space_period_context(p_space_id,p_month)->>'asOf')::date;
  v_goal public.goals%rowtype;
  v_row record;
  v_extras record;
  v_milestones jsonb;
  v_summary jsonb;
begin
  if p_space_id is null or p_goal_id is null or p_month is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;

  select * into v_row from private.goal_coverage_set(p_space_id, v_goal.currency, v_as_of) coverage
    where coverage.goal_id = p_goal_id;
  if not found then
    raise exception using errcode='P0001', message='the goal is not currently relevant';
  end if;

  select * into v_extras from private.goal_monthly_extras(
    v_row.goal_id, v_row.kind, v_row.target_minor, v_row.deadline, v_row.covered_minor, v_row.fulfilled_minor, p_month
  );

  v_milestones := (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', grm.milestone_id::text, 'kind', grm.kind, 'labelEn', grm.label_en, 'labelAr', grm.label_ar,
      'thresholdMinor', grm.threshold_minor::text, 'dueDate', grm.due_date, 'ordinal', grm.ordinal,
      'currentState', case
        when grm.kind = 'amount' then
          case when (v_row.covered_minor + case when v_row.kind = 'purchase' then v_row.fulfilled_minor else 0 end) >= grm.threshold_minor
            then 'complete' else 'incomplete' end
        else case when (
          select event.action from public.goal_milestone_events event
          where event.milestone_id = grm.milestone_id order by event.id desc limit 1
        ) = 'complete' then 'complete' else 'incomplete' end
      end
    ) order by grm.ordinal), '[]'::jsonb)
    from public.goal_revision_milestones grm where grm.revision_id = v_row.revision_id
  );

  v_summary := jsonb_build_object(
    'id', v_row.goal_id::text, 'revisionId', v_row.revision_id::text, 'currency', v_goal.currency,
    'kind', v_row.kind, 'state', v_row.state, 'nameEn', v_row.name_en, 'nameAr', v_row.name_ar,
    'targetMinor', v_row.target_minor::text, 'earmarkedMinor', v_row.earmarked_minor::text,
    'coveredMinor', v_row.covered_minor::text, 'fulfilledMinor', v_row.fulfilled_minor::text,
    'shortageMinor', (v_row.earmarked_minor - v_row.covered_minor)::text,
    'monthlyTargetMinor', v_extras.monthly_target_minor::text,
    'monthlyNetContributionMinor', v_extras.monthly_net_contribution_minor::text,
    'dueDate', v_row.deadline,
    'horizon', case when v_row.deadline is null then 'open'
      when v_row.deadline <= (v_row.created_at::date + interval '12 months')::date then 'short' else 'long' end,
    'needsReview', v_row.state = 'closed' and v_row.earmarked_minor <> 0,
    'suggestedMonthlyMinor', v_extras.suggested_monthly_minor::text,
    'forecastMonth', v_extras.forecast_month, 'forecastState', v_extras.forecast_state, 'asOf', v_as_of
  );

  return jsonb_build_object(
    'summary', v_summary, 'milestones', v_milestones,
    'earmarkHead', v_row.head, 'definitionHead', v_row.revision_id::text, 'asOf', v_as_of
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := private.space_today(p_space_id);
  v_this_month date := private.space_period_key_at_date(p_space_id,v_as_of);
  v_rows jsonb;
  v_has_more boolean;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if p_space_id is null or p_currency is null or p_state_filter is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_state_filter not in ('active','paused','closed','all','needs_review') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if (p_after_created_at is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with coverage as (
    select * from private.goal_coverage_set(p_space_id, p_currency, v_as_of)
  ), filtered as (
    select * from coverage
    where (p_state_filter = 'all')
      or (p_state_filter = 'needs_review' and state = 'closed')
      or (p_state_filter <> 'all' and p_state_filter <> 'needs_review' and state = p_state_filter)
  ), page as (
    select * from filtered
    where p_after_created_at is null
      or (created_at, goal_id) > (p_after_created_at, p_after_id)
    order by created_at, goal_id
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by created_at, goal_id) as rn from page
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', numbered.goal_id::text, 'revisionId', numbered.revision_id::text, 'currency', p_currency,
      'kind', numbered.kind, 'state', numbered.state, 'nameEn', numbered.name_en, 'nameAr', numbered.name_ar,
      'targetMinor', numbered.target_minor::text, 'earmarkedMinor', numbered.earmarked_minor::text,
      'coveredMinor', numbered.covered_minor::text, 'fulfilledMinor', numbered.fulfilled_minor::text,
      'shortageMinor', (numbered.earmarked_minor - numbered.covered_minor)::text,
      'monthlyTargetMinor', extras.monthly_target_minor::text,
      'monthlyNetContributionMinor', extras.monthly_net_contribution_minor::text,
      'dueDate', numbered.deadline,
      'horizon', case when numbered.deadline is null then 'open'
        when numbered.deadline <= (numbered.created_at::date + interval '12 months')::date then 'short' else 'long' end,
      'needsReview', numbered.state = 'closed' and numbered.earmarked_minor <> 0,
      'suggestedMonthlyMinor', extras.suggested_monthly_minor::text,
      'forecastMonth', extras.forecast_month, 'forecastState', extras.forecast_state, 'asOf', v_as_of
    ) order by numbered.created_at, numbered.goal_id), '[]'::jsonb)
     from numbered
     cross join lateral private.goal_monthly_extras(
       numbered.goal_id, numbered.kind, numbered.target_minor, numbered.deadline,
       numbered.covered_minor, numbered.fulfilled_minor, v_this_month
     ) extras
     where numbered.rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select created_at from numbered where rn = p_limit),
    (select goal_id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_created_at, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('createdAt', v_next_created_at, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;

CREATE OR REPLACE FUNCTION private.goal_monthly_extras(p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date, p_covered_minor numeric, p_fulfilled_minor numeric, p_month date) RETURNS TABLE(monthly_target_minor bigint, monthly_net_contribution_minor numeric, suggested_monthly_minor bigint, forecast_month date, forecast_state text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_space uuid := (select space_id from public.goals where id=p_goal_id);
  v_context jsonb := private.space_period_context(v_space,p_month);
  v_today date := (v_context->>'asOf')::date;
  v_this_month date := p_month;
  v_monthly_target bigint;
  v_net_contribution numeric;
  v_progress numeric;
  v_remaining numeric;
  v_months integer;
  v_suggested bigint;
  v_goal_created date;
  v_history_start date;
  v_mean numeric;
  v_periods numeric;
  v_forecast_month date;
  v_forecast_state text;
begin
  select amount_minor into v_monthly_target from public.goal_monthly_target_revisions
    where goal_id = p_goal_id and month_start = p_month order by id desc limit 1;

  select coalesce(sum(el.amount_minor), 0) into v_net_contribution
  from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
  where el.goal_id = p_goal_id and ge.effective_date >= (v_context->>'start')::date and ge.effective_date <= v_today;

  v_progress := p_covered_minor + case when p_kind = 'purchase' then p_fulfilled_minor else 0 end;
  v_remaining := greatest(p_target_minor - v_progress, 0);

  if p_deadline is null then
    v_suggested := null;
  else
    v_months := 12 * (extract(year from private.space_period_key_at_date(v_space,p_deadline))::integer - extract(year from v_this_month)::integer)
      + (extract(month from private.space_period_key_at_date(v_space,p_deadline))::integer - extract(month from v_this_month)::integer) + 1;
    if v_months <= 0 then
      v_suggested := case when v_remaining > 0 then null else 0 end;
    else
      v_suggested := ceil(v_remaining / v_months::numeric)::bigint;
    end if;
  end if;

  select private.space_date(v_space,g.created_at) into v_goal_created from public.goals g where g.id = p_goal_id;
  v_history_start := (v_this_month - interval '3 months')::date;
  if v_goal_created > (private.space_period_context(v_space,v_history_start)->>'start')::date then
    v_forecast_month := null;
    v_forecast_state := 'insufficient_history';
  else
    select avg(month_sum) into v_mean
    from (
      select coalesce((
        select sum(el.amount_minor) from public.goal_earmark_lines el
        join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = p_goal_id and ge.effective_date >= (private.space_period_context(v_space,months.month_start)->>'start')::date and ge.effective_date <= (private.space_period_context(v_space,months.month_start)->>'asOf')::date
      ), 0) as month_sum
      from (
        select (v_history_start + (n * interval '1 month'))::date as month_start
        from generate_series(0, 2) as n
      ) months
    ) samples;
    if v_mean is null or v_mean <= 0 then
      v_forecast_month := null;
      v_forecast_state := 'no_positive_pace';
    else
      v_periods := ceil(v_remaining / v_mean);
      if v_periods > 120 then
        v_forecast_month := null;
        v_forecast_state := 'beyond_horizon';
      else
        v_forecast_month := (v_this_month + (v_periods::integer * interval '1 month'))::date;
        v_forecast_state := 'estimate';
      end if;
    end if;
  end if;

  return query select v_monthly_target, v_net_contribution, v_suggested, v_forecast_month, v_forecast_state;
end;
$$;

CREATE OR REPLACE FUNCTION public.report_category_actual_vs_budget(p_space_id uuid, p_month date) RETURNS TABLE(category_key text, category_name_en text, category_name_ar text, category_kind public.category_kind, currency public.currency_code, actual_net_minor bigint, budget_minor bigint, remaining_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_start date;
  v_end date;
begin
  if p_space_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then raise exception using errcode='42501', message='an active space membership and normalized month are required'; end if;
  select bounds.period_start, bounds.period_end into v_start, v_end
  from public.space_period_bounds(p_space_id, p_month) bounds;
  v_end:=least(v_end,(private.space_period_context(p_space_id,p_month)->>'asOf')::date+1);
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

CREATE OR REPLACE FUNCTION public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date) RETURNS TABLE(period_month date, period_role text, currency public.currency_code, income_net_minor bigint, expense_net_minor bigint, wallet_delta_net_minor bigint)
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_current_start date;
  v_current_end date;
  v_previous_start date;
  v_previous_end date;
begin
  if p_space_id is null or p_anchor_month is null or p_anchor_month <> date_trunc('month', p_anchor_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership and normalized month are required';
  end if;
  select bounds.period_start, bounds.period_end into v_current_start, v_current_end
  from public.space_period_bounds(p_space_id, p_anchor_month) bounds;
  select bounds.period_start,bounds.period_end into v_previous_start,v_previous_end
  from public.space_period_bounds(p_space_id, (date_trunc('month', p_anchor_month) - interval '1 month')::date) bounds;
  v_previous_end:=least(v_previous_end,(public.space_period_context(p_space_id,(p_anchor_month-interval '1 month')::date)->>'asOf')::date+1);
  v_current_end:=least(v_current_end,(public.space_period_context(p_space_id,p_anchor_month)->>'asOf')::date+1);
  return query
  with periods as (
    select v_previous_start as period_start, v_previous_end as period_end, 'previous'::text as role
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

CREATE OR REPLACE FUNCTION private.check_budget_month_close(p_close_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_close public.budget_month_closes%rowtype;
  v_root_count integer;
  v_snapshot_root_count integer;
  v_problems integer;
  v_head bigint;
  v_context jsonb;
begin
  select * into v_close from public.budget_month_closes where id = p_close_id for update;
  if not found then
    raise exception using errcode='23514', message='budget_month_close_header_missing';
  end if;

  v_context:=private.space_period_context(v_close.space_id,v_close.month_start);
  if (v_close.created_at at time zone (v_context->>'timezone'))::date < (v_context->>'endExclusive')::date then
    raise exception using errcode='23514',message='budget_month_close_period_not_ended';
  end if;
  select count(*) into v_root_count from public.budget_month_close_roots where close_id = p_close_id;
  select root_count into v_snapshot_root_count from public.allocation_month_snapshots where id = v_close.source_snapshot_id;
  if v_root_count is distinct from v_close.root_count or v_close.root_count is distinct from v_snapshot_root_count then
    raise exception using errcode='23514', message='budget_month_close_root_count_mismatch';
  end if;

  -- Each root observed the policy head and the snapshot's own accepted carry.
  select count(*) into v_problems
  from public.budget_month_close_roots close_root
  left join lateral (
    select policy.id from public.rollover_policy_revisions policy
    where policy.space_id = close_root.space_id and policy.currency = close_root.currency
      and policy.root_id = close_root.root_id
    order by policy.id desc limit 1
  ) policy_head on true
  left join public.budget_month_carry_links link
    on link.target_snapshot_id = close_root.source_snapshot_id and link.root_id = close_root.root_id
  where close_root.close_id = p_close_id
    and (policy_head.id is distinct from close_root.policy_revision_id
      or coalesce(link.carry_minor, 0) <> close_root.incoming_carry_minor);
  if v_problems <> 0 then
    raise exception using errcode='23514', message='budget_month_close_root_inputs_invalid';
  end if;

  select max(id) into v_head from public.budget_month_closes
    where space_id = v_close.space_id and currency = v_close.currency
      and month_start = v_close.month_start and id < v_close.id;
  if v_head is distinct from v_close.expected_close_id then
    raise exception using errcode='23514', message='budget_month_close_predecessor_not_head';
  end if;
end;
$$;
