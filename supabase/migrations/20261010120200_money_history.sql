-- Home trends use recorded cash flows and cumulative savings, in each currency.
create function public.money_history(p_space uuid)
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
           sum(l.amount_minor) as income, 0::numeric as spent, 0::numeric as saved
      from budget.wallet_lines l
      join budget.entries e on e.id = l.entry_id
      join budget.wallets w on w.id = l.wallet_id
     where e.space_id = p_space and e.occurred_on between v_start and v_today
       and w.kind = 'cash' and l.flow in ('income', 'other_income')
     group by 1, 2
    union all
    select budget.month_start(e.occurred_on), l.currency, 0::numeric,
           coalesce(-sum(l.amount_minor) filter (where i.kind <> 'ready' and l.flow in ('spend', 'refund', 'interest', 'fee')), 0),
           coalesce(sum(l.amount_minor) filter (where i.kind = 'goal' or (i.kind not in ('ready', 'reserve', 'loan_payment') and g.purpose = 'saving')), 0)
      from budget.item_lines l
      join budget.entries e on e.id = l.entry_id
      join budget.items i on i.id = l.item_id
      left join budget.plan_groups g on g.id = i.group_id
     where e.space_id = p_space and e.occurred_on <= v_today
     -- Archived items still contribute their real historical balances.
     group by 1, 2
  ), totals as (
    select month, currency, sum(income) as income, sum(spent) as spent, sum(saved) as saved
      from movements group by month, currency
  ), periods as (
    select d::date as month, least(v_today, (d + interval '1 month - 1 day')::date) as through
      from generate_series(v_start::timestamp, v_month::timestamp, interval '1 month') d
  ), rows as (
    select p.month, p.through, c.currency,
           coalesce(t.income, 0) as income, coalesce(t.spent, 0) as spent,
           coalesce((select sum(old.saved) from totals old where old.currency = c.currency and old.month < v_start), 0)
             + sum(coalesce(t.saved, 0)) over (partition by c.currency order by p.month) as savings
      from periods p cross join (values ('USD'::budget.currency), ('LBP'::budget.currency)) c(currency)
      left join totals t on t.month = p.month and t.currency = c.currency
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
