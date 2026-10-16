-- Only groups with a monthly target can receive credit toward this month's plan.
-- Existing balances and opening lines never become monthly funding.
create function budget.monthly_funding_credits(p_space uuid, p_month date, p_currency budget.currency)
returns table(assigned bigint, covered bigint, excluded_assigned bigint, excluded_covered bigint)
language sql stable set search_path = '' as $$
  with eligible_groups as (
    select distinct l.group_id from budget.plan_lines(p_space, p_month) l where l.group_amount > 0
  ), assigned_rows as (
    select l.amount_minor as amount,
      exists(select 1 from eligible_groups g where g.group_id = budget.item_group_on(l.item_id, e.occurred_on)) as included
    from budget.item_lines l join budget.entries e on e.id = l.entry_id join budget.items i on i.id = l.item_id
    where l.space_id = p_space and i.kind <> 'ready' and l.currency = p_currency and l.flow in ('fund','release')
      and e.occurred_on >= budget.month_start(p_month) and e.occurred_on < (budget.month_start(p_month) + interval '1 month')::date
  ), covered_rows as (
    select -l.amount_minor as amount,
      exists(select 1 from budget.item_lines charge
        join eligible_groups g on g.group_id = budget.item_group_on(charge.item_id, e.occurred_on)
        where charge.entry_id = e.id and charge.item_id <> l.item_id and charge.currency = p_currency
          and charge.flow in ('spend','refund','invest','principal','lend','interest','fee')) as included
    from budget.item_lines l join budget.entries e on e.id = l.entry_id
    where l.space_id = p_space and l.item_id = budget.ready_item(p_space) and l.currency = p_currency and l.flow = 'cover'
      and e.occurred_on >= budget.month_start(p_month) and e.occurred_on < (budget.month_start(p_month) + interval '1 month')::date
  ), assignments as (
    select coalesce(sum(amount) filter(where included),0)::bigint as amount,
      coalesce(sum(amount) filter(where not included),0)::bigint as excluded from assigned_rows
  ), coverage as (
    select greatest(coalesce(sum(amount) filter(where included),0),0)::bigint as amount,
      greatest(coalesce(sum(amount) filter(where not included),0),0)::bigint as excluded from covered_rows
  ) select a.amount,c.amount,a.excluded,c.excluded from assignments a cross join coverage c;
$$;
revoke all on function budget.monthly_funding_credits(uuid,date,budget.currency) from public,anon,authenticated,service_role;

create or replace function budget.consumed_ready_for_plan(p_space uuid, p_month date, p_currency budget.currency)
returns bigint language sql stable set search_path = '' as $$
  select covered from budget.monthly_funding_credits(p_space,p_month,p_currency)
$$;
revoke all on function budget.consumed_ready_for_plan(uuid,date,budget.currency) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION budget.plan_totals(p_space uuid, p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_month date := budget.month_start(p_month);
  v_currency budget.currency;
  v_version budget.plan_versions%rowtype;
  v_ready uuid := budget.ready_item(p_space);
  v_groups_total bigint;
  v_over bigint;
  v_still bigint;
  v_category_shortfall bigint;
  v_received bigint;
  v_other_income bigint;
  v_funded bigint;
  v_spent_from_ready bigint;
  v_assigned_excluded bigint;
  v_covered_excluded bigint;
begin
  select plan_currency into v_currency from budget.spaces where id = p_space;
  select * into v_version from budget.plan_versions where id = budget.plan_version_for(p_space, v_month);

  select coalesce(sum(distinct_groups.group_amount), 0) into v_groups_total
  from (select distinct l.group_id, l.group_amount from budget.plan_lines(p_space, v_month) l) distinct_groups;

  select coalesce(sum(greatest(items_total - group_amount, 0)), 0) into v_over
  from (
    select l.group_id, l.group_amount, sum(l.planned_minor) filter (where l.item_kind <> 'flex') as items_total
    from budget.plan_lines(p_space, v_month) l
    group by l.group_id, l.group_amount
  ) per_group;

  select coalesce(sum(greatest(l.planned_minor - budget.funded_net(l.item_id, v_currency, v_month), 0)), 0) into v_still
  from budget.plan_lines(p_space, v_month) l
  join budget.items i on i.id = l.item_id
  where i.archived_at is null;

  v_received := budget.month_flow_total(v_ready, v_currency, v_month, array['income']::budget.flow[]);
  v_other_income := budget.month_flow_total(v_ready, v_currency, v_month, array['other_income']::budget.flow[]);
  select assigned,covered,excluded_assigned,excluded_covered
  into v_funded,v_spent_from_ready,v_assigned_excluded,v_covered_excluded
  from budget.monthly_funding_credits(p_space,v_month,v_currency);
  v_category_shortfall := v_still;
  v_still := greatest(v_groups_total - v_funded - v_spent_from_ready, 0);

  return jsonb_build_object(
    'month', v_month,
    'planCurrency', v_currency,
    'versionId', v_version.id,
    'revision', v_version.revision,
    'effectiveMonth', v_version.effective_month,
    'expectedIncome', coalesce(v_version.expected_income_minor, 0)::text,
    'groupsTotal', v_groups_total::text,
    'notPlanned', (coalesce(v_version.expected_income_minor, 0) - v_groups_total)::text,
    'overPlanned', v_over::text,
    'received', v_received::text,
    'otherIncome', v_other_income::text,
    'funded', (v_funded + v_spent_from_ready)::text,
    'fundingScope', 'planned_groups',
    'assignedFunding', v_funded::text,
    'assignedFundingExcluded', v_assigned_excluded::text,
    'spentFromReadyExcluded', v_covered_excluded::text,
    'spentFromReady', v_spent_from_ready::text,
    'stillToFund', v_still::text,
    'categoryShortfall', v_category_shortfall::text,
    'ready', budget.item_balance(v_ready, v_currency)::text,
    'readyAtMonthEnd', budget.item_balance_on(v_ready, v_currency, (v_month + interval '1 month' - interval '1 day')::date)::text);
end;
$function$
;
revoke all on function budget.plan_totals(uuid,date) from public,anon,authenticated,service_role;

-- Keep the preview capped by the same monthly funding gap as the summary.
CREATE OR REPLACE FUNCTION public.funding_preview(p_space uuid, p_month date, p_currency text DEFAULT NULL::text, p_amount bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan_currency budget.currency;
  v_currency budget.currency;
  v_available bigint;
  v_monthly_remaining bigint;
  v_left bigint;
  v_need bigint;
  v_give bigint;
  v_unfunded bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
begin
  perform budget.require_member(p_space);
  if p_month is null or (p_currency is not null and p_currency not in ('USD', 'LBP')) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN');
  end if;
  select plan_currency into v_plan_currency from budget.spaces where id = p_space;
  v_currency := coalesce(p_currency, v_plan_currency::text)::budget.currency;
  if p_amount is not null then
    perform budget.require_amount(p_amount, true);
  end if;
  v_available := coalesce(p_amount, greatest(budget.item_balance(budget.ready_item(p_space), v_currency), 0));
  v_left := v_available;
  if v_currency = v_plan_currency then
    v_monthly_remaining := (budget.plan_totals(p_space, p_month) ->> 'stillToFund')::bigint;
    v_left := least(v_left, v_monthly_remaining);
    for v_line in
      select l.item_id, l.planned_minor
      from budget.plan_lines(p_space, p_month) l
      join budget.items i on i.id = l.item_id
      where i.archived_at is null and l.group_amount > 0
      order by l.group_position, l.item_order
    loop
      v_need := greatest(v_line.planned_minor - budget.funded_net(v_line.item_id, v_currency, p_month), 0);
      continue when v_need = 0;
      v_give := least(v_need, v_left);
      if v_give > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('itemId', v_line.item_id, 'amountMinor', v_give::text));
        v_left := v_left - v_give;
      end if;
      v_unfunded := v_unfunded + (v_need - v_give);
    end loop;
    -- Item targets remain distinct from total monthly progress.
    v_unfunded := greatest(v_monthly_remaining - (least(v_available, v_monthly_remaining) - v_left), 0);
  end if;
  return jsonb_build_object(
    'month', budget.month_start(p_month),
    'currency', v_currency,
    'available', v_available::text,
    'lines', v_lines,
    'unfunded', v_unfunded::text);
end;
$function$
;
revoke all on function public.funding_preview(p_space uuid, p_month date, p_currency text, p_amount bigint) from public,anon,authenticated,service_role;
grant execute on function public.funding_preview(p_space uuid, p_month date, p_currency text, p_amount bigint) to "postgres";
grant execute on function public.funding_preview(p_space uuid, p_month date, p_currency text, p_amount bigint) to "authenticated";
