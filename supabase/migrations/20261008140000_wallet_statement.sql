-- Display-only statement comparison. Reversals deliberately retain the original
-- occurred_on, so they cancel their original lines on the same historical day.
create function public.wallet_balance_on(p_space uuid, p_wallet uuid, p_on date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wallet budget.wallets%rowtype;
  v_balance numeric;
begin
  perform budget.require_member(p_space);
  if p_on is null or not isfinite(p_on) or p_on < date '2000-01-01' then
    perform budget.raise_budget('BUDGET_INVALID_DATE', jsonb_build_object('date', p_on));
  end if;
  if p_on > budget.space_today(p_space) then
    perform budget.raise_budget('BUDGET_FUTURE_DATE', jsonb_build_object('date', p_on));
  end if;
  select * into v_wallet from budget.wallets where id = p_wallet and space_id = p_space;
  if not found then
    perform budget.raise_budget('BUDGET_WALLET_NOT_FOUND', jsonb_build_object('walletId', p_wallet));
  end if;
  if v_wallet.kind <> 'cash' then
    perform budget.raise_budget('BUDGET_WALLET_KIND', jsonb_build_object('walletId', p_wallet, 'expected', 'cash'));
  end if;
  select coalesce(sum(l.amount_minor), 0) into v_balance
    from budget.wallet_lines l join budget.entries e on e.id = l.entry_id
    where l.wallet_id = p_wallet and e.space_id = p_space and e.occurred_on <= p_on;
  return jsonb_build_object('walletId', p_wallet, 'currency', v_wallet.currency, 'on', p_on, 'balance', v_balance::text);
end;
$$;
revoke all on function public.wallet_balance_on(uuid, uuid, date) from public, anon, service_role;
grant execute on function public.wallet_balance_on(uuid, uuid, date) to authenticated;
