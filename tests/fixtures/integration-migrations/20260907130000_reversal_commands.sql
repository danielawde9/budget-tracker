create function public.reverse_financial_event(
  p_space_id uuid,
  p_request_id uuid,
  p_event_id uuid,
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
  v_fingerprint bytea := extensions.digest(
    'reversal|' || p_event_id::text || '|' || p_effective_date::text,
    'sha256'
  );
  v_original_kind public.financial_event_kind;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using
      errcode = '42501',
      message = 'an active space membership is required';
  end if;

  select event.id, event.request_fingerprint
  into v_event_id, v_existing_fingerprint
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  select event.kind
  into v_original_kind
  from public.financial_events as event
  where event.id = p_event_id
    and event.space_id = p_space_id
  for update;

  if not found or v_original_kind = 'reversal' then
    raise exception using
      errcode = 'P0001',
      message = 'the requested event cannot be reversed';
  end if;

  if exists (
    select 1
    from public.financial_events as event
    where event.reversal_of = p_event_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'the requested event already has a reversal';
  end if;

  insert into public.financial_events (
    space_id,
    request_id,
    request_fingerprint,
    kind,
    effective_date,
    actor_id,
    reversal_of
  )
  values (
    p_space_id,
    p_request_id,
    v_fingerprint,
    'reversal',
    p_effective_date,
    v_actor_id,
    p_event_id
  )
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  select
    v_event_id,
    p_space_id,
    movement.wallet_id,
    -movement.amount_minor
  from public.wallet_movements as movement
  where movement.event_id = p_event_id;

  return query select v_event_id;
end;
$$;

revoke all on function public.reverse_financial_event(uuid, uuid, uuid, date) from public;
grant execute on function public.reverse_financial_event(uuid, uuid, uuid, date) to authenticated;
