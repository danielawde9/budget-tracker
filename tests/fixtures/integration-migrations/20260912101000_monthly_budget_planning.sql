create table public.monthly_budget_plan_revisions (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint bytea not null,
  plan_kind text not null check (plan_kind in ('income', 'expense_category')),
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  currency public.currency_code not null,
  category_id uuid,
  category_kind public.category_kind,
  amount_minor bigint not null check (amount_minor between 0 and 999999999999999),
  expected_revision_id bigint,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint monthly_budget_plan_revisions_shape_check check (
    (plan_kind = 'income' and category_id is null and category_kind is null)
    or (plan_kind = 'expense_category' and category_id is not null and category_kind = 'expense')
  ),
  foreign key (category_id, space_id, category_kind)
    references public.categories (id, space_id, kind) on delete restrict,
  unique (space_id, request_id)
);

create index monthly_budget_plan_revisions_current_idx
  on public.monthly_budget_plan_revisions (space_id, month_start, currency, plan_kind, category_id, id desc);
create index monthly_budget_plan_revisions_history_idx
  on public.monthly_budget_plan_revisions (space_id, id desc);
create index monthly_budget_plan_revisions_category_idx
  on public.monthly_budget_plan_revisions (category_id, space_id, category_kind)
  where category_id is not null;

alter table public.monthly_budget_plan_revisions enable row level security;

create function private.reject_monthly_budget_plan_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501', message = 'monthly budget plan history is immutable';
end;
$$;

create trigger monthly_budget_plan_revisions_reject_row_mutation
before update or delete on public.monthly_budget_plan_revisions
for each row execute function private.reject_monthly_budget_plan_mutation();
create trigger monthly_budget_plan_revisions_reject_truncate
before truncate on public.monthly_budget_plan_revisions
for each statement execute function private.reject_monthly_budget_plan_mutation();

create function private.set_monthly_budget_plan(
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
    select category.archived_at into v_category_archived_at from public.categories as category
    where category.id = p_category_id and category.space_id = p_space_id and category.kind = 'expense';
    if not found then raise exception using errcode = 'P0001', message = 'the requested expense category was not found'; end if;
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

create function public.set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint default null)
returns table (id bigint, month_start date)
language sql security definer set search_path = pg_catalog, extensions
as $$ select * from private.set_monthly_budget_plan(p_space_id, p_request_id, null, p_month, p_currency, p_amount_minor, p_expected_revision_id, 'income') $$;

create function public.set_monthly_category_target(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint default null)
returns table (id bigint, month_start date)
language sql security definer set search_path = pg_catalog, extensions
as $$ select * from private.set_monthly_budget_plan(p_space_id, p_request_id, p_category_id, p_month, p_currency, p_amount_minor, p_expected_revision_id, 'expense_category') $$;

create function public.monthly_budget_currency_summary(p_space_id uuid, p_month date)
returns table (
  currency public.currency_code, planned_income_minor bigint, actual_income_minor bigint,
  category_target_total_minor bigint, category_actual_spent_minor bigint, uncategorized_spent_minor bigint,
  category_overspent_minor bigint, actual_loan_repayment_minor bigint, remaining_loan_reservation_minor bigint,
  loan_commitment_minor bigint, unallocated_minor bigint, overallocated_minor bigint, income_plan_revision_id bigint
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_month_start date := date_trunc('month', p_month)::date;
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
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), income_actual as (
    select wallet.currency, sum(movement.amount_minor)::bigint as received_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
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

create function public.monthly_budget_category_page(
  p_space_id uuid,
  p_month date,
  p_after_created_at timestamptz default null,
  p_after_category_id uuid default null,
  p_after_currency public.currency_code default null,
  p_limit integer default 50
)
returns table (
  category_id uuid, name_en text, name_ar text, archived_at timestamptz,
  currency public.currency_code, target_minor bigint, actual_spent_minor bigint,
  remaining_minor bigint, overspent_minor bigint, target_revision_id bigint
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
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
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
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

revoke all on table public.monthly_budget_plan_revisions from public, anon, authenticated, service_role;
revoke all on function private.reject_monthly_budget_plan_mutation() from public;
revoke all on function private.set_monthly_budget_plan(uuid, uuid, uuid, date, public.currency_code, text, bigint, text) from public;
revoke all on function public.set_monthly_income_plan(uuid, uuid, date, public.currency_code, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.set_monthly_category_target(uuid, uuid, uuid, date, public.currency_code, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.monthly_budget_currency_summary(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.monthly_budget_category_page(uuid, date, timestamptz, uuid, public.currency_code, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_monthly_income_plan(uuid, uuid, date, public.currency_code, text, bigint) to authenticated;
grant execute on function public.set_monthly_category_target(uuid, uuid, uuid, date, public.currency_code, text, bigint) to authenticated;
grant execute on function public.monthly_budget_currency_summary(uuid, date) to authenticated;
grant execute on function public.monthly_budget_category_page(uuid, date, timestamptz, uuid, public.currency_code, integer) to authenticated;
