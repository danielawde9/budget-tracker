create type public.category_kind as enum ('income', 'expense');

create function private.canonical_category_name(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.normalize(p_value, 'NFKC'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create function private.english_category_key(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select pg_catalog.lower(private.canonical_category_name(p_value));
$$;

create function private.arabic_category_key(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.translate(
      private.canonical_category_name(p_value),
      'آأإىة',
      'ااايه'
    ),
    '[ؐ-ؚـً-ٰٟۖ-ۭ]',
    '',
    'g'
  );
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  kind public.category_kind not null,
  name_en text,
  name_ar text,
  name_en_key text generated always as (private.english_category_key(name_en)) stored,
  name_ar_key text generated always as (private.arabic_category_key(name_ar)) stored,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_by uuid references auth.users(id) on delete restrict,
  archived_at timestamptz,
  constraint categories_name_present_check check (name_en is not null or name_ar is not null),
  constraint categories_name_en_canonical_check check (
    name_en is null
    or (
      name_en = private.canonical_category_name(name_en)
      and pg_catalog.char_length(name_en) between 1 and 120
    )
  ),
  constraint categories_name_ar_canonical_check check (
    name_ar is null
    or (
      name_ar = private.canonical_category_name(name_ar)
      and pg_catalog.char_length(name_ar) between 1 and 120
    )
  ),
  constraint categories_name_en_key_pair_check check ((name_en is null) = (name_en_key is null)),
  constraint categories_name_ar_key_pair_check check ((name_ar is null) = (name_ar_key is null)),
  constraint categories_archive_pair_check check ((archived_by is null) = (archived_at is null)),
  constraint categories_id_space_key unique (id, space_id),
  constraint categories_id_space_kind_key unique (id, space_id, kind)
);

create unique index categories_active_name_en_idx
  on public.categories (space_id, kind, name_en_key)
  where archived_at is null and name_en_key is not null;

create unique index categories_active_name_ar_idx
  on public.categories (space_id, kind, name_ar_key)
  where archived_at is null and name_ar_key is not null;

create index categories_active_page_idx
  on public.categories (space_id, kind, created_at, id)
  where archived_at is null;

create table public.category_command_requests (
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  command_kind text not null check (command_kind in ('create_category', 'archive_category')),
  request_fingerprint bytea not null,
  category_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id),
  foreign key (category_id, space_id)
    references public.categories (id, space_id) on delete restrict
);

create index category_command_requests_category_idx
  on public.category_command_requests (space_id, category_id);

alter table public.financial_events
  add constraint financial_events_id_space_kind_key unique (id, space_id, kind);

create table public.financial_event_categories (
  event_id uuid primary key,
  space_id uuid not null,
  event_kind public.financial_event_kind not null,
  category_id uuid not null,
  category_kind public.category_kind not null,
  created_at timestamptz not null default now(),
  foreign key (event_id, space_id, event_kind)
    references public.financial_events (id, space_id, kind) on delete restrict,
  foreign key (category_id, space_id, category_kind)
    references public.categories (id, space_id, kind) on delete restrict,
  check (
    (event_kind = 'income' and category_kind = 'income')
    or (event_kind = 'expense' and category_kind = 'expense')
    or event_kind = 'reversal'
  )
);

create index financial_event_categories_space_event_idx
  on public.financial_event_categories (space_id, event_id);

create index financial_event_categories_space_category_event_idx
  on public.financial_event_categories (space_id, category_id, event_id);

alter table public.categories enable row level security;
alter table public.category_command_requests enable row level security;
alter table public.financial_event_categories enable row level security;

create policy categories_read_for_members
  on public.categories
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create policy financial_event_categories_read_for_members
  on public.financial_event_categories
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create function private.require_table_owner_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  return new;
end;
$$;

create function private.guard_category_archive_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  if old.archived_at is not null
    or old.archived_by is not null
    or new.archived_at is null
    or new.archived_by is null
    or new.id is distinct from old.id
    or new.space_id is distinct from old.space_id
    or new.kind is distinct from old.kind
    or new.name_en is distinct from old.name_en
    or new.name_ar is distinct from old.name_ar
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '42501',
      message = 'categories may only transition once from active to archived';
  end if;

  return new;
end;
$$;

create function private.reject_category_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'category history is immutable';
end;
$$;

create function private.validate_reversal_category_copy()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_original_category_id uuid;
  v_original_category_kind public.category_kind;
begin
  if new.event_kind <> 'reversal' then
    return new;
  end if;

  select original_category.category_id, original_category.category_kind
  into v_original_category_id, v_original_category_kind
  from public.financial_events as reversal
  join public.financial_event_categories as original_category
    on original_category.event_id = reversal.reversal_of
   and original_category.space_id = reversal.space_id
  where reversal.id = new.event_id
    and reversal.space_id = new.space_id;

  if not found
    or new.category_id is distinct from v_original_category_id
    or new.category_kind is distinct from v_original_category_kind then
    raise exception using
      errcode = '42501',
      message = 'a reversal category must exactly copy its original event';
  end if;

  return new;
end;
$$;

create trigger categories_require_owner_insert
before insert on public.categories
for each row execute function private.require_table_owner_write();

create trigger categories_guard_archive_update
before update on public.categories
for each row execute function private.guard_category_archive_transition();

create trigger categories_reject_delete
before delete on public.categories
for each row execute function private.reject_category_history_mutation();

create trigger categories_reject_truncate
before truncate on public.categories
for each statement execute function private.reject_category_history_mutation();

create trigger category_command_requests_require_owner_insert
before insert on public.category_command_requests
for each row execute function private.require_table_owner_write();

create trigger category_command_requests_reject_row_mutation
before update or delete on public.category_command_requests
for each row execute function private.reject_category_history_mutation();

create trigger category_command_requests_reject_truncate
before truncate on public.category_command_requests
for each statement execute function private.reject_category_history_mutation();

create trigger financial_event_categories_require_owner_insert
before insert on public.financial_event_categories
for each row execute function private.require_table_owner_write();

create trigger financial_event_categories_validate_reversal
before insert on public.financial_event_categories
for each row execute function private.validate_reversal_category_copy();

create trigger financial_event_categories_reject_row_mutation
before update or delete on public.financial_event_categories
for each row execute function private.reject_category_history_mutation();

create trigger financial_event_categories_reject_truncate
before truncate on public.financial_event_categories
for each statement execute function private.reject_category_history_mutation();

create function private.lock_category_request(
  p_space_id uuid,
  p_request_id uuid
)
returns void
language sql
volatile
set search_path = pg_catalog
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('category:' || p_space_id::text || ':' || p_request_id::text, 0)
  );
$$;

create function public.create_category(
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
  v_name_en text := private.canonical_category_name(p_name_en);
  v_name_ar text := private.canonical_category_name(p_name_ar);
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

  if (v_name_en is null and v_name_ar is null)
    or (v_name_en is not null and pg_catalog.char_length(v_name_en) > 120)
    or (v_name_ar is not null and pg_catalog.char_length(v_name_ar) > 120) then
    raise exception using errcode = 'P0001', message = 'at least one bounded category name is required';
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
    if v_existing_kind <> 'create_category' or v_existing_fingerprint <> v_fingerprint then
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

create function public.archive_category(
  p_space_id uuid,
  p_request_id uuid,
  p_category_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_fingerprint bytea := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'archive_category',
      'categoryId', p_category_id
    )::text,
    'sha256'
  );
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_category_id uuid;
  v_archived_at timestamptz;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  select request.command_kind, request.request_fingerprint, request.category_id
  into v_existing_kind, v_existing_fingerprint, v_existing_category_id
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id;

  if found then
    if v_existing_kind <> 'archive_category'
      or v_existing_fingerprint <> v_fingerprint
      or v_existing_category_id <> p_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_category_id;
    return;
  end if;

  select category.archived_at
  into v_archived_at
  from public.categories as category
  where category.id = p_category_id
    and category.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the category does not belong to the requested space';
  end if;

  if v_archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the category is already archived';
  end if;

  update public.categories
  set archived_by = v_actor_id,
      archived_at = now()
  where categories.id = p_category_id;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'archive_category', v_fingerprint, p_category_id, v_actor_id
  );

  return query select p_category_id;
end;
$$;

create function public.get_category_command_result(
  p_space_id uuid,
  p_request_id uuid
)
returns table (
  command_kind text,
  category_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select request.command_kind, request.category_id, request.created_at
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;
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
    if v_existing_fingerprint <> v_fingerprint
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

create function public.record_categorized_financial_event(
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
    if v_existing_fingerprint <> v_fingerprint
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

create or replace function public.reverse_financial_event(
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
  v_loan_id uuid;
  v_principal_delta_minor bigint;
  v_repayment_effect_minor bigint;
  v_outstanding_minor bigint;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.id, event.request_fingerprint
  into v_event_id, v_existing_fingerprint
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

  select event.kind
  into v_original_kind
  from public.financial_events as event
  where event.id = p_event_id
    and event.space_id = p_space_id
  for update;

  if not found or v_original_kind = 'reversal' then
    raise exception using errcode = 'P0001', message = 'the requested event cannot be reversed';
  end if;

  if exists (
    select 1
    from public.financial_events as event
    where event.reversal_of = p_event_id
  ) then
    raise exception using errcode = 'P0001', message = 'the requested event already has a reversal';
  end if;

  select posting.loan_id, posting.principal_delta_minor, posting.repayment_effect_minor
  into v_loan_id, v_principal_delta_minor, v_repayment_effect_minor
  from public.loan_postings as posting
  where posting.event_id = p_event_id;

  if found then
    perform 1
    from public.loans as loan
    where loan.id = v_loan_id
    for update;

    select coalesce(pg_catalog.sum(posting.principal_delta_minor), 0)
    into v_outstanding_minor
    from public.loan_postings as posting
    where posting.loan_id = v_loan_id;

    if v_outstanding_minor - v_principal_delta_minor < 0 then
      raise exception using
        errcode = 'P0001',
        message = 'the correction would invalidate dependent repayments';
    end if;
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id, reversal_of
  )
  values (
    p_space_id, p_request_id, v_fingerprint, 'reversal', p_effective_date, v_actor_id, p_event_id
  )
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  select v_event_id, p_space_id, movement.wallet_id, -movement.amount_minor
  from public.wallet_movements as movement
  where movement.event_id = p_event_id;

  if v_loan_id is not null then
    insert into public.loan_postings (
      event_id, loan_id, space_id, principal_delta_minor, repayment_effect_minor
    )
    values (
      v_event_id,
      v_loan_id,
      p_space_id,
      -v_principal_delta_minor,
      -v_repayment_effect_minor
    );
  end if;

  insert into public.financial_event_categories (
    event_id, space_id, event_kind, category_id, category_kind
  )
  select
    v_event_id,
    p_space_id,
    'reversal',
    category.category_id,
    category.category_kind
  from public.financial_event_categories as category
  where category.event_id = p_event_id;

  return query select v_event_id;
end;
$$;

revoke all on table
  public.categories,
  public.category_command_requests,
  public.financial_event_categories
from anon, authenticated, service_role;

grant select on table public.categories, public.financial_event_categories to authenticated;

revoke all on function private.canonical_category_name(text) from public, anon, authenticated, service_role;
revoke all on function private.english_category_key(text) from public, anon, authenticated, service_role;
revoke all on function private.arabic_category_key(text) from public, anon, authenticated, service_role;
revoke all on function private.require_table_owner_write() from public, anon, authenticated, service_role;
revoke all on function private.guard_category_archive_transition() from public, anon, authenticated, service_role;
revoke all on function private.reject_category_history_mutation() from public, anon, authenticated, service_role;
revoke all on function private.validate_reversal_category_copy() from public, anon, authenticated, service_role;
revoke all on function private.lock_category_request(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.create_category(
  uuid, uuid, public.category_kind, text, text
) from public, anon, service_role;
revoke all on function public.archive_category(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.get_category_command_result(uuid, uuid) from public, anon, service_role;
revoke all on function public.record_categorized_financial_event(
  uuid, uuid, public.financial_event_kind, date, jsonb, uuid
) from public, anon, service_role;

grant execute on function public.create_category(
  uuid, uuid, public.category_kind, text, text
) to authenticated;
grant execute on function public.archive_category(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_category_command_result(uuid, uuid) to authenticated;
grant execute on function public.record_categorized_financial_event(
  uuid, uuid, public.financial_event_kind, date, jsonb, uuid
) to authenticated;

revoke insert, update, delete, truncate
on table
  public.categories,
  public.category_command_requests,
  public.financial_event_categories
from authenticated, service_role;
