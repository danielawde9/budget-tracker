-- Budget v2 core: a two-sided journal.
--
-- Every entry records WHERE money is (wallet_lines) and WHAT IT IS FOR
-- (item_lines) at once. For each entry and currency, the lines on spending
-- ("cash") wallets must equal the purpose lines, so
--   cash held = Ready to assign + sum of plan-item balances
-- holds by construction. Investment and loan wallets sit outside spendable
-- cash and carry no purpose lines of their own.
--
-- The browser never touches these tables: there are no grants on schema
-- `budget`, and every table has row-level security with no policies, so a
-- leaked grant still shows nothing. All writes go through SECURITY DEFINER
-- commands (later migrations), and the deferred constraint triggers below
-- re-check the invariants at commit even if a command has a bug.

create schema budget;
revoke all on schema budget from public;

create type budget.currency as enum ('USD', 'LBP');
create type budget.wallet_kind as enum ('cash', 'investment', 'loan');
create type budget.loan_direction as enum ('i_owe', 'owed_to_me');
create type budget.item_kind as enum ('ready', 'spending', 'reserve', 'goal', 'flex', 'loan_payment');
create type budget.entry_kind as enum (
  'opening_balance', 'opening_assign', 'income', 'assign', 'expense', 'refund', 'transfer', 'exchange',
  'invest', 'invest_withdraw', 'invest_value', 'invest_fee', 'invest_income',
  'loan_borrow', 'loan_repay', 'loan_lend', 'loan_collect', 'loan_opening', 'reversal'
);
create type budget.flow as enum (
  'opening', 'income', 'other_income', 'fund', 'release', 'move', 'cover', 'spend', 'refund',
  'transfer', 'exchange', 'invest', 'withdraw', 'value', 'fee',
  'borrow', 'principal', 'interest', 'lend', 'collect'
);

-- ---------------------------------------------------------------------------
-- Spaces and membership
-- ---------------------------------------------------------------------------

create table budget.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  timezone text not null default 'Asia/Beirut',
  plan_currency budget.currency not null default 'USD',
  created_by uuid not null references auth.users (id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (created_by, request_id)
);

create table budget.space_members (
  space_id uuid not null references budget.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index space_members_user on budget.space_members (user_id);

create table budget.command_receipts (
  space_id uuid not null references budget.spaces (id),
  request_id uuid not null,
  command text not null,
  request_hash text not null,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id)
);

create table budget.reference_rates (
  space_id uuid not null references budget.spaces (id) on delete cascade,
  currency budget.currency not null check (currency <> 'USD'),
  effective_on date not null,
  units_per_usd numeric(18, 6) not null check (units_per_usd > 0),
  created_at timestamptz not null default now(),
  primary key (space_id, currency, effective_on)
);

-- ---------------------------------------------------------------------------
-- Where money is: wallets (spending cash), investment accounts, loans
-- ---------------------------------------------------------------------------

create table budget.wallets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind budget.wallet_kind not null,
  currency budget.currency not null,
  loan_direction budget.loan_direction,
  counterparty text check (counterparty is null or char_length(btrim(counterparty)) between 1 and 60),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'loan') = (loan_direction is not null)),
  unique (id, space_id),
  unique (id, space_id, currency)
);
create index wallets_space on budget.wallets (space_id);

-- ---------------------------------------------------------------------------
-- What money is for: plan groups and items (Ready to assign is an item too)
-- ---------------------------------------------------------------------------

create table budget.plan_groups (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id),
  name_en text check (name_en is null or char_length(btrim(name_en)) between 1 and 60),
  name_ar text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 60),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (name_en is not null or name_ar is not null),
  unique (id, space_id)
);
create index plan_groups_space on budget.plan_groups (space_id);

create table budget.items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id),
  group_id uuid,
  kind budget.item_kind not null,
  name_en text check (name_en is null or char_length(btrim(name_en)) between 1 and 60),
  name_ar text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 60),
  target_minor bigint check (target_minor is null or target_minor between 1 and 1000000000000000),
  target_date date,
  wallet_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (name_en is not null or name_ar is not null),
  check ((kind = 'ready') = (group_id is null)),
  check (target_minor is null or kind in ('reserve', 'goal')),
  check (target_date is null or kind in ('reserve', 'goal')),
  check (wallet_id is null or kind in ('flex', 'loan_payment')),
  foreign key (group_id, space_id) references budget.plan_groups (id, space_id),
  foreign key (wallet_id, space_id) references budget.wallets (id, space_id),
  unique (id, space_id)
);
create unique index items_one_ready_per_space on budget.items (space_id) where kind = 'ready';
create unique index items_one_flex_per_group on budget.items (group_id) where kind = 'flex' and archived_at is null;
create index items_space on budget.items (space_id);

-- ---------------------------------------------------------------------------
-- The plan: intentions only, effective-dated by month
-- ---------------------------------------------------------------------------

create table budget.plan_versions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id),
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  expected_income_minor bigint not null check (expected_income_minor between 0 and 1000000000000000),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  unique (space_id, effective_month),
  unique (id, space_id)
);

create table budget.plan_version_groups (
  version_id uuid not null,
  space_id uuid not null,
  group_id uuid not null,
  percent_bps integer not null check (percent_bps between 0 and 10000),
  position integer not null check (position >= 0),
  primary key (version_id, group_id),
  unique (version_id, position) deferrable initially deferred,
  foreign key (version_id, space_id) references budget.plan_versions (id, space_id) on delete cascade,
  foreign key (group_id, space_id) references budget.plan_groups (id, space_id)
);

create table budget.plan_version_items (
  version_id uuid not null,
  space_id uuid not null,
  item_id uuid not null,
  group_id uuid not null,
  monthly_minor bigint not null check (monthly_minor between 0 and 1000000000000000),
  position integer not null check (position >= 0),
  primary key (version_id, item_id),
  foreign key (version_id, group_id) references budget.plan_version_groups (version_id, group_id) on delete cascade,
  foreign key (item_id, space_id) references budget.items (id, space_id)
);

-- ---------------------------------------------------------------------------
-- Bills: schedules that read their item's balance; they never hold money
-- ---------------------------------------------------------------------------

create table budget.bills (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id),
  item_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  currency budget.currency not null,
  cadence text not null check (cadence in ('monthly', 'yearly', 'once')),
  first_due_on date not null,
  end_on date check (end_on is null or end_on >= first_due_on),
  loan_wallet_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (item_id, space_id) references budget.items (id, space_id),
  foreign key (loan_wallet_id, space_id) references budget.wallets (id, space_id),
  unique (id, space_id)
);
create index bills_space on budget.bills (space_id);

create table budget.bill_skips (
  bill_id uuid not null,
  space_id uuid not null,
  due_on date not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (bill_id, due_on),
  foreign key (bill_id, space_id) references budget.bills (id, space_id)
);

-- ---------------------------------------------------------------------------
-- The journal (append-only)
-- ---------------------------------------------------------------------------

create table budget.entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id),
  kind budget.entry_kind not null,
  occurred_on date not null check (occurred_on >= date '2000-01-01'),
  memo text check (memo is null or char_length(memo) <= 200),
  request_id uuid not null,
  reverses_entry_id uuid unique references budget.entries (id),
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 200),
  bill_id uuid,
  bill_due_on date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (space_id, request_id),
  unique (id, space_id),
  check ((kind = 'reversal') = (reverses_entry_id is not null)),
  check ((bill_id is null) = (bill_due_on is null)),
  foreign key (bill_id, space_id) references budget.bills (id, space_id)
);
create index entries_space_date on budget.entries (space_id, occurred_on desc, created_at desc, id desc);
create index entries_bill on budget.entries (bill_id, bill_due_on) where bill_id is not null;

create table budget.wallet_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  space_id uuid not null,
  wallet_id uuid not null,
  currency budget.currency not null,
  amount_minor bigint not null check (amount_minor <> 0 and amount_minor between -1000000000000000 and 1000000000000000),
  flow budget.flow not null,
  foreign key (entry_id, space_id) references budget.entries (id, space_id),
  foreign key (wallet_id, space_id, currency) references budget.wallets (id, space_id, currency)
);
create index wallet_lines_wallet on budget.wallet_lines (wallet_id);
create index wallet_lines_entry on budget.wallet_lines (entry_id);

create table budget.item_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  space_id uuid not null,
  item_id uuid not null,
  currency budget.currency not null,
  amount_minor bigint not null check (amount_minor <> 0 and amount_minor between -1000000000000000 and 1000000000000000),
  flow budget.flow not null,
  foreign key (entry_id, space_id) references budget.entries (id, space_id),
  foreign key (item_id, space_id) references budget.items (id, space_id)
);
create index item_lines_item on budget.item_lines (item_id, currency);
create index item_lines_entry on budget.item_lines (entry_id);

-- ---------------------------------------------------------------------------
-- Invariant triggers
--
-- Trigger functions are SECURITY DEFINER: deferred checks run at COMMIT as
-- whatever role is current, and they must always see every line.
-- ---------------------------------------------------------------------------

create function budget.raise_budget(p_code text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail::text;
end;
$$;

-- Σ cash-wallet lines = Σ purpose lines, per currency, for one entry.
create function budget.check_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency budget.currency;
  v_wallet_total numeric;
  v_item_total numeric;
begin
  select coalesce(w.currency, i.currency), coalesce(w.total, 0), coalesce(i.total, 0)
    into v_currency, v_wallet_total, v_item_total
  from (
    select wl.currency, sum(wl.amount_minor) as total
    from budget.wallet_lines wl
    join budget.wallets wa on wa.id = wl.wallet_id
    where wl.entry_id = new.entry_id and wa.kind = 'cash'
    group by wl.currency
  ) w
  full join (
    select il.currency, sum(il.amount_minor) as total
    from budget.item_lines il
    where il.entry_id = new.entry_id
    group by il.currency
  ) i on i.currency = w.currency
  where coalesce(w.total, 0) <> coalesce(i.total, 0)
  limit 1;
  if found then
    perform budget.raise_budget('BUDGET_UNBALANCED_ENTRY', jsonb_build_object(
      'entryId', new.entry_id, 'currency', v_currency, 'wallets', v_wallet_total, 'purposes', v_item_total));
  end if;
  return null;
end;
$$;

create constraint trigger wallet_lines_balanced
  after insert on budget.wallet_lines
  deferrable initially deferred
  for each row execute function budget.check_entry_balanced();

create constraint trigger item_lines_balanced
  after insert on budget.item_lines
  deferrable initially deferred
  for each row execute function budget.check_entry_balanced();

create function budget.check_entry_has_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from budget.wallet_lines where entry_id = new.id)
     and not exists (select 1 from budget.item_lines where entry_id = new.id) then
    perform budget.raise_budget('BUDGET_EMPTY_ENTRY', jsonb_build_object('entryId', new.id));
  end if;
  return null;
end;
$$;

create constraint trigger entries_have_lines
  after insert on budget.entries
  deferrable initially deferred
  for each row execute function budget.check_entry_has_lines();

-- Plan items (everything except Ready to assign) never hold less than zero.
create function budget.check_item_nonnegative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind budget.item_kind;
  v_balance numeric;
begin
  select kind into v_kind from budget.items where id = new.item_id;
  if v_kind = 'ready' then
    return null;
  end if;
  select coalesce(sum(amount_minor), 0) into v_balance
  from budget.item_lines
  where item_id = new.item_id and currency = new.currency;
  if v_balance < 0 then
    perform budget.raise_budget('BUDGET_ITEM_NEGATIVE', jsonb_build_object(
      'itemId', new.item_id, 'currency', new.currency, 'balance', v_balance));
  end if;
  return null;
end;
$$;

create constraint trigger item_lines_nonnegative
  after insert on budget.item_lines
  deferrable initially deferred
  for each row execute function budget.check_item_nonnegative();

-- Investments are never negative; a debt I owe never turns positive; money
-- owed to me never turns negative. Spending wallets may go negative (cards).
create function budget.check_wallet_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind budget.wallet_kind;
  v_direction budget.loan_direction;
  v_balance numeric;
begin
  select kind, loan_direction into v_kind, v_direction from budget.wallets where id = new.wallet_id;
  if v_kind = 'cash' then
    return null;
  end if;
  select coalesce(sum(amount_minor), 0) into v_balance from budget.wallet_lines where wallet_id = new.wallet_id;
  if (v_kind = 'investment' and v_balance < 0)
     or (v_direction = 'i_owe' and v_balance > 0)
     or (v_direction = 'owed_to_me' and v_balance < 0) then
    perform budget.raise_budget('BUDGET_WALLET_BOUNDS', jsonb_build_object(
      'walletId', new.wallet_id, 'balance', v_balance));
  end if;
  return null;
end;
$$;

create constraint trigger wallet_lines_bounds
  after insert on budget.wallet_lines
  deferrable initially deferred
  for each row execute function budget.check_wallet_bounds();

-- A reversal negates every line of its original, nothing more or less.
create function budget.check_reversal_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original budget.entries%rowtype;
begin
  if new.kind <> 'reversal' then
    return null;
  end if;
  select * into v_original from budget.entries where id = new.reverses_entry_id;
  if not found or v_original.kind = 'reversal' or v_original.space_id <> new.space_id then
    perform budget.raise_budget('BUDGET_BAD_REVERSAL', jsonb_build_object('entryId', new.id));
  end if;
  if exists (
    (select wallet_id, currency, flow, amount_minor from budget.wallet_lines where entry_id = v_original.id
     except all
     select wallet_id, currency, flow, -amount_minor from budget.wallet_lines where entry_id = new.id)
    union all
    (select wallet_id, currency, flow, -amount_minor from budget.wallet_lines where entry_id = new.id
     except all
     select wallet_id, currency, flow, amount_minor from budget.wallet_lines where entry_id = v_original.id)
  ) or exists (
    (select item_id, currency, flow, amount_minor from budget.item_lines where entry_id = v_original.id
     except all
     select item_id, currency, flow, -amount_minor from budget.item_lines where entry_id = new.id)
    union all
    (select item_id, currency, flow, -amount_minor from budget.item_lines where entry_id = new.id
     except all
     select item_id, currency, flow, amount_minor from budget.item_lines where entry_id = v_original.id)
  ) then
    perform budget.raise_budget('BUDGET_BAD_REVERSAL', jsonb_build_object('entryId', new.id));
  end if;
  return null;
end;
$$;

create constraint trigger entries_reversal_mirror
  after insert on budget.entries
  deferrable initially deferred
  for each row execute function budget.check_reversal_mirror();

create function budget.check_plan_percent_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
begin
  select coalesce(sum(percent_bps), 0) into v_total from budget.plan_version_groups where version_id = new.version_id;
  if v_total > 10000 then
    perform budget.raise_budget('BUDGET_PLAN_OVER_100', jsonb_build_object('versionId', new.version_id, 'bps', v_total));
  end if;
  return null;
end;
$$;

create constraint trigger plan_version_groups_total
  after insert or update on budget.plan_version_groups
  deferrable initially deferred
  for each row execute function budget.check_plan_percent_total();

-- Planned lines name a real plan item of the same group; the flexible
-- item's amount is derived (group amount − other items), never stored.
create function budget.check_plan_item_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from budget.items i
    where i.id = new.item_id
      and i.space_id = new.space_id
      and i.group_id = new.group_id
      and i.kind not in ('ready', 'flex')
  ) then
    perform budget.raise_budget('BUDGET_PLAN_ITEM_INVALID', jsonb_build_object('itemId', new.item_id));
  end if;
  return new;
end;
$$;

create trigger plan_version_items_group
  before insert or update on budget.plan_version_items
  for each row execute function budget.check_plan_item_group();

create function budget.check_space_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    perform budget.raise_budget('BUDGET_INVALID_TIMEZONE', jsonb_build_object('timezone', new.timezone));
  end if;
  return new;
end;
$$;

create trigger spaces_timezone
  before insert or update of timezone on budget.spaces
  for each row execute function budget.check_space_timezone();

-- Statement-level so a zero-row DELETE and TRUNCATE are refused too.
create function budget.reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform budget.raise_budget('BUDGET_APPEND_ONLY', jsonb_build_object('table', tg_table_name, 'operation', tg_op));
  return null;
end;
$$;

create trigger entries_append_only
  before update or delete or truncate on budget.entries
  for each statement execute function budget.reject_mutation();
create trigger wallet_lines_append_only
  before update or delete or truncate on budget.wallet_lines
  for each statement execute function budget.reject_mutation();
create trigger item_lines_append_only
  before update or delete or truncate on budget.item_lines
  for each statement execute function budget.reject_mutation();
create trigger command_receipts_append_only
  before update or delete or truncate on budget.command_receipts
  for each statement execute function budget.reject_mutation();
create trigger bill_skips_append_only
  before update or delete or truncate on budget.bill_skips
  for each statement execute function budget.reject_mutation();

-- ---------------------------------------------------------------------------
-- Privileges: nothing in `budget` is reachable from the browser roles
-- ---------------------------------------------------------------------------

alter table budget.spaces enable row level security;
alter table budget.space_members enable row level security;
alter table budget.command_receipts enable row level security;
alter table budget.reference_rates enable row level security;
alter table budget.wallets enable row level security;
alter table budget.plan_groups enable row level security;
alter table budget.items enable row level security;
alter table budget.plan_versions enable row level security;
alter table budget.plan_version_groups enable row level security;
alter table budget.plan_version_items enable row level security;
alter table budget.bills enable row level security;
alter table budget.bill_skips enable row level security;
alter table budget.entries enable row level security;
alter table budget.wallet_lines enable row level security;
alter table budget.item_lines enable row level security;

revoke all on all tables in schema budget from public, anon, authenticated, service_role;
revoke all on all sequences in schema budget from public, anon, authenticated, service_role;
revoke all on all functions in schema budget from public, anon, authenticated, service_role;
