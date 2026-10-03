create function public.record_cash_loan(
  p_space_id uuid,
  p_request_id uuid,
  p_direction public.loan_direction,
  p_person_name text,
  p_currency public.currency_code,
  p_wallet_id uuid,
  p_amount_minor text,
  p_effective_date date,
  p_due_date date default null,
  p_note text default null
)
returns table (loan_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_amount_minor bigint;
  v_wallet_currency public.currency_code;
  v_kind public.financial_event_kind;
  v_wallet_delta bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_loan_id uuid;
  v_existing_event_id uuid;
  v_loan_id uuid;
  v_event_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if char_length(btrim(p_person_name)) not between 1 and 120
    or (p_note is not null and char_length(p_note) > 2_000)
    or (p_due_date is not null and p_due_date < p_effective_date) then
    raise exception using errcode = 'P0001', message = 'the loan details are invalid';
  end if;

  v_amount_minor := private.parse_positive_minor_amount(p_amount_minor);

  select wallet.currency
  into v_wallet_currency
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null;

  if not found or v_wallet_currency <> p_currency then
    raise exception using errcode = 'P0001', message = 'the wallet must be active, in the requested space, and in the loan currency';
  end if;

  if p_direction = 'they_owe_me' then
    v_kind := 'loan_lend';
    v_wallet_delta := -v_amount_minor;
  else
    v_kind := 'loan_borrow';
    v_wallet_delta := v_amount_minor;
  end if;

  v_fingerprint := extensions.digest(
    'cash_loan|' || p_direction::text || '|' || btrim(p_person_name) || '|'
      || p_currency::text || '|' || p_wallet_id::text || '|' || p_amount_minor || '|'
      || p_effective_date::text || '|' || coalesce(p_due_date::text, '') || '|'
      || coalesce(p_note, ''),
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.request_fingerprint, posting.loan_id, event.id
  into v_existing_fingerprint, v_existing_loan_id, v_existing_event_id
  from public.financial_events as event
  left join public.loan_postings as posting on posting.event_id = event.id
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint or v_existing_loan_id is null then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_loan_id, v_existing_event_id;
    return;
  end if;

  insert into public.loans (
    space_id, direction, person_name, currency, effective_date, due_date, note, actor_id
  )
  values (
    p_space_id, p_direction, btrim(p_person_name), p_currency, p_effective_date,
    p_due_date, p_note, v_actor_id
  )
  returning id into v_loan_id;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (p_space_id, p_request_id, v_fingerprint, v_kind, p_effective_date, v_actor_id)
  returning id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  values (v_event_id, p_space_id, p_wallet_id, v_wallet_delta);

  insert into public.loan_postings (event_id, loan_id, space_id, principal_delta_minor)
  values (v_event_id, v_loan_id, p_space_id, v_amount_minor);

  return query select v_loan_id, v_event_id;
end;
$$;

create function public.record_loan_repayment(
  p_space_id uuid,
  p_request_id uuid,
  p_loan_id uuid,
  p_wallet_id uuid,
  p_amount_minor text,
  p_effective_date date
)
returns table (event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_direction public.loan_direction;
  v_currency public.currency_code;
  v_wallet_currency public.currency_code;
  v_amount_minor bigint;
  v_outstanding_minor bigint;
  v_kind public.financial_event_kind;
  v_wallet_delta bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_event_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  v_amount_minor := private.parse_positive_minor_amount(p_amount_minor);
  perform private.lock_financial_request(p_space_id, p_request_id);

  select loan.direction, loan.currency
  into v_direction, v_currency
  from public.loans as loan
  where loan.id = p_loan_id
    and loan.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the loan does not belong to the requested space';
  end if;

  if v_direction = 'they_owe_me' then
    v_kind := 'loan_receive_repayment';
    v_wallet_delta := v_amount_minor;
  else
    v_kind := 'loan_repay_borrowing';
    v_wallet_delta := -v_amount_minor;
  end if;

  v_fingerprint := extensions.digest(
    'loan_repayment|' || p_loan_id::text || '|' || p_wallet_id::text || '|'
      || p_amount_minor || '|' || p_effective_date::text,
    'sha256'
  );

  select event.request_fingerprint, event.id
  into v_existing_fingerprint, v_existing_event_id
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_event_id;
    return;
  end if;

  select wallet.currency
  into v_wallet_currency
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null;

  if not found or v_wallet_currency <> v_currency then
    raise exception using errcode = 'P0001', message = 'the wallet must be active, in the requested space, and in the loan currency';
  end if;

  select coalesce(sum(posting.principal_delta_minor), 0)
  into v_outstanding_minor
  from public.loan_postings as posting
  where posting.loan_id = p_loan_id;

  if v_amount_minor > v_outstanding_minor then
    raise exception using errcode = 'P0001', message = 'the repayment exceeds the outstanding principal';
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (p_space_id, p_request_id, v_fingerprint, v_kind, p_effective_date, v_actor_id)
  returning id into v_existing_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  values (v_existing_event_id, p_space_id, p_wallet_id, v_wallet_delta);

  insert into public.loan_postings (
    event_id, loan_id, space_id, principal_delta_minor, repayment_effect_minor
  )
  values (v_existing_event_id, p_loan_id, p_space_id, -v_amount_minor, v_amount_minor);

  return query select v_existing_event_id;
end;
$$;

revoke all on function public.record_cash_loan(
  uuid, uuid, public.loan_direction, text, public.currency_code, uuid, text, date, date, text
) from public;
revoke all on function public.record_loan_repayment(uuid, uuid, uuid, uuid, text, date) from public;
grant execute on function public.record_cash_loan(
  uuid, uuid, public.loan_direction, text, public.currency_code, uuid, text, date, date, text
) to authenticated;
grant execute on function public.record_loan_repayment(uuid, uuid, uuid, uuid, text, date) to authenticated;
