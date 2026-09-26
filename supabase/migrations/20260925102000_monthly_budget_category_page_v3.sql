-- Plan page rows per parent (root) expense category for one currency:
-- spending recorded on a subcategory counts toward its parent (audit B5),
-- every active parent is listed so it can receive a target, and a keyset
-- cursor pages through all of them (audit B4). v1 and v2 stay for their
-- existing callers.
create function public.monthly_budget_category_page_v3(
  p_space_id uuid,
  p_month date,
  p_currency public.currency_code,
  p_after_created_at text default null,
  p_after_category_id uuid default null,
  p_limit integer default 100
)
returns table (
  category_id uuid, category_created_at text,
  name_en text, name_ar text, archived_at timestamptz,
  target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text,
  target_revision_id text, has_more boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
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
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
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

revoke all on function public.monthly_budget_category_page_v3(uuid, date, public.currency_code, text, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.monthly_budget_category_page_v3(uuid, date, public.currency_code, text, uuid, integer) to authenticated;
