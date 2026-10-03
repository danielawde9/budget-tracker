-- Budget v2 commands: the only way money records are written.
--
-- Each public command:
--   1. checks membership and takes the space lock (budget.begin_command);
--   2. replays its stored result if the same request id was already used
--      with the same payload, or refuses a reused id with a different one;
--   3. writes exactly one journal entry with both sides (wallet lines and
--      purpose lines) through the small helpers below;
--   4. stores its receipt and returns its result (budget.finish_command).
-- Errors carry a stable code in MESSAGE (BUDGET_*) and context in DETAIL.

-- ---------------------------------------------------------------------------
-- Command envelope
-- ---------------------------------------------------------------------------

create function budget.begin_command(p_space uuid, p_request uuid, p_command text, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_receipt budget.command_receipts%rowtype;
  v_hash text := encode(sha256(convert_to(p_command || ':' || p_payload::text, 'UTF8')), 'hex');
begin
  if p_request is null then
    perform budget.raise_budget('BUDGET_REQUEST_REQUIRED');
  end if;
  perform budget.require_member(p_space);
  perform budget.lock_space(p_space);
  select * into v_receipt from budget.command_receipts where space_id = p_space and request_id = p_request;
  if found then
    if v_receipt.command <> p_command or v_receipt.request_hash <> v_hash then
      perform budget.raise_budget('BUDGET_REQUEST_CONFLICT', jsonb_build_object('requestId', p_request));
    end if;
    return v_receipt.result;
  end if;
  return null;
end;
$$;

create function budget.finish_command(p_space uuid, p_request uuid, p_command text, p_payload jsonb, p_result jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  insert into budget.command_receipts (space_id, request_id, command, request_hash, result, created_by)
  values (
    p_space, p_request, p_command,
    encode(sha256(convert_to(p_command || ':' || p_payload::text, 'UTF8')), 'hex'),
    p_result, (select auth.uid())
  );
  return p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------

create function budget.require_amount(p_amount bigint, p_allow_zero boolean default false)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null
     or p_amount > 1000000000000000
     or (p_allow_zero and p_amount < 0)
     or (not p_allow_zero and p_amount <= 0) then
    perform budget.raise_budget('BUDGET_INVALID_AMOUNT', jsonb_build_object('amount', p_amount));
  end if;
end;
$$;

create function budget.clean_text(p_text text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(p_text), '');
begin
  if v_text is not null and char_length(v_text) > p_max then
    perform budget.raise_budget('BUDGET_TEXT_TOO_LONG', jsonb_build_object('max', p_max));
  end if;
  return v_text;
end;
$$;

create function budget.active_wallet(p_space uuid, p_wallet uuid)
returns budget.wallets
language plpgsql
stable
set search_path = ''
as $$
declare
  v_wallet budget.wallets%rowtype;
begin
  select * into v_wallet from budget.wallets where id = p_wallet and space_id = p_space;
  if not found then
    perform budget.raise_budget('BUDGET_WALLET_NOT_FOUND', jsonb_build_object('walletId', p_wallet));
  end if;
  if v_wallet.archived_at is not null then
    perform budget.raise_budget('BUDGET_ARCHIVED', jsonb_build_object('walletId', p_wallet));
  end if;
  return v_wallet;
end;
$$;

create function budget.wallet_of_kind(p_space uuid, p_wallet uuid, p_kind budget.wallet_kind, p_direction budget.loan_direction default null)
returns budget.wallets
language plpgsql
stable
set search_path = ''
as $$
declare
  v_wallet budget.wallets%rowtype := budget.active_wallet(p_space, p_wallet);
begin
  if v_wallet.kind <> p_kind or (p_direction is not null and v_wallet.loan_direction is distinct from p_direction) then
    perform budget.raise_budget('BUDGET_WALLET_KIND', jsonb_build_object('walletId', p_wallet, 'expected', p_kind));
  end if;
  return v_wallet;
end;
$$;

create function budget.active_item(p_space uuid, p_item uuid)
returns budget.items
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item budget.items%rowtype;
begin
  select * into v_item from budget.items where id = p_item and space_id = p_space;
  if not found then
    perform budget.raise_budget('BUDGET_ITEM_NOT_FOUND', jsonb_build_object('itemId', p_item));
  end if;
  if v_item.archived_at is not null then
    perform budget.raise_budget('BUDGET_ARCHIVED', jsonb_build_object('itemId', p_item));
  end if;
  return v_item;
end;
$$;

-- A plan item that money can be charged to (never Ready to assign itself).
create function budget.plan_item(p_space uuid, p_item uuid)
returns budget.items
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item budget.items%rowtype;
begin
  if p_item is null then
    perform budget.raise_budget('BUDGET_ITEM_REQUIRED');
  end if;
  v_item := budget.active_item(p_space, p_item);
  if v_item.kind = 'ready' then
    perform budget.raise_budget('BUDGET_ITEM_REQUIRED', jsonb_build_object('itemId', p_item));
  end if;
  return v_item;
end;
$$;

-- Ready to assign is passed as null by clients; normalize its id to null too.
create function budget.normalize_item(p_space uuid, p_item uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when p_item is null or p_item = budget.ready_item(p_space) then null else p_item end
$$;

create function budget.item_label(p_item uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('itemId', id, 'nameEn', name_en, 'nameAr', name_ar) from budget.items where id = p_item
$$;

-- ---------------------------------------------------------------------------
-- Entry and line writers
-- ---------------------------------------------------------------------------

create function budget.new_entry(
  p_space uuid, p_request uuid, p_kind budget.entry_kind, p_on date, p_memo text,
  p_bill uuid default null, p_bill_due date default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if p_on is null or p_on < date '2000-01-01' then
    perform budget.raise_budget('BUDGET_INVALID_DATE', jsonb_build_object('date', p_on));
  end if;
  if p_on > budget.space_today(p_space) then
    perform budget.raise_budget('BUDGET_FUTURE_DATE', jsonb_build_object('date', p_on, 'today', budget.space_today(p_space)));
  end if;
  insert into budget.entries (space_id, kind, occurred_on, memo, request_id, bill_id, bill_due_on, created_by)
  values (p_space, p_kind, p_on, budget.clean_text(p_memo, 200), p_request, p_bill, p_bill_due, (select auth.uid()))
  returning id into v_entry;
  return v_entry;
end;
$$;

create function budget.add_wallet_line(p_entry uuid, p_space uuid, p_wallet uuid, p_amount bigint, p_flow budget.flow)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_wallet budget.wallets%rowtype := budget.active_wallet(p_space, p_wallet);
begin
  if p_amount = 0 then
    return;
  end if;
  insert into budget.wallet_lines (entry_id, space_id, wallet_id, currency, amount_minor, flow)
  values (p_entry, p_space, p_wallet, v_wallet.currency, p_amount, p_flow);
end;
$$;

create function budget.add_item_line(p_entry uuid, p_space uuid, p_item uuid, p_currency budget.currency, p_amount bigint, p_flow budget.flow)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item budget.items%rowtype := budget.active_item(p_space, p_item);
begin
  if p_amount = 0 then
    return;
  end if;
  insert into budget.item_lines (entry_id, space_id, item_id, currency, amount_minor, flow)
  values (p_entry, p_space, v_item.id, p_currency, p_amount, p_flow);
end;
$$;

-- Takes p_amount out of an item for a real outflow. When the item holds
-- less, the shortfall is first moved in from p_cover_from (an item that must
-- hold enough) or, by default, from Ready to assign (which may then go below
-- zero: "over-assigned"). Returns the shortfall that was covered.
create function budget.charge_item(
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
  v_source uuid;
begin
  if v_shortfall > 0 then
    if v_cover is null then
      v_source := budget.ready_item(p_space);
    else
      if v_cover = v_item.id then
        perform budget.raise_budget('BUDGET_COVER_INVALID', budget.item_label(v_cover));
      end if;
      perform budget.plan_item(p_space, v_cover);
      if budget.item_min_balance_from(v_cover, p_currency, v_on) < v_shortfall then
        perform budget.raise_budget('BUDGET_INSUFFICIENT_ITEM', budget.item_label(v_cover) || jsonb_build_object(
          'currency', p_currency, 'available', greatest(budget.item_min_balance_from(v_cover, p_currency, v_on), 0)::text, 'needed', v_shortfall::text));
      end if;
      v_source := v_cover;
    end if;
    perform budget.add_item_line(p_entry, p_space, v_source, p_currency, -v_shortfall, 'cover');
    perform budget.add_item_line(p_entry, p_space, v_item.id, p_currency, v_shortfall, 'cover');
  end if;
  perform budget.add_item_line(p_entry, p_space, v_item.id, p_currency, -p_amount, p_flow);
  return v_shortfall;
end;
$$;

-- An entry that takes money out of Ready to assign may not make it (or keep
-- it) negative. Only real outflows (cover) and corrections can do that.
create function budget.assert_ready_not_deepened(p_entry uuid, p_space uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ready uuid := budget.ready_item(p_space);
  v_on date := (select occurred_on from budget.entries where id = p_entry);
  v_currency budget.currency;
  v_taken bigint;
begin
  for v_currency, v_taken in
    select currency, -sum(amount_minor)::bigint from budget.item_lines
    where entry_id = p_entry and item_id = v_ready
    group by currency
    having sum(amount_minor) < 0
  loop
    -- Lowest day from this entry on, with this entry already applied.
    if budget.item_min_balance_from(v_ready, v_currency, v_on) < 0 then
      perform budget.raise_budget('BUDGET_INSUFFICIENT_READY', jsonb_build_object(
        'currency', v_currency,
        'available', greatest(budget.item_min_balance_from(v_ready, v_currency, v_on) + v_taken, 0)::text));
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bills: due dates are computed, never stored
-- ---------------------------------------------------------------------------

-- Due dates of a schedule within [p_from, p_to] (span ≤ 800 days). Monthly and
-- yearly bills fall on the first due date's day, clamped to the month's end.
create function budget.bill_due_dates(p_cadence text, p_first date, p_end date, p_from date, p_to date)
returns setof date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step interval;
  v_start integer;
  v_stop integer;
  v_day integer := extract(day from p_first)::integer;
  v_anchor date;
  v_due date;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then
    perform budget.raise_budget('BUDGET_INVALID_RANGE', jsonb_build_object('from', p_from, 'to', p_to));
  end if;
  if p_cadence = 'once' then
    if p_first between p_from and p_to and (p_end is null or p_first <= p_end) then
      return next p_first;
    end if;
    return;
  end if;
  if p_cadence = 'monthly' then
    v_step := interval '1 month';
    v_start := greatest(0, (extract(year from p_from)::integer - extract(year from p_first)::integer) * 12
                           + extract(month from p_from)::integer - extract(month from p_first)::integer);
    v_stop := (extract(year from p_to)::integer - extract(year from p_first)::integer) * 12
              + extract(month from p_to)::integer - extract(month from p_first)::integer;
  else
    v_step := interval '1 year';
    v_start := greatest(0, extract(year from p_from)::integer - extract(year from p_first)::integer);
    v_stop := extract(year from p_to)::integer - extract(year from p_first)::integer;
  end if;
  for n in v_start .. v_stop loop
    v_anchor := (date_trunc('month', p_first) + v_step * n)::date;
    v_due := least(v_anchor + (v_day - 1), (v_anchor + interval '1 month' - interval '1 day')::date);
    if v_due between p_from and p_to and v_due >= p_first and (p_end is null or v_due <= p_end) then
      return next v_due;
    end if;
  end loop;
end;
$$;

create function budget.bill_paid_entry(p_bill uuid, p_due date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select e.id from budget.entries e
  where e.bill_id = p_bill and e.bill_due_on = p_due
    and not exists (select 1 from budget.entries r where r.reverses_entry_id = e.id)
  order by e.created_at
  limit 1
$$;

create function budget.require_bill_payable(
  p_space uuid, p_bill uuid, p_due date, p_item uuid, p_currency budget.currency, p_loan uuid default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_bill budget.bills%rowtype;
begin
  if p_bill is null then
    return;
  end if;
  select * into v_bill from budget.bills where id = p_bill and space_id = p_space and archived_at is null;
  if not found then
    perform budget.raise_budget('BUDGET_BILL_NOT_FOUND', jsonb_build_object('billId', p_bill));
  end if;
  if v_bill.item_id <> p_item or v_bill.currency <> p_currency or v_bill.loan_wallet_id is distinct from p_loan then
    perform budget.raise_budget('BUDGET_BILL_MISMATCH', jsonb_build_object('billId', p_bill));
  end if;
  if p_due is null or not exists (select 1 from budget.bill_due_dates(v_bill.cadence, v_bill.first_due_on, v_bill.end_on, p_due, p_due)) then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if exists (select 1 from budget.bill_skips where bill_id = p_bill and due_on = p_due) then
    perform budget.raise_budget('BUDGET_BILL_SKIPPED', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if budget.bill_paid_entry(p_bill, p_due) is not null then
    perform budget.raise_budget('BUDGET_BILL_ALREADY_PAID', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Default plan (EN/AR names; established v1 Arabic vocabulary)
-- ---------------------------------------------------------------------------

create function budget.seed_default_plan(p_space uuid, p_month date, p_income bigint, p_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_version uuid;
  v_group uuid;
  v_group_def jsonb;
  v_item_def jsonb;
  v_group_position integer := 0;
  v_item_position integer;
begin
  insert into budget.plan_versions (space_id, effective_month, expected_income_minor, updated_by)
  values (p_space, budget.month_start(p_month), p_income, p_user)
  returning id into v_version;

  for v_group_def in select value from jsonb_array_elements($json$[
    {"en":"Essentials","ar":"الأساسيات","bps":6000,"flexEn":"Other essentials","flexAr":"أساسيات أخرى","items":[
      {"kind":"spending","en":"Rent","ar":"الإيجار"},
      {"kind":"spending","en":"Bills","ar":"الفواتير"},
      {"kind":"spending","en":"Groceries","ar":"البقالة"},
      {"kind":"spending","en":"Transport","ar":"النقل"},
      {"kind":"reserve","en":"Insurance reserve","ar":"احتياطي التأمين"}]},
    {"en":"Guilt free","ar":"الإنفاق الحر","bps":500,"flexEn":"Other guilt-free","flexAr":"إنفاق حر آخر","items":[
      {"kind":"spending","en":"Eating out","ar":"الأكل خارج المنزل"},
      {"kind":"spending","en":"Fun","ar":"الترفيه"}]},
    {"en":"Short-term goals","ar":"الأهداف قصيرة المدى","bps":1500,"flexEn":"Goals money","flexAr":"مال الأهداف","items":[]},
    {"en":"Savings","ar":"الادخار","bps":1000,"flexEn":"General savings","flexAr":"ادخار عام","items":[]},
    {"en":"Investments","ar":"الاستثمار","bps":1000,"flexEn":"To invest","flexAr":"للاستثمار","items":[]}
  ]$json$::jsonb)
  loop
    insert into budget.plan_groups (space_id, name_en, name_ar)
    values (p_space, v_group_def ->> 'en', v_group_def ->> 'ar')
    returning id into v_group;
    insert into budget.items (space_id, group_id, kind, name_en, name_ar)
    values (p_space, v_group, 'flex', v_group_def ->> 'flexEn', v_group_def ->> 'flexAr');
    insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position)
    values (v_version, p_space, v_group, (v_group_def ->> 'bps')::integer, v_group_position);
    v_item_position := 0;
    for v_item_def in select value from jsonb_array_elements(v_group_def -> 'items') loop
      with created as (
        insert into budget.items (space_id, group_id, kind, name_en, name_ar)
        values (p_space, v_group, (v_item_def ->> 'kind')::budget.item_kind, v_item_def ->> 'en', v_item_def ->> 'ar')
        returning id
      )
      insert into budget.plan_version_items (version_id, space_id, item_id, group_id, monthly_minor, position)
      select v_version, p_space, created.id, v_group, 0, v_item_position from created;
      v_item_position := v_item_position + 1;
    end loop;
    v_group_position := v_group_position + 1;
  end loop;
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public commands
-- ---------------------------------------------------------------------------

create function public.create_space(
  p_request uuid,
  p_name text,
  p_expected_income_minor bigint default 0,
  p_timezone text default 'Asia/Beirut',
  p_with_defaults boolean default true,
  p_plan_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_space uuid;
  v_name text := budget.clean_text(p_name, 80);
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'BUDGET_NOT_AUTHENTICATED';
  end if;
  if p_request is null then
    perform budget.raise_budget('BUDGET_REQUEST_REQUIRED');
  end if;
  select id into v_space from budget.spaces where created_by = v_user and request_id = p_request;
  if found then
    return jsonb_build_object('spaceId', v_space);
  end if;
  if v_name is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME');
  end if;
  perform budget.require_amount(coalesce(p_expected_income_minor, 0), true);

  insert into budget.spaces (name, timezone, created_by, request_id)
  values (v_name, coalesce(nullif(btrim(p_timezone), ''), 'Asia/Beirut'), v_user, p_request)
  returning id into v_space;
  insert into budget.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');
  insert into budget.items (space_id, group_id, kind, name_en, name_ar)
  values (v_space, null, 'ready', 'Ready to assign', 'جاهز للتوزيع');
  -- BdL official rate since 15 Feb 2024; display-only and editable.
  insert into budget.reference_rates (space_id, currency, effective_on, units_per_usd)
  values (v_space, 'LBP', date '2024-02-15', 89500);
  if coalesce(p_with_defaults, true) then
    perform budget.seed_default_plan(
      v_space,
      coalesce(p_plan_month, budget.space_today(v_space)),
      coalesce(p_expected_income_minor, 0),
      v_user);
  end if;
  return jsonb_build_object('spaceId', v_space);
end;
$$;

create function public.create_wallet(
  p_space uuid,
  p_request uuid,
  p_name text,
  p_kind text,
  p_currency text,
  p_opening_minor bigint default 0,
  p_opened_on date default null,
  p_loan_direction text default null,
  p_counterparty text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('name', p_name, 'kind', p_kind, 'currency', p_currency,
    'opening', p_opening_minor, 'on', p_opened_on, 'direction', p_loan_direction, 'counterparty', p_counterparty);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'create_wallet', v_payload);
  v_kind budget.wallet_kind;
  v_currency budget.currency;
  v_direction budget.loan_direction;
  v_name text := budget.clean_text(p_name, 60);
  v_opening bigint := coalesce(p_opening_minor, 0);
  v_wallet uuid;
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if p_kind not in ('cash', 'investment', 'loan') or p_currency not in ('USD', 'LBP')
     or (p_kind = 'loan') <> (p_loan_direction is not null)
     or (p_loan_direction is not null and p_loan_direction not in ('i_owe', 'owed_to_me')) then
    perform budget.raise_budget('BUDGET_WALLET_KIND', v_payload);
  end if;
  if v_name is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME');
  end if;
  v_kind := p_kind::budget.wallet_kind;
  v_currency := p_currency::budget.currency;
  v_direction := p_loan_direction::budget.loan_direction;
  if abs(v_opening) > 1000000000000000 or (v_kind <> 'cash' and v_opening < 0) then
    perform budget.raise_budget('BUDGET_INVALID_AMOUNT', jsonb_build_object('amount', v_opening));
  end if;

  insert into budget.wallets (space_id, name, kind, currency, loan_direction, counterparty)
  values (p_space, v_name, v_kind, v_currency, v_direction, budget.clean_text(p_counterparty, 60))
  returning id into v_wallet;

  if v_opening <> 0 then
    v_entry := budget.new_entry(p_space, p_request,
      case when v_kind = 'loan' then 'loan_opening' else 'opening_balance' end::budget.entry_kind,
      coalesce(p_opened_on, budget.space_today(p_space)), null);
    if v_kind = 'cash' then
      perform budget.add_wallet_line(v_entry, p_space, v_wallet, v_opening, 'opening');
      perform budget.add_item_line(v_entry, p_space, budget.ready_item(p_space), v_currency, v_opening, 'opening');
    elsif v_kind = 'investment' then
      perform budget.add_wallet_line(v_entry, p_space, v_wallet, v_opening, 'opening');
    else
      perform budget.add_wallet_line(v_entry, p_space, v_wallet,
        case when v_direction = 'i_owe' then -v_opening else v_opening end, 'opening');
    end if;
  end if;
  return budget.finish_command(p_space, p_request, 'create_wallet', v_payload,
    jsonb_build_object('walletId', v_wallet, 'entryId', v_entry));
end;
$$;

create function public.update_wallet(p_space uuid, p_request uuid, p_wallet uuid, p_name text, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('wallet', p_wallet, 'name', p_name, 'archived', p_archived);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'update_wallet', v_payload);
  v_name text := budget.clean_text(p_name, 60);
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if v_name is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME');
  end if;
  if not exists (select 1 from budget.wallets where id = p_wallet and space_id = p_space) then
    perform budget.raise_budget('BUDGET_WALLET_NOT_FOUND', jsonb_build_object('walletId', p_wallet));
  end if;
  if coalesce(p_archived, false) and budget.wallet_balance(p_wallet) <> 0 then
    perform budget.raise_budget('BUDGET_ARCHIVE_NONZERO', jsonb_build_object('walletId', p_wallet,
      'balance', budget.wallet_balance(p_wallet)::text));
  end if;
  update budget.wallets
     set name = v_name,
         archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) else null end
   where id = p_wallet;
  return budget.finish_command(p_space, p_request, 'update_wallet', v_payload, jsonb_build_object('walletId', p_wallet));
end;
$$;

-- Fund (Ready → item), release (item → Ready) and move (item → item) in one
-- entry. With p_opening, only Ready → item, recorded as items' opening balances.
create function public.assign_money(
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

create function public.record_income(
  p_space uuid,
  p_request uuid,
  p_wallet uuid,
  p_amount bigint,
  p_on date,
  p_memo text default null,
  p_item uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('wallet', p_wallet, 'amount', p_amount, 'on', p_on, 'memo', p_memo, 'item', p_item);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_income', v_payload);
  v_wallet budget.wallets%rowtype;
  v_item uuid;
  v_ready uuid := budget.ready_item(p_space);
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  v_wallet := budget.wallet_of_kind(p_space, p_wallet, 'cash');
  perform budget.require_amount(p_amount);
  v_item := budget.normalize_item(p_space, p_item);
  v_entry := budget.new_entry(p_space, p_request, 'income', p_on, p_memo);
  perform budget.add_wallet_line(v_entry, p_space, p_wallet, p_amount, 'income');
  perform budget.add_item_line(v_entry, p_space, v_ready, v_wallet.currency, p_amount, 'income');
  if v_item is not null then
    perform budget.plan_item(p_space, v_item);
    perform budget.add_item_line(v_entry, p_space, v_ready, v_wallet.currency, -p_amount, 'fund');
    perform budget.add_item_line(v_entry, p_space, v_item, v_wallet.currency, p_amount, 'fund');
  end if;
  return budget.finish_command(p_space, p_request, 'record_income', v_payload, jsonb_build_object('entryId', v_entry));
end;
$$;

create function public.record_expense(
  p_space uuid,
  p_request uuid,
  p_wallet uuid,
  p_item uuid,
  p_amount bigint,
  p_on date,
  p_memo text default null,
  p_cover_from uuid default null,
  p_bill uuid default null,
  p_bill_due date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('wallet', p_wallet, 'item', p_item, 'amount', p_amount, 'on', p_on,
    'memo', p_memo, 'cover', p_cover_from, 'bill', p_bill, 'due', p_bill_due);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_expense', v_payload);
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
  if (p_bill is null) <> (p_bill_due is null) then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE');
  end if;
  perform budget.require_bill_payable(p_space, p_bill, p_bill_due, p_item, v_wallet.currency);
  v_entry := budget.new_entry(p_space, p_request, 'expense', p_on, p_memo, p_bill, p_bill_due);
  perform budget.add_wallet_line(v_entry, p_space, p_wallet, -p_amount, 'spend');
  v_covered := budget.charge_item(v_entry, p_space, p_item, v_wallet.currency, p_amount, 'spend', p_cover_from);
  return budget.finish_command(p_space, p_request, 'record_expense', v_payload,
    jsonb_build_object('entryId', v_entry, 'covered', v_covered::text));
end;
$$;

create function public.record_refund(
  p_space uuid,
  p_request uuid,
  p_wallet uuid,
  p_item uuid,
  p_amount bigint,
  p_on date,
  p_memo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('wallet', p_wallet, 'item', p_item, 'amount', p_amount, 'on', p_on, 'memo', p_memo);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_refund', v_payload);
  v_wallet budget.wallets%rowtype;
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  v_wallet := budget.wallet_of_kind(p_space, p_wallet, 'cash');
  perform budget.require_amount(p_amount);
  perform budget.plan_item(p_space, p_item);
  v_entry := budget.new_entry(p_space, p_request, 'refund', p_on, p_memo);
  perform budget.add_wallet_line(v_entry, p_space, p_wallet, p_amount, 'refund');
  perform budget.add_item_line(v_entry, p_space, p_item, v_wallet.currency, p_amount, 'refund');
  return budget.finish_command(p_space, p_request, 'record_refund', v_payload, jsonb_build_object('entryId', v_entry));
end;
$$;

create function public.record_transfer(
  p_space uuid,
  p_request uuid,
  p_from uuid,
  p_to uuid,
  p_amount bigint,
  p_on date,
  p_memo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('from', p_from, 'to', p_to, 'amount', p_amount, 'on', p_on, 'memo', p_memo);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_transfer', v_payload);
  v_from budget.wallets%rowtype;
  v_to budget.wallets%rowtype;
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  v_from := budget.active_wallet(p_space, p_from);
  v_to := budget.active_wallet(p_space, p_to);
  if v_from.id = v_to.id or v_from.kind <> 'cash' or v_to.kind <> 'cash' or v_from.currency <> v_to.currency then
    perform budget.raise_budget('BUDGET_TRANSFER_INVALID', v_payload);
  end if;
  perform budget.require_amount(p_amount);
  v_entry := budget.new_entry(p_space, p_request, 'transfer', p_on, p_memo);
  perform budget.add_wallet_line(v_entry, p_space, p_from, -p_amount, 'transfer');
  perform budget.add_wallet_line(v_entry, p_space, p_to, p_amount, 'transfer');
  return budget.finish_command(p_space, p_request, 'record_transfer', v_payload, jsonb_build_object('entryId', v_entry));
end;
$$;

-- The rate is never assumed: it is whatever the two amounts say. The purpose
-- (an item, or Ready to assign when null) keeps the money in the new currency.
create function public.record_exchange(
  p_space uuid,
  p_request uuid,
  p_from uuid,
  p_from_amount bigint,
  p_to uuid,
  p_to_amount bigint,
  p_on date,
  p_item uuid default null,
  p_memo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('from', p_from, 'fromAmount', p_from_amount, 'to', p_to, 'toAmount', p_to_amount,
    'on', p_on, 'item', p_item, 'memo', p_memo);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_exchange', v_payload);
  v_from budget.wallets%rowtype;
  v_to budget.wallets%rowtype;
  v_item uuid;
  v_purpose uuid;
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  v_from := budget.active_wallet(p_space, p_from);
  v_to := budget.active_wallet(p_space, p_to);
  if v_from.kind <> 'cash' or v_to.kind <> 'cash' or v_from.currency = v_to.currency then
    perform budget.raise_budget('BUDGET_EXCHANGE_INVALID', v_payload);
  end if;
  perform budget.require_amount(p_from_amount);
  perform budget.require_amount(p_to_amount);
  v_item := budget.normalize_item(p_space, p_item);
  if v_item is not null then
    perform budget.plan_item(p_space, v_item);
    if budget.item_min_balance_from(v_item, v_from.currency, p_on) < p_from_amount then
      perform budget.raise_budget('BUDGET_INSUFFICIENT_ITEM', budget.item_label(v_item) || jsonb_build_object(
        'currency', v_from.currency, 'available', greatest(budget.item_min_balance_from(v_item, v_from.currency, p_on), 0)::text, 'needed', p_from_amount::text));
    end if;
  end if;
  v_purpose := coalesce(v_item, budget.ready_item(p_space));
  v_entry := budget.new_entry(p_space, p_request, 'exchange', p_on, p_memo);
  perform budget.add_wallet_line(v_entry, p_space, p_from, -p_from_amount, 'exchange');
  perform budget.add_wallet_line(v_entry, p_space, p_to, p_to_amount, 'exchange');
  perform budget.add_item_line(v_entry, p_space, v_purpose, v_from.currency, -p_from_amount, 'exchange');
  perform budget.add_item_line(v_entry, p_space, v_purpose, v_to.currency, p_to_amount, 'exchange');
  perform budget.assert_ready_not_deepened(v_entry, p_space);
  return budget.finish_command(p_space, p_request, 'record_exchange', v_payload, jsonb_build_object('entryId', v_entry));
end;
$$;

-- Investment accounts are outside spendable cash. A contribution leaves an
-- item (normally To invest) and is reported as invested, not spent.
create function public.record_investment(
  p_space uuid,
  p_request uuid,
  p_action text,
  p_investment uuid,
  p_amount bigint,
  p_on date,
  p_cash uuid default null,
  p_item uuid default null,
  p_cover_from uuid default null,
  p_memo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('action', p_action, 'investment', p_investment, 'amount', p_amount, 'on', p_on,
    'cash', p_cash, 'item', p_item, 'cover', p_cover_from, 'memo', p_memo);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_investment', v_payload);
  v_investment budget.wallets%rowtype;
  v_cash budget.wallets%rowtype;
  v_ready uuid := budget.ready_item(p_space);
  v_delta bigint;
  v_entry uuid;
  v_covered bigint := 0;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  v_investment := budget.wallet_of_kind(p_space, p_investment, 'investment');
  if p_action not in ('contribute', 'withdraw', 'value', 'fee', 'income_cash', 'income_reinvested') then
    perform budget.raise_budget('BUDGET_INVALID_ACTION', jsonb_build_object('action', p_action));
  end if;
  perform budget.require_amount(p_amount, p_action = 'value');
  if p_action in ('contribute', 'withdraw', 'income_cash') then
    v_cash := budget.wallet_of_kind(p_space, p_cash, 'cash');
    if v_cash.currency <> v_investment.currency then
      perform budget.raise_budget('BUDGET_CURRENCY_MISMATCH', v_payload);
    end if;
  end if;

  if p_action = 'contribute' then
    v_entry := budget.new_entry(p_space, p_request, 'invest', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_cash, -p_amount, 'invest');
    perform budget.add_wallet_line(v_entry, p_space, p_investment, p_amount, 'invest');
    v_covered := budget.charge_item(v_entry, p_space, p_item, v_cash.currency, p_amount, 'invest', p_cover_from);
  elsif p_action = 'withdraw' then
    v_entry := budget.new_entry(p_space, p_request, 'invest_withdraw', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_investment, -p_amount, 'withdraw');
    perform budget.add_wallet_line(v_entry, p_space, p_cash, p_amount, 'withdraw');
    perform budget.add_item_line(v_entry, p_space, v_ready, v_cash.currency, p_amount, 'withdraw');
  elsif p_action = 'value' then
    v_delta := p_amount - budget.wallet_balance(p_investment);
    if v_delta = 0 then
      perform budget.raise_budget('BUDGET_NO_CHANGE');
    end if;
    v_entry := budget.new_entry(p_space, p_request, 'invest_value', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_investment, v_delta, 'value');
  elsif p_action = 'fee' then
    v_entry := budget.new_entry(p_space, p_request, 'invest_fee', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_investment, -p_amount, 'fee');
  elsif p_action = 'income_cash' then
    v_entry := budget.new_entry(p_space, p_request, 'invest_income', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_cash, p_amount, 'other_income');
    perform budget.add_item_line(v_entry, p_space, v_ready, v_cash.currency, p_amount, 'other_income');
  else
    v_entry := budget.new_entry(p_space, p_request, 'invest_income', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_investment, p_amount, 'other_income');
  end if;
  return budget.finish_command(p_space, p_request, 'record_investment', v_payload,
    jsonb_build_object('entryId', v_entry, 'covered', v_covered::text));
end;
$$;

-- Loans are outside spendable cash. Borrowed money and repayments received
-- arrive in Ready to assign (never as income); principal repaid reduces the
-- debt (never spending); only interest and fees are spending.
create function public.record_loan(
  p_space uuid,
  p_request uuid,
  p_action text,
  p_loan uuid,
  p_on date,
  p_principal bigint,
  p_interest bigint default 0,
  p_fee bigint default 0,
  p_cash uuid default null,
  p_item uuid default null,
  p_cover_from uuid default null,
  p_memo text default null,
  p_bill uuid default null,
  p_bill_due date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('action', p_action, 'loan', p_loan, 'on', p_on, 'principal', p_principal,
    'interest', p_interest, 'fee', p_fee, 'cash', p_cash, 'item', p_item, 'cover', p_cover_from, 'memo', p_memo,
    'bill', p_bill, 'due', p_bill_due);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'record_loan', v_payload);
  v_loan budget.wallets%rowtype;
  v_cash budget.wallets%rowtype;
  v_ready uuid := budget.ready_item(p_space);
  v_principal bigint := coalesce(p_principal, 0);
  v_interest bigint := coalesce(p_interest, 0);
  v_fee bigint := coalesce(p_fee, 0);
  v_item uuid;
  v_entry uuid;
  v_covered bigint := 0;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if p_action not in ('borrow', 'repay', 'lend', 'collect') then
    perform budget.raise_budget('BUDGET_INVALID_ACTION', jsonb_build_object('action', p_action));
  end if;
  v_loan := budget.wallet_of_kind(p_space, p_loan, 'loan',
    case when p_action in ('borrow', 'repay') then 'i_owe' else 'owed_to_me' end::budget.loan_direction);
  v_cash := budget.wallet_of_kind(p_space, p_cash, 'cash');
  if v_cash.currency <> v_loan.currency then
    perform budget.raise_budget('BUDGET_CURRENCY_MISMATCH', v_payload);
  end if;
  perform budget.require_amount(v_principal, true);
  perform budget.require_amount(v_interest, true);
  perform budget.require_amount(v_fee, true);
  if v_principal + v_interest + v_fee <= 0 or (p_action in ('borrow', 'lend') and (v_interest <> 0 or v_fee <> 0 or v_principal = 0))
     or (p_action = 'collect' and v_fee <> 0) then
    perform budget.raise_budget('BUDGET_INVALID_AMOUNT', v_payload);
  end if;
  if (p_bill is null) <> (p_bill_due is null) or (p_bill is not null and p_action <> 'repay') then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE');
  end if;

  if p_action = 'borrow' then
    v_entry := budget.new_entry(p_space, p_request, 'loan_borrow', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_loan, -v_principal, 'borrow');
    perform budget.add_wallet_line(v_entry, p_space, p_cash, v_principal, 'borrow');
    perform budget.add_item_line(v_entry, p_space, v_ready, v_cash.currency, v_principal, 'borrow');
  elsif p_action = 'repay' then
    if v_principal > -budget.wallet_balance(p_loan) then
      perform budget.raise_budget('BUDGET_OVERPAY', jsonb_build_object('owed', (-budget.wallet_balance(p_loan))::text));
    end if;
    perform budget.plan_item(p_space, p_item);
    perform budget.require_bill_payable(p_space, p_bill, p_bill_due, p_item, v_cash.currency, p_loan);
    v_entry := budget.new_entry(p_space, p_request, 'loan_repay', p_on, p_memo, p_bill, p_bill_due);
    perform budget.add_wallet_line(v_entry, p_space, p_cash, -v_principal, 'principal');
    perform budget.add_wallet_line(v_entry, p_space, p_cash, -v_interest, 'interest');
    perform budget.add_wallet_line(v_entry, p_space, p_cash, -v_fee, 'fee');
    perform budget.add_wallet_line(v_entry, p_space, p_loan, v_principal, 'principal');
    if v_principal > 0 then
      v_covered := v_covered + budget.charge_item(v_entry, p_space, p_item, v_cash.currency, v_principal, 'principal', p_cover_from);
    end if;
    if v_interest > 0 then
      v_covered := v_covered + budget.charge_item(v_entry, p_space, p_item, v_cash.currency, v_interest, 'interest', p_cover_from);
    end if;
    if v_fee > 0 then
      v_covered := v_covered + budget.charge_item(v_entry, p_space, p_item, v_cash.currency, v_fee, 'fee', p_cover_from);
    end if;
  elsif p_action = 'lend' then
    v_item := budget.normalize_item(p_space, p_item);
    v_entry := budget.new_entry(p_space, p_request, 'loan_lend', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_cash, -v_principal, 'lend');
    perform budget.add_wallet_line(v_entry, p_space, p_loan, v_principal, 'lend');
    if v_item is null then
      perform budget.add_item_line(v_entry, p_space, v_ready, v_cash.currency, -v_principal, 'lend');
      perform budget.assert_ready_not_deepened(v_entry, p_space);
    else
      v_covered := budget.charge_item(v_entry, p_space, v_item, v_cash.currency, v_principal, 'lend', p_cover_from);
    end if;
  else
    if v_principal > budget.wallet_balance(p_loan) then
      perform budget.raise_budget('BUDGET_OVERPAY', jsonb_build_object('owed', budget.wallet_balance(p_loan)::text));
    end if;
    v_entry := budget.new_entry(p_space, p_request, 'loan_collect', p_on, p_memo);
    perform budget.add_wallet_line(v_entry, p_space, p_cash, v_principal, 'collect');
    perform budget.add_wallet_line(v_entry, p_space, p_loan, -v_principal, 'collect');
    perform budget.add_item_line(v_entry, p_space, v_ready, v_cash.currency, v_principal, 'collect');
    perform budget.add_wallet_line(v_entry, p_space, p_cash, v_interest, 'other_income');
    perform budget.add_item_line(v_entry, p_space, v_ready, v_cash.currency, v_interest, 'other_income');
  end if;
  return budget.finish_command(p_space, p_request, 'record_loan', v_payload,
    jsonb_build_object('entryId', v_entry, 'covered', v_covered::text));
end;
$$;

-- A correction: a new entry dated like the original that negates every line.
-- The original stays in history. Refused when the money it put into an item
-- has already been used (the item would go below zero).
create function public.reverse_entry(p_space uuid, p_request uuid, p_entry uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('entry', p_entry, 'reason', p_reason);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'reverse_entry', v_payload);
  v_original budget.entries%rowtype;
  v_short record;
  v_entry uuid;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_original from budget.entries where id = p_entry and space_id = p_space;
  if not found then
    perform budget.raise_budget('BUDGET_ENTRY_NOT_FOUND', jsonb_build_object('entryId', p_entry));
  end if;
  if v_original.kind = 'reversal' then
    perform budget.raise_budget('BUDGET_CANNOT_REVERSE', jsonb_build_object('entryId', p_entry));
  end if;
  if exists (select 1 from budget.entries where reverses_entry_id = p_entry) then
    perform budget.raise_budget('BUDGET_ALREADY_REVERSED', jsonb_build_object('entryId', p_entry));
  end if;
  if exists (select 1 from budget.wallet_lines l join budget.wallets w on w.id = l.wallet_id
             where l.entry_id = p_entry and w.archived_at is not null)
     or exists (select 1 from budget.item_lines l join budget.items i on i.id = l.item_id
                where l.entry_id = p_entry and i.archived_at is not null) then
    perform budget.raise_budget('BUDGET_ARCHIVED', jsonb_build_object('entryId', p_entry));
  end if;
  select l.item_id, l.currency, sum(l.amount_minor) as total
    into v_short
  from budget.item_lines l
  join budget.items i on i.id = l.item_id
  where l.entry_id = p_entry and i.kind <> 'ready'
  group by l.item_id, l.currency
  having budget.item_min_balance_from(l.item_id, l.currency, v_original.occurred_on) - sum(l.amount_minor) < 0
  limit 1;
  if found then
    perform budget.raise_budget('BUDGET_INSUFFICIENT_ITEM', budget.item_label(v_short.item_id) || jsonb_build_object(
      'currency', v_short.currency,
      'available', greatest(budget.item_min_balance_from(v_short.item_id, v_short.currency, v_original.occurred_on), 0)::text,
      'needed', v_short.total::text));
  end if;

  insert into budget.entries (space_id, kind, occurred_on, request_id, reverses_entry_id, reversal_reason, created_by)
  values (p_space, 'reversal', v_original.occurred_on, p_request, p_entry, budget.clean_text(p_reason, 200), (select auth.uid()))
  returning id into v_entry;
  insert into budget.wallet_lines (entry_id, space_id, wallet_id, currency, amount_minor, flow)
  select v_entry, p_space, wallet_id, currency, -amount_minor, flow from budget.wallet_lines where entry_id = p_entry;
  insert into budget.item_lines (entry_id, space_id, item_id, currency, amount_minor, flow)
  select v_entry, p_space, item_id, currency, -amount_minor, flow from budget.item_lines where entry_id = p_entry;
  return budget.finish_command(p_space, p_request, 'reverse_entry', v_payload, jsonb_build_object('entryId', v_entry));
end;
$$;

create function public.save_bill(
  p_space uuid,
  p_request uuid,
  p_name text,
  p_item uuid,
  p_amount bigint,
  p_currency text,
  p_cadence text,
  p_first_due date,
  p_end date default null,
  p_loan uuid default null,
  p_bill uuid default null,
  p_archived boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('name', p_name, 'item', p_item, 'amount', p_amount, 'currency', p_currency,
    'cadence', p_cadence, 'first', p_first_due, 'end', p_end, 'loan', p_loan, 'bill', p_bill, 'archived', p_archived);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'save_bill', v_payload);
  v_name text := budget.clean_text(p_name, 60);
  v_bill uuid := p_bill;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if v_name is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME');
  end if;
  if p_currency not in ('USD', 'LBP') or p_cadence not in ('monthly', 'yearly', 'once') or p_first_due is null
     or (p_end is not null and p_end < p_first_due) then
    perform budget.raise_budget('BUDGET_INVALID_BILL', v_payload);
  end if;
  perform budget.require_amount(p_amount);
  perform budget.plan_item(p_space, p_item);
  if p_loan is not null then
    perform budget.wallet_of_kind(p_space, p_loan, 'loan', 'i_owe');
  end if;
  if v_bill is null then
    insert into budget.bills (space_id, item_id, name, amount_minor, currency, cadence, first_due_on, end_on, loan_wallet_id)
    values (p_space, p_item, v_name, p_amount, p_currency::budget.currency, p_cadence, p_first_due, p_end, p_loan)
    returning id into v_bill;
  else
    update budget.bills
       set item_id = p_item, name = v_name, amount_minor = p_amount, currency = p_currency::budget.currency,
           cadence = p_cadence, first_due_on = p_first_due, end_on = p_end, loan_wallet_id = p_loan,
           archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) else null end
     where id = v_bill and space_id = p_space;
    if not found then
      perform budget.raise_budget('BUDGET_BILL_NOT_FOUND', jsonb_build_object('billId', v_bill));
    end if;
  end if;
  return budget.finish_command(p_space, p_request, 'save_bill', v_payload, jsonb_build_object('billId', v_bill));
end;
$$;

create function public.skip_bill(p_space uuid, p_request uuid, p_bill uuid, p_due date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('bill', p_bill, 'due', p_due);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'skip_bill', v_payload);
  v_bill budget.bills%rowtype;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_bill from budget.bills where id = p_bill and space_id = p_space and archived_at is null;
  if not found then
    perform budget.raise_budget('BUDGET_BILL_NOT_FOUND', jsonb_build_object('billId', p_bill));
  end if;
  if p_due is null or not exists (select 1 from budget.bill_due_dates(v_bill.cadence, v_bill.first_due_on, v_bill.end_on, p_due, p_due)) then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if budget.bill_paid_entry(p_bill, p_due) is not null then
    perform budget.raise_budget('BUDGET_BILL_ALREADY_PAID', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  insert into budget.bill_skips (bill_id, space_id, due_on, created_by)
  values (p_bill, p_space, p_due, (select auth.uid()))
  on conflict (bill_id, due_on) do nothing;
  return budget.finish_command(p_space, p_request, 'skip_bill', v_payload, jsonb_build_object('billId', p_bill));
end;
$$;

create function public.set_reference_rate(p_space uuid, p_request uuid, p_currency text, p_units_per_usd numeric, p_effective date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('currency', p_currency, 'rate', p_units_per_usd, 'effective', p_effective);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'set_reference_rate', v_payload);
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if p_currency is distinct from 'LBP' or p_units_per_usd is null or p_units_per_usd <= 0 or p_units_per_usd > 100000000
     or p_effective is null or p_effective > budget.space_today(p_space) then
    perform budget.raise_budget('BUDGET_INVALID_RATE', v_payload);
  end if;
  insert into budget.reference_rates (space_id, currency, effective_on, units_per_usd)
  values (p_space, 'LBP', p_effective, p_units_per_usd)
  on conflict (space_id, currency, effective_on) do update set units_per_usd = excluded.units_per_usd, created_at = now();
  return budget.finish_command(p_space, p_request, 'set_reference_rate', v_payload, jsonb_build_object('ok', true));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: only signed-in users may call commands; nothing else is public
-- ---------------------------------------------------------------------------

revoke all on all functions in schema budget from public, anon, authenticated, service_role;

revoke all on function public.create_space(uuid, text, bigint, text, boolean, date) from public, anon, service_role;
revoke all on function public.create_wallet(uuid, uuid, text, text, text, bigint, date, text, text) from public, anon, service_role;
revoke all on function public.update_wallet(uuid, uuid, uuid, text, boolean) from public, anon, service_role;
revoke all on function public.assign_money(uuid, uuid, date, jsonb, boolean, text) from public, anon, service_role;
revoke all on function public.record_income(uuid, uuid, uuid, bigint, date, text, uuid) from public, anon, service_role;
revoke all on function public.record_expense(uuid, uuid, uuid, uuid, bigint, date, text, uuid, uuid, date) from public, anon, service_role;
revoke all on function public.record_refund(uuid, uuid, uuid, uuid, bigint, date, text) from public, anon, service_role;
revoke all on function public.record_transfer(uuid, uuid, uuid, uuid, bigint, date, text) from public, anon, service_role;
revoke all on function public.record_exchange(uuid, uuid, uuid, bigint, uuid, bigint, date, uuid, text) from public, anon, service_role;
revoke all on function public.record_investment(uuid, uuid, text, uuid, bigint, date, uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.record_loan(uuid, uuid, text, uuid, date, bigint, bigint, bigint, uuid, uuid, uuid, text, uuid, date) from public, anon, service_role;
revoke all on function public.reverse_entry(uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.save_bill(uuid, uuid, text, uuid, bigint, text, text, date, date, uuid, uuid, boolean) from public, anon, service_role;
revoke all on function public.skip_bill(uuid, uuid, uuid, date) from public, anon, service_role;
revoke all on function public.set_reference_rate(uuid, uuid, text, numeric, date) from public, anon, service_role;

grant execute on function public.create_space(uuid, text, bigint, text, boolean, date) to authenticated;
grant execute on function public.create_wallet(uuid, uuid, text, text, text, bigint, date, text, text) to authenticated;
grant execute on function public.update_wallet(uuid, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.assign_money(uuid, uuid, date, jsonb, boolean, text) to authenticated;
grant execute on function public.record_income(uuid, uuid, uuid, bigint, date, text, uuid) to authenticated;
grant execute on function public.record_expense(uuid, uuid, uuid, uuid, bigint, date, text, uuid, uuid, date) to authenticated;
grant execute on function public.record_refund(uuid, uuid, uuid, uuid, bigint, date, text) to authenticated;
grant execute on function public.record_transfer(uuid, uuid, uuid, uuid, bigint, date, text) to authenticated;
grant execute on function public.record_exchange(uuid, uuid, uuid, bigint, uuid, bigint, date, uuid, text) to authenticated;
grant execute on function public.record_investment(uuid, uuid, text, uuid, bigint, date, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.record_loan(uuid, uuid, text, uuid, date, bigint, bigint, bigint, uuid, uuid, uuid, text, uuid, date) to authenticated;
grant execute on function public.reverse_entry(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_bill(uuid, uuid, text, uuid, bigint, text, text, date, date, uuid, uuid, boolean) to authenticated;
grant execute on function public.skip_bill(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.set_reference_rate(uuid, uuid, text, numeric, date) to authenticated;
