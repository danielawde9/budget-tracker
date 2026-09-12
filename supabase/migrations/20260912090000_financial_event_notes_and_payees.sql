create function private.canonical_payee_name(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select private.canonical_category_name(p_value);
$$;

create function private.payee_name_key(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select pg_catalog.lower(private.arabic_category_key(private.canonical_payee_name(p_value)));
$$;

create table public.payees (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  name text not null,
  name_key text generated always as (private.payee_name_key(name)) stored,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payees_name_canonical_check check (
    name = private.canonical_payee_name(name)
    and pg_catalog.char_length(name) between 1 and 120
  ),
  constraint payees_name_key_nonempty_check check (pg_catalog.btrim(name_key) <> ''),
  constraint payees_space_name_key unique (space_id, name_key),
  constraint payees_id_space_key unique (id, space_id)
);

create index payees_space_created_idx on public.payees (space_id, created_at desc, id desc);

create table public.financial_event_descriptions (
  event_id uuid primary key,
  space_id uuid not null,
  payee_id uuid,
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (event_id, space_id)
    references public.financial_events (id, space_id) on delete restrict,
  foreign key (payee_id, space_id)
    references public.payees (id, space_id) on delete restrict,
  constraint financial_event_descriptions_content_check check (payee_id is not null or note is not null),
  constraint financial_event_descriptions_note_check check (
    note is null
    or (
      note = nullif(pg_catalog.btrim(pg_catalog.normalize(note, 'NFKC')), '')
      and pg_catalog.char_length(note) between 1 and 2000
    )
  )
);

create index financial_event_descriptions_space_payee_event_idx
  on public.financial_event_descriptions (space_id, payee_id, event_id);

create table public.financial_event_description_requests (
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint bytea not null,
  event_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id),
  foreign key (event_id, space_id)
    references public.financial_events (id, space_id) on delete restrict
);

alter table public.payees enable row level security;
alter table public.financial_event_descriptions enable row level security;
alter table public.financial_event_description_requests enable row level security;

create policy payees_read_for_members on public.payees for select to authenticated
  using ((select private.is_active_member(space_id)));

create policy financial_event_descriptions_read_for_members on public.financial_event_descriptions for select to authenticated
  using ((select private.is_active_member(space_id)));

create trigger payees_require_owner_insert before insert on public.payees
  for each row execute function private.require_table_owner_write();
create trigger financial_event_descriptions_require_owner_insert before insert on public.financial_event_descriptions
  for each row execute function private.require_table_owner_write();
create trigger financial_event_description_requests_require_owner_insert before insert on public.financial_event_description_requests
  for each row execute function private.require_table_owner_write();

create trigger payees_reject_row_mutation before update or delete on public.payees
  for each row execute function private.reject_category_history_mutation();
create trigger financial_event_descriptions_reject_row_mutation before update or delete on public.financial_event_descriptions
  for each row execute function private.reject_category_history_mutation();
create trigger financial_event_description_requests_reject_row_mutation before update or delete on public.financial_event_description_requests
  for each row execute function private.reject_category_history_mutation();
create trigger payees_reject_truncate before truncate on public.payees
  for each statement execute function private.reject_category_history_mutation();
create trigger financial_event_descriptions_reject_truncate before truncate on public.financial_event_descriptions
  for each statement execute function private.reject_category_history_mutation();
create trigger financial_event_description_requests_reject_truncate before truncate on public.financial_event_description_requests
  for each statement execute function private.reject_category_history_mutation();

create function public.describe_financial_event(
  p_space_id uuid,
  p_request_id uuid,
  p_event_id uuid,
  p_payee_name text,
  p_note text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_payee_name text := private.canonical_payee_name(p_payee_name);
  v_note text := nullif(pg_catalog.btrim(pg_catalog.normalize(p_note, 'NFKC')), '');
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_event_id uuid;
  v_payee_id uuid;
begin
  if v_actor_id is null or p_request_id is null or p_event_id is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if (v_payee_name is not null and pg_catalog.char_length(v_payee_name) > 120)
    or (v_payee_name is not null and pg_catalog.btrim(private.payee_name_key(v_payee_name)) = '')
    or (v_note is not null and pg_catalog.char_length(v_note) > 2000)
    or (v_payee_name is null and v_note is null) then
    raise exception using errcode = 'P0001', message = 'a bounded payee or note is required';
  end if;

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'describe_financial_event',
      'eventId', p_event_id,
      'payeeName', v_payee_name,
      'note', v_note
    )::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select request.request_fingerprint, request.event_id
  into v_existing_fingerprint, v_existing_event_id
  from public.financial_event_description_requests as request
  where request.space_id = p_space_id and request.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;
    return query select v_existing_event_id;
    return;
  end if;

  if not exists (select 1 from public.financial_events as event where event.id = p_event_id and event.space_id = p_space_id) then
    raise exception using errcode = 'P0001', message = 'the event is not available in the requested space';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_space_id::text || ':description:' || p_event_id::text, 0));
  if exists (select 1 from public.financial_event_descriptions as description where description.event_id = p_event_id) then
    raise exception using errcode = 'P0001', message = 'the event already has immutable descriptive metadata';
  end if;

  if v_payee_name is not null then
    insert into public.payees (space_id, name, created_by)
    values (p_space_id, v_payee_name, v_actor_id)
    on conflict (space_id, name_key) do nothing;

    select payee.id into v_payee_id
    from public.payees as payee
    where payee.space_id = p_space_id and payee.name_key = private.payee_name_key(v_payee_name);
  end if;

  insert into public.financial_event_descriptions (event_id, space_id, payee_id, note, created_by)
  values (p_event_id, p_space_id, v_payee_id, v_note, v_actor_id);

  insert into public.financial_event_description_requests (space_id, request_id, request_fingerprint, event_id, actor_id)
  values (p_space_id, p_request_id, v_fingerprint, p_event_id, v_actor_id);

  return query select p_event_id;
end;
$$;

revoke all on table public.payees, public.financial_event_descriptions, public.financial_event_description_requests
from public, anon, authenticated, service_role;
grant select on table public.payees, public.financial_event_descriptions to authenticated;

revoke all on function private.canonical_payee_name(text), private.payee_name_key(text)
from public, anon, authenticated, service_role;
revoke all on function public.describe_financial_event(uuid, uuid, uuid, text, text)
from public, anon, service_role;
grant execute on function public.describe_financial_event(uuid, uuid, uuid, text, text) to authenticated;
