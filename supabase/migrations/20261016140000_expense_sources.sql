-- An explicit payment source is an atomic, reversible journal operation.
-- Existing record_expense keeps its original shortfall-only behavior.
create or replace function public.record_expense_from(
  p_space uuid,
  p_request uuid,
  p_wallet uuid,
  p_item uuid,
  p_amount bigint,
  p_on date,
  p_source uuid,
  p_memo text default null,
  p_bill uuid default null,
  p_bill_due date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('wallet', p_wallet, 'item', p_item, 'amount', p_amount, 'on', p_on,
    'memo', p_memo, 'source', p_source, 'bill', p_bill, 'due', p_bill_due);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_expense_from', v_payload);
  v_wallet budget.wallets%rowtype;
  v_entry uuid;
  v_covered bigint;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  v_wallet := budget.wallet_of_kind(p_space, p_wallet, 'cash');
  perform budget.require_amount(p_amount);
  perform budget.plan_item(p_space, p_item);
  perform budget.plan_item(p_space, p_source);
  if budget.item_min_balance_from(p_source, v_wallet.currency, p_on) < p_amount then
    perform budget.raise_budget('BUDGET_INSUFFICIENT_ITEM', budget.item_label(p_source) || jsonb_build_object(
      'currency', v_wallet.currency, 'available', greatest(budget.item_min_balance_from(p_source, v_wallet.currency, p_on), 0)::text, 'needed', p_amount::text));
  end if;
  if (p_bill is null) <> (p_bill_due is null) then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE');
  end if;
  perform budget.require_bill_payable(p_space, p_bill, p_bill_due, p_item, v_wallet.currency);
  v_entry := budget.new_entry(p_space, p_request, 'expense', p_on, p_memo, p_bill, p_bill_due);
  perform budget.add_wallet_line(v_entry, p_space, p_wallet, -p_amount, 'spend');
  -- Move the full payment, not just a shortfall. The category retains its
  -- original balance and reports the actual expense; the chosen source pays.
  if p_source <> p_item then
    perform budget.add_item_line(v_entry, p_space, p_source, v_wallet.currency, -p_amount, 'cover');
    perform budget.add_item_line(v_entry, p_space, p_item, v_wallet.currency, p_amount, 'cover');
  end if;
  perform budget.add_item_line(v_entry, p_space, p_item, v_wallet.currency, -p_amount, 'spend');
  v_covered := case when p_source <> p_item then p_amount else 0 end;
  return budget.finish_command(p_space, p_request, 'record_expense_from', v_payload,
    jsonb_build_object('entryId', v_entry, 'covered', v_covered::text));
end;
$$;

revoke all on function public.record_expense_from(uuid,uuid,uuid,uuid,bigint,date,uuid,text,uuid,date) from public, anon, service_role;
grant execute on function public.record_expense_from(uuid,uuid,uuid,uuid,bigint,date,uuid,text,uuid,date) to authenticated;
