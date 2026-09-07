create or replace function public.record_financial_event(
  p_space_id uuid,
  p_request_id uuid,
  p_kind public.financial_event_kind,
  p_effective_date date,
  p_movements jsonb
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_existing_fingerprint bytea;
  v_fingerprint bytea;
  v_input_count integer;
  v_valid_count integer;
  v_wallet_count integer;
  v_distinct_wallet_count integer;
  v_amount_total bigint;
  v_all_positive boolean;
  v_all_negative boolean;
  v_currency_count integer;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if jsonb_typeof(p_movements) <> 'array'
    or jsonb_array_length(p_movements) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'movements must contain between one and twenty entries';
  end if;

  v_fingerprint := extensions.digest(
    p_kind::text || '|' || p_effective_date::text || '|' || p_movements::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.request_fingerprint, event.id
  into v_existing_fingerprint, v_event_id
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  with movement_input as (
    select
      case
        when jsonb_typeof(entry) = 'object'
          and jsonb_typeof(entry -> 'walletId') = 'string'
          and (entry ->> 'walletId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (entry ->> 'walletId')::uuid
      end as wallet_id,
      case
        when jsonb_typeof(entry) = 'object'
          and jsonb_typeof(entry -> 'amountMinor') = 'string'
          and (entry ->> 'amountMinor') ~ '^-?[1-9][0-9]{0,14}$'
        then (entry ->> 'amountMinor')::bigint
      end as amount_minor
    from jsonb_array_elements(p_movements) as entry
  )
  select
    count(*),
    count(*) filter (where input.wallet_id is not null and input.amount_minor is not null),
    count(wallet.id),
    count(distinct input.wallet_id),
    coalesce(sum(input.amount_minor), 0),
    bool_and(input.amount_minor > 0),
    bool_and(input.amount_minor < 0),
    count(distinct wallet.currency)
  into
    v_input_count,
    v_valid_count,
    v_wallet_count,
    v_distinct_wallet_count,
    v_amount_total,
    v_all_positive,
    v_all_negative,
    v_currency_count
  from movement_input as input
  left join public.wallets as wallet
    on wallet.id = input.wallet_id
   and wallet.space_id = p_space_id
   and wallet.archived_at is null;

  if v_valid_count <> v_input_count
    or v_wallet_count <> v_input_count
    or v_distinct_wallet_count <> v_input_count then
    raise exception using
      errcode = 'P0001',
      message = 'every movement must contain a unique active wallet and a bounded nonzero minor-unit amount';
  end if;

  if (p_kind = 'opening_balance' and not (v_input_count = 1 and v_all_positive))
    or (p_kind = 'income' and not v_all_positive)
    or (p_kind = 'expense' and not v_all_negative)
    or (p_kind = 'transfer' and not (v_input_count >= 2 and v_amount_total = 0 and v_currency_count = 1))
    or p_kind not in ('opening_balance', 'income', 'expense', 'transfer') then
    raise exception using errcode = 'P0001', message = 'the requested event kind has an invalid movement shape';
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (p_space_id, p_request_id, v_fingerprint, p_kind, p_effective_date, v_actor_id)
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
