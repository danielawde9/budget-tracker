create type public.currency_code as enum ('USD', 'LBP');
create type public.financial_event_kind as enum (
  'opening_balance',
  'income',
  'expense',
  'transfer',
  'reversal'
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  currency public.currency_code not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, space_id)
);

create index wallets_space_currency_idx
  on public.wallets (space_id, currency)
  where archived_at is null;

create table public.financial_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint bytea not null,
  kind public.financial_event_kind not null,
  effective_date date not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reversal_of uuid references public.financial_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (space_id, request_id),
  unique (id, space_id)
);

create unique index financial_events_one_reversal_idx
  on public.financial_events (reversal_of)
  where reversal_of is not null;

create index financial_events_space_date_idx
  on public.financial_events (space_id, effective_date desc, created_at desc);

create table public.wallet_movements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  space_id uuid not null,
  wallet_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  foreign key (event_id, space_id)
    references public.financial_events (id, space_id) on delete restrict,
  foreign key (wallet_id, space_id)
    references public.wallets (id, space_id) on delete restrict
);

create index wallet_movements_wallet_created_idx
  on public.wallet_movements (wallet_id, created_at desc);

create index wallet_movements_event_idx
  on public.wallet_movements (event_id);

create view public.wallet_balances
with (security_invoker = true)
as
select
  wallet.id as wallet_id,
  wallet.space_id,
  wallet.currency,
  coalesce(sum(movement.amount_minor), 0)::bigint as amount_minor
from public.wallets as wallet
left join public.wallet_movements as movement on movement.wallet_id = wallet.id
group by wallet.id, wallet.space_id, wallet.currency;

alter table public.wallets enable row level security;
alter table public.financial_events enable row level security;
alter table public.wallet_movements enable row level security;

create policy wallets_read_for_members
  on public.wallets
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create policy financial_events_read_for_members
  on public.financial_events
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create policy wallet_movements_read_for_members
  on public.wallet_movements
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create function public.create_wallet(
  p_space_id uuid,
  p_name text,
  p_currency public.currency_code
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_id uuid;
begin
  if not private.is_active_member(p_space_id) then
    raise exception using
      errcode = '42501',
      message = 'an active space membership is required';
  end if;

  insert into public.wallets (space_id, name, currency)
  values (p_space_id, btrim(p_name), p_currency)
  returning wallets.id into v_wallet_id;

  return query select v_wallet_id;
end;
$$;

create function public.record_financial_event(
  p_space_id uuid,
  p_request_id uuid,
  p_kind public.financial_event_kind,
  p_effective_date date,
  p_movements jsonb
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_existing_fingerprint bytea;
  v_fingerprint bytea;
  v_count integer;
  v_amount_total bigint;
  v_all_positive boolean;
  v_all_negative boolean;
  v_currency_count integer;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using
      errcode = '42501',
      message = 'an active space membership is required';
  end if;

  if jsonb_typeof(p_movements) <> 'array'
    or jsonb_array_length(p_movements) not between 1 and 20 then
    raise exception using
      errcode = 'P0001',
      message = 'movements must contain between one and twenty entries';
  end if;

  with movement_input as (
    select
      (entry ->> 'walletId')::uuid as wallet_id,
      (entry ->> 'amountMinor')::bigint as amount_minor
    from jsonb_array_elements(p_movements) as entry
  )
  select
    count(*),
    coalesce(sum(amount_minor), 0),
    bool_and(amount_minor > 0),
    bool_and(amount_minor < 0),
    count(distinct wallet.currency)
  into
    v_count,
    v_amount_total,
    v_all_positive,
    v_all_negative,
    v_currency_count
  from movement_input
  join public.wallets as wallet
    on wallet.id = movement_input.wallet_id
   and wallet.space_id = p_space_id
   and wallet.archived_at is null;

  if v_count <> jsonb_array_length(p_movements) then
    raise exception using
      errcode = 'P0001',
      message = 'every movement must reference an active wallet in the requested space';
  end if;

  if (p_kind = 'opening_balance' and not (v_count = 1 and v_all_positive))
    or (p_kind = 'income' and not v_all_positive)
    or (p_kind = 'expense' and not v_all_negative)
    or (p_kind = 'transfer' and not (v_count >= 2 and v_amount_total = 0 and v_currency_count = 1))
    or p_kind = 'reversal' then
    raise exception using
      errcode = 'P0001',
      message = 'the requested event kind has an invalid movement shape';
  end if;

  v_fingerprint := digest(
    p_kind::text || '|' || p_effective_date::text || '|' || p_movements::text,
    'sha256'
  );

  select event.request_fingerprint
  into v_existing_fingerprint
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'request ID was already used with different data';
    end if;

    return query
    select event.id
    from public.financial_events as event
    where event.space_id = p_space_id
      and event.request_id = p_request_id;
    return;
  end if;

  insert into public.financial_events (
    space_id,
    request_id,
    request_fingerprint,
    kind,
    effective_date,
    actor_id
  )
  values (
    p_space_id,
    p_request_id,
    v_fingerprint,
    p_kind,
    p_effective_date,
    v_actor_id
  )
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  select
    v_event_id,
    p_space_id,
    (entry ->> 'walletId')::uuid,
    (entry ->> 'amountMinor')::bigint
  from jsonb_array_elements(p_movements) as entry;

  return query select v_event_id;
end;
$$;

revoke all on table public.wallets, public.financial_events, public.wallet_movements from anon, authenticated;
grant select on table public.wallets, public.financial_events, public.wallet_movements to authenticated;
grant select on public.wallet_balances to authenticated;

revoke all on function public.create_wallet(uuid, text, public.currency_code) from public;
revoke all on function public.record_financial_event(
  uuid,
  uuid,
  public.financial_event_kind,
  date,
  jsonb
) from public;
grant execute on function public.create_wallet(uuid, text, public.currency_code) to authenticated;
grant execute on function public.record_financial_event(
  uuid,
  uuid,
  public.financial_event_kind,
  date,
  jsonb
) to authenticated;
