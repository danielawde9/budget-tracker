alter table public.categories
  add constraint categories_name_en_key_nonempty_check
    check (name_en_key is null or pg_catalog.btrim(name_en_key) <> ''),
  add constraint categories_name_ar_key_nonempty_check
    check (name_ar_key is null or pg_catalog.btrim(name_ar_key) <> '');

create trigger categories_reject_delete_statement
before delete on public.categories
for each statement execute function private.reject_category_history_mutation();

create trigger category_command_requests_reject_delete_statement
before delete on public.category_command_requests
for each statement execute function private.reject_category_history_mutation();

create trigger financial_event_categories_reject_delete_statement
before delete on public.financial_event_categories
for each statement execute function private.reject_category_history_mutation();

create or replace function public.create_category(
  p_space_id uuid,
  p_request_id uuid,
  p_kind public.category_kind,
  p_name_en text,
  p_name_ar text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_name_en text;
  v_name_ar text;
  v_fingerprint bytea;
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_category_id uuid;
  v_constraint_name text;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  v_name_en := private.canonical_category_name(p_name_en);
  v_name_ar := private.canonical_category_name(p_name_ar);

  if p_kind is null
    or (v_name_en is null and v_name_ar is null)
    or (v_name_en is not null and pg_catalog.char_length(v_name_en) > 120)
    or (v_name_ar is not null and pg_catalog.char_length(v_name_ar) > 120)
    or (v_name_en is not null and pg_catalog.btrim(private.english_category_key(v_name_en)) = '')
    or (v_name_ar is not null and pg_catalog.btrim(private.arabic_category_key(v_name_ar)) = '') then
    raise exception using errcode = 'P0001', message = 'a kind and at least one bounded searchable category name are required';
  end if;

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'create_category',
      'kind', p_kind::text,
      'nameEn', v_name_en,
      'nameAr', v_name_ar
    )::text,
    'sha256'
  );

  select request.command_kind, request.request_fingerprint, request.category_id
  into v_existing_kind, v_existing_fingerprint, v_category_id
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id;

  if found then
    if v_existing_kind is distinct from 'create_category'
      or v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_category_id;
    return;
  end if;

  begin
    insert into public.categories (space_id, kind, name_en, name_ar, created_by)
    values (p_space_id, p_kind, v_name_en, v_name_ar, v_actor_id)
    returning categories.id into v_category_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name in ('categories_active_name_en_idx', 'categories_active_name_ar_idx') then
        raise exception using
          errcode = 'P0001',
          message = 'an active category already uses one of the supplied normalized names';
      end if;
      raise;
  end;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'create_category', v_fingerprint, v_category_id, v_actor_id
  );

  return query select v_category_id;
end;
$$;

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

  if p_kind is null or p_effective_date is null or p_movements is null then
    raise exception using errcode = 'P0001', message = 'event kind, effective date, and movements are required';
  end if;

  if pg_catalog.jsonb_typeof(p_movements) <> 'array'
    or pg_catalog.jsonb_array_length(p_movements) not between 1 and 20 then
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
    if v_existing_fingerprint is distinct from v_fingerprint
      or exists (
        select 1
        from public.financial_event_categories as category
        where category.event_id = v_event_id
      ) then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  with movement_input as (
    select
      case
        when pg_catalog.jsonb_typeof(entry) = 'object'
          and pg_catalog.jsonb_typeof(entry -> 'walletId') = 'string'
          and (entry ->> 'walletId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (entry ->> 'walletId')::uuid
      end as wallet_id,
      case
        when pg_catalog.jsonb_typeof(entry) = 'object'
          and pg_catalog.jsonb_typeof(entry -> 'amountMinor') = 'string'
          and (entry ->> 'amountMinor') ~ '^-?[1-9][0-9]{0,14}$'
        then (entry ->> 'amountMinor')::bigint
      end as amount_minor
    from pg_catalog.jsonb_array_elements(p_movements) as entry
  )
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where input.wallet_id is not null and input.amount_minor is not null),
    pg_catalog.count(wallet.id),
    pg_catalog.count(distinct input.wallet_id),
    coalesce(pg_catalog.sum(input.amount_minor), 0),
    pg_catalog.bool_and(input.amount_minor > 0),
    pg_catalog.bool_and(input.amount_minor < 0),
    pg_catalog.count(distinct wallet.currency)
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
  from pg_catalog.jsonb_array_elements(p_movements) as entry;

  return query select v_event_id;
end;
$$;

create or replace function public.record_categorized_financial_event(
  p_space_id uuid,
  p_request_id uuid,
  p_kind public.financial_event_kind,
  p_effective_date date,
  p_movements jsonb,
  p_category_id uuid
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
  v_existing_category_id uuid;
  v_category_kind public.category_kind;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_kind is null or p_effective_date is null or p_movements is null or p_category_id is null then
    raise exception using errcode = 'P0001', message = 'event kind, effective date, movements, and category are required';
  end if;

  if p_kind not in ('income', 'expense') then
    raise exception using errcode = 'P0001', message = 'only income and expense events may be categorized';
  end if;

  if pg_catalog.jsonb_typeof(p_movements) <> 'array'
    or pg_catalog.jsonb_array_length(p_movements) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'movements must contain between one and twenty entries';
  end if;

  v_fingerprint := extensions.digest(
    p_kind::text || '|' || p_effective_date::text || '|' || p_movements::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.id, event.request_fingerprint, category.category_id
  into v_event_id, v_existing_fingerprint, v_existing_category_id
  from public.financial_events as event
  left join public.financial_event_categories as category on category.event_id = event.id
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint
      or v_existing_category_id is distinct from p_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  select category.kind
  into v_category_kind
  from public.categories as category
  where category.id = p_category_id
    and category.space_id = p_space_id
    and category.kind::text = p_kind::text
    and category.archived_at is null
  for key share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'the category must be active, in the requested space, and match the event kind';
  end if;

  select event.id
  into v_event_id
  from public.record_financial_event(
    p_space_id,
    p_request_id,
    p_kind,
    p_effective_date,
    p_movements
  ) as event;

  insert into public.financial_event_categories (
    event_id, space_id, event_kind, category_id, category_kind
  )
  values (
    v_event_id, p_space_id, p_kind, p_category_id, v_category_kind
  );

  return query select v_event_id;
end;
$$;

revoke all on function public.create_category(
  uuid, uuid, public.category_kind, text, text
) from public, anon, service_role;
revoke all on function public.record_financial_event(
  uuid, uuid, public.financial_event_kind, date, jsonb
) from public, anon, service_role;
revoke all on function public.record_categorized_financial_event(
  uuid, uuid, public.financial_event_kind, date, jsonb, uuid
) from public, anon, service_role;

grant execute on function public.create_category(
  uuid, uuid, public.category_kind, text, text
) to authenticated;
grant execute on function public.record_financial_event(
  uuid, uuid, public.financial_event_kind, date, jsonb
) to authenticated;
grant execute on function public.record_categorized_financial_event(
  uuid, uuid, public.financial_event_kind, date, jsonb, uuid
) to authenticated;
