-- Home trends use recorded cash flows and month-end savings balances in each currency.
-- Classification follows each monthly plan, including archived groups and items.
create or replace function public.money_history(p_space uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_month date;
  v_start date;
  v_months jsonb;
begin
  perform budget.require_member(p_space);
  v_today := budget.space_today(p_space);
  v_month := budget.month_start(v_today);
  select greatest(budget.month_start(min(occurred_on)), (v_month - interval '5 months')::date)
    into v_start from budget.entries where space_id = p_space and occurred_on <= v_today;
  if not exists (select 1 from budget.entries where space_id = p_space and occurred_on <= v_today) then
    return jsonb_build_object('today', v_today, 'months', '[]'::jsonb);
  end if;

  with movements as (
    -- Wallet income counts once, even when it is assigned directly to savings.
    select budget.month_start(e.occurred_on) as month, l.currency,
           sum(l.amount_minor) as income, 0::numeric as spent
      from budget.wallet_lines l
      join budget.entries e on e.id = l.entry_id
      join budget.wallets w on w.id = l.wallet_id
     where e.space_id = p_space and e.occurred_on between v_start and v_today
       and w.kind = 'cash' and l.flow in ('income', 'other_income')
     group by 1, 2
    union all
    select budget.month_start(e.occurred_on), l.currency, 0::numeric,
           -sum(l.amount_minor)
      from budget.item_lines l
      join budget.entries e on e.id = l.entry_id
      join budget.items i on i.id = l.item_id
     where e.space_id = p_space and e.occurred_on between v_start and v_today
       and i.kind <> 'ready' and l.flow in ('spend', 'refund', 'interest', 'fee')
     group by 1, 2
  ), totals as (
    select month, currency, sum(income) as income, sum(spent) as spent
      from movements group by month, currency
  ), periods as (
    select d::date as month, least(v_today, (d + interval '1 month - 1 day')::date) as through
      from generate_series(v_start::timestamp, v_month::timestamp, interval '1 month') d
  ), savings as (
    -- Classify the retained balance at that month's end. A later plan can
    -- reclassify/move an item without changing any earlier month's snapshot.
    -- No archive filter: a historical balance remains part of real history.
    select p.month, l.currency, sum(l.amount_minor) as savings
      from periods p
      join budget.entries e on e.space_id = p_space and e.occurred_on <= p.through
      join budget.item_lines l on l.entry_id = e.id
      join budget.items i on i.id = l.item_id
     where i.kind <> 'ready'
       and budget.group_purpose_on(budget.item_group_on(i.id, p.through), p.through) = 'savings'
     group by p.month, l.currency
  ), rows as (
    select p.month, p.through, c.currency,
           coalesce(t.income, 0) as income, coalesce(t.spent, 0) as spent,
           coalesce(s.savings, 0) as savings
      from periods p cross join (values ('USD'::budget.currency), ('LBP'::budget.currency)) c(currency)
      left join totals t on t.month = p.month and t.currency = c.currency
      left join savings s on s.month = p.month and s.currency = c.currency
  ), months as (
    select month, jsonb_build_object('month', month, 'through', through,
             'income', jsonb_object_agg(currency, income::text),
             'spent', jsonb_object_agg(currency, spent::text),
             'savings', jsonb_object_agg(currency, savings::text)) as body
      from rows group by month, through
  )
  select coalesce(jsonb_agg(body order by month), '[]'::jsonb) into v_months from months;
  return jsonb_build_object('today', v_today, 'months', v_months);
end;
$$;

revoke all on function public.money_history(uuid) from public, anon, service_role;
grant execute on function public.money_history(uuid) to authenticated;
