-- Budget v2: suggestions for the expense form.
-- Read only. Each past description appears once, with the item, wallet and
-- amount it was last recorded with, so a repeat expense takes one pick.

-- Bounded twice: only the last 366 days of expenses are read, and at most
-- p_limit (1 to 100) descriptions come back. Reversed expenses and bill
-- payments are left out: a reversed one was a mistake, and bills are paid
-- from the bill itself.
create function public.expense_suggestions(p_space uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_since date;
begin
  perform budget.require_member(p_space);
  v_since := budget.space_today(p_space) - 366;
  return jsonb_build_object(
    'lastWalletId', (
      select wl.wallet_id
      from budget.entries e
      join budget.wallet_lines wl on wl.entry_id = e.id and wl.flow = 'spend'
      where e.space_id = p_space and e.kind = 'expense' and e.occurred_on >= v_since
        and not exists (select 1 from budget.entries r where r.reverses_entry_id = e.id)
      order by e.occurred_on desc, e.created_at desc, e.id desc
      limit 1),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memo', latest.memo, 'itemId', latest.item_id, 'walletId', latest.wallet_id,
        'amount', latest.amount::text, 'currency', latest.currency, 'lastOn', latest.occurred_on
      ) order by latest.occurred_on desc, latest.created_at desc, latest.id desc)
      from (
        select *
        from (
          select distinct on (lower(btrim(e.memo)))
            btrim(e.memo) as memo, il.item_id, wl.wallet_id, -wl.amount_minor as amount, wl.currency,
            e.occurred_on, e.created_at, e.id
          from budget.entries e
          join budget.item_lines il on il.entry_id = e.id and il.flow = 'spend'
          join budget.wallet_lines wl on wl.entry_id = e.id and wl.flow = 'spend'
          where e.space_id = p_space and e.kind = 'expense' and e.occurred_on >= v_since
            and e.bill_id is null and btrim(coalesce(e.memo, '')) <> ''
            and not exists (select 1 from budget.entries r where r.reverses_entry_id = e.id)
          order by lower(btrim(e.memo)), e.occurred_on desc, e.created_at desc, e.id desc
        ) per_memo
        order by occurred_on desc, created_at desc, id desc
        limit v_limit
      ) latest), '[]'::jsonb));
end;
$$;

revoke all on function public.expense_suggestions(uuid, integer) from public, anon, service_role;
grant execute on function public.expense_suggestions(uuid, integer) to authenticated;
