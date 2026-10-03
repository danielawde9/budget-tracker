-- A currency exchange is one immutable event with two linked wallet movements.
-- It is deliberately separate from generic same-currency transfers and from
-- income/expense posting, whose movement shapes have different meaning.

alter type public.financial_event_kind add value if not exists 'exchange';

create function public.record_usd_to_lbp_exchange(
  p_space_id uuid,
  p_request_id uuid,
  p_usd_wallet_id uuid,
  p_lbp_wallet_id uuid,
  p_usd_amount_minor text,
  p_lbp_amount_minor text,
  p_effective_date date
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
  v_usd_wallet public.wallets;
  v_lbp_wallet public.wallets;
  v_usd_amount_minor bigint;
  v_lbp_amount_minor bigint;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_request_id is null
    or p_usd_wallet_id is null
    or p_lbp_wallet_id is null
    or p_effective_date is null
    or p_usd_amount_minor is null
    or p_lbp_amount_minor is null then
    raise exception using errcode = 'P0001', message = 'exchange request, wallets, amounts, and effective date are required';
  end if;

  if p_usd_wallet_id = p_lbp_wallet_id
    or p_usd_amount_minor !~ '^[1-9][0-9]{0,14}$'
    or p_lbp_amount_minor !~ '^[1-9][0-9]{0,14}$' then
    raise exception using errcode = 'P0001', message = 'exchange wallets must differ and amounts must be bounded positive minor-unit integers';
  end if;

  v_usd_amount_minor := p_usd_amount_minor::bigint;
  v_lbp_amount_minor := p_lbp_amount_minor::bigint;
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'usd_to_lbp_exchange',
      'usdWalletId', p_usd_wallet_id,
      'lbpWalletId', p_lbp_wallet_id,
      'usdAmountMinor', p_usd_amount_minor,
      'lbpAmountMinor', p_lbp_amount_minor,
      'effectiveDate', p_effective_date
    )::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.id, event.request_fingerprint
  into v_event_id, v_existing_fingerprint
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  select wallet.*
  into v_usd_wallet
  from public.wallets as wallet
  where wallet.id = p_usd_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null
  for update;

  select wallet.*
  into v_lbp_wallet
  from public.wallets as wallet
  where wallet.id = p_lbp_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null
  for update;

  if v_usd_wallet.id is null
    or v_lbp_wallet.id is null
    or v_usd_wallet.currency <> 'USD'
    or v_lbp_wallet.currency <> 'LBP' then
    raise exception using errcode = 'P0001', message = 'the exchange requires active USD source and LBP destination wallets in the requested space';
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (
    p_space_id, p_request_id, v_fingerprint, 'exchange', p_effective_date, v_actor_id
  )
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  values
    (v_event_id, p_space_id, p_usd_wallet_id, -v_usd_amount_minor),
    (v_event_id, p_space_id, p_lbp_wallet_id, v_lbp_amount_minor);

  return query select v_event_id;
end;
$$;

revoke all on function public.record_usd_to_lbp_exchange(uuid, uuid, uuid, uuid, text, text, date)
from public, anon, authenticated, service_role;

grant execute on function public.record_usd_to_lbp_exchange(uuid, uuid, uuid, uuid, text, text, date)
to authenticated;
