-- Forward-only behavior changes. Existing money rows and receipts are untouched.
-- Automatic expense cover uses the effective-date group, then Ready for the
-- remainder. Explicit cover sources and non-expense outflows keep their rules.
create or replace function budget.charge_item(
  p_entry uuid, p_space uuid, p_item uuid, p_currency budget.currency, p_amount bigint,
  p_flow budget.flow, p_cover_from uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_item budget.items%rowtype := budget.plan_item(p_space, p_item);
  v_cover uuid := budget.normalize_item(p_space, p_cover_from);
  v_on date := (select occurred_on from budget.entries where id = p_entry);
  v_shortfall bigint := greatest(p_amount - greatest(budget.item_min_balance_from(p_item, p_currency, v_on), 0), 0);
  v_remaining bigint := v_shortfall;
  v_source uuid;
  v_group_amount bigint;
begin
  if v_shortfall > 0 then
    if p_cover_from is null and p_flow = 'spend' then
      select i.id into v_source
      from budget.items i
      where i.space_id = p_space
        and i.group_id = budget.item_group_on(v_item.id, v_on)
        and i.kind = 'flex' and i.archived_at is null and i.id <> v_item.id;
      if v_source is not null then
        v_group_amount := least(v_remaining, greatest(budget.item_min_balance_from(v_source, p_currency, v_on), 0));
        if v_group_amount > 0 then
          perform budget.add_item_line(p_entry, p_space, v_source, p_currency, -v_group_amount, 'cover');
          perform budget.add_item_line(p_entry, p_space, v_item.id, p_currency, v_group_amount, 'cover');
          v_remaining := v_remaining - v_group_amount;
        end if;
      end if;
    end if;
    if v_remaining > 0 then
      if v_cover is null then
        v_source := budget.ready_item(p_space);
      else
        if v_cover = v_item.id then
          perform budget.raise_budget('BUDGET_COVER_INVALID', budget.item_label(v_cover));
        end if;
        perform budget.plan_item(p_space, v_cover);
        if budget.item_min_balance_from(v_cover, p_currency, v_on) < v_remaining then
          perform budget.raise_budget('BUDGET_INSUFFICIENT_ITEM', budget.item_label(v_cover) || jsonb_build_object(
            'currency', p_currency, 'available', greatest(budget.item_min_balance_from(v_cover, p_currency, v_on), 0)::text,
            'needed', v_remaining::text));
        end if;
        v_source := v_cover;
      end if;
      perform budget.add_item_line(p_entry, p_space, v_source, p_currency, -v_remaining, 'cover');
      perform budget.add_item_line(p_entry, p_space, v_item.id, p_currency, v_remaining, 'cover');
    end if;
  end if;
  perform budget.add_item_line(p_entry, p_space, v_item.id, p_currency, -p_amount, p_flow);
  return v_shortfall;
end;
$$;

create or replace function public.assign_money(
  p_space uuid,
  p_request uuid,
  p_on date,
  p_moves jsonb,
  p_opening boolean default false,
  p_memo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('on', p_on, 'moves', p_moves, 'opening', p_opening, 'memo', p_memo);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'assign_money', v_payload);
  v_opening boolean := coalesce(p_opening, false);
  v_ready uuid := budget.ready_item(p_space);
  v_move jsonb;
  v_from uuid;
  v_to uuid;
  v_currency budget.currency;
  v_amount bigint;
  v_balance bigint;
  v_flow budget.flow;
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) not between 1 and 60 then
    perform budget.raise_budget('BUDGET_INVALID_MOVES');
  end if;
  v_entry := budget.new_entry(p_space, p_request,
    case when v_opening then 'opening_assign' else 'assign' end::budget.entry_kind, p_on, p_memo);

  for v_move in select value from jsonb_array_elements(p_moves) loop
    v_from := budget.normalize_item(p_space, nullif(v_move ->> 'from', '')::uuid);
    v_to := budget.normalize_item(p_space, nullif(v_move ->> 'to', '')::uuid);
    if coalesce(v_move ->> 'currency', '') not in ('USD', 'LBP') or (v_from is null and v_to is null) or v_from = v_to
       or (v_opening and v_from is not null) then
      perform budget.raise_budget('BUDGET_INVALID_MOVES', v_move);
    end if;
    v_currency := (v_move ->> 'currency')::budget.currency;
    v_amount := (v_move ->> 'amountMinor')::bigint;
    perform budget.require_amount(v_amount);
    if v_from is not null then
      perform budget.plan_item(p_space, v_from);
      if budget.item_min_balance_from(v_from, v_currency, p_on) < v_amount then
        perform budget.raise_budget('BUDGET_INSUFFICIENT_ITEM', budget.item_label(v_from) || jsonb_build_object(
          'currency', v_currency, 'available', greatest(budget.item_min_balance_from(v_from, v_currency, p_on), 0)::text, 'needed', v_amount::text));
      end if;
    end if;
    if v_to is not null then
      perform budget.plan_item(p_space, v_to);
      -- The browser shows the current total. Check it under begin_command's
      -- space lock, after receipt replay, before applying this opening delta.
      if v_opening and v_move ? 'expectedBalanceMinor' then
        v_balance := budget.item_balance(v_to, v_currency);
        if (v_move ->> 'expectedBalanceMinor')::bigint is distinct from v_balance then
          perform budget.raise_budget('BUDGET_BALANCE_CHANGED', jsonb_build_object(
            'itemId', v_to, 'currency', v_currency,
            'expectedBalanceMinor', v_move ->> 'expectedBalanceMinor',
            'actualBalanceMinor', v_balance::text));
        end if;
      end if;
    end if;
    v_flow := case
      when v_opening then 'opening'
      when v_from is null then 'fund'
      when v_to is null then 'release'
      else 'move' end::budget.flow;
    perform budget.add_item_line(v_entry, p_space, coalesce(v_from, v_ready), v_currency, -v_amount, v_flow);
    perform budget.add_item_line(v_entry, p_space, coalesce(v_to, v_ready), v_currency, v_amount, v_flow);
  end loop;
  perform budget.assert_ready_not_deepened(v_entry, p_space);
  return budget.finish_command(p_space, p_request, 'assign_money', v_payload, jsonb_build_object('entryId', v_entry));
end;
$$;

-- Preserve the original RPC for existing clients. This checked variant owns
-- its receipt so a retry succeeds even though its expected balance is now old.
create function public.record_wallet_opening_checked(
  p_space uuid, p_request uuid, p_wallet uuid, p_amount bigint, p_on date,
  p_expected_balance bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('wallet', p_wallet, 'amount', p_amount,
    'on', p_on, 'expectedBalance', p_expected_balance);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_wallet_opening_checked', v_payload);
  v_wallet budget.wallets%rowtype;
  v_balance bigint;
  v_entry uuid;
  v_amount bigint;
begin
  if v_replay is not null then return v_replay; end if;
  v_wallet := budget.active_wallet(p_space, p_wallet);
  perform budget.require_amount(p_amount);
  v_balance := budget.wallet_balance(p_wallet);
  if p_expected_balance is distinct from v_balance then
    perform budget.raise_budget('BUDGET_BALANCE_CHANGED', jsonb_build_object(
      'walletId', p_wallet, 'expectedBalanceMinor', p_expected_balance::text,
      'actualBalanceMinor', v_balance::text));
  end if;
  v_amount := case when v_wallet.kind = 'loan' and v_wallet.loan_direction = 'i_owe' then -p_amount else p_amount end;
  v_entry := budget.new_entry(p_space, p_request,
    case when v_wallet.kind = 'loan' then 'loan_opening' else 'opening_balance' end::budget.entry_kind, p_on, null);
  perform budget.add_wallet_line(v_entry, p_space, p_wallet, v_amount, 'opening');
  if v_wallet.kind = 'cash' then
    perform budget.add_item_line(v_entry, p_space, budget.ready_item(p_space), v_wallet.currency, v_amount, 'opening');
  end if;
  return budget.finish_command(p_space, p_request, 'record_wallet_opening_checked', v_payload,
    jsonb_build_object('entryId', v_entry));
end;
$$;
revoke all on function public.record_wallet_opening_checked(uuid,uuid,uuid,bigint,date,bigint) from public,anon,service_role;
grant execute on function public.record_wallet_opening_checked(uuid,uuid,uuid,bigint,date,bigint) to authenticated;
revoke all on all functions in schema budget from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
