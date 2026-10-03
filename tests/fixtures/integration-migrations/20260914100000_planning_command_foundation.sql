-- Shared foundation for future planning commands (task 03): exact parsers,
-- an immutable receipt/replay ledger, and an authorization/locking helper
-- that later commands compose rather than each reinventing.

create function private.planning_minor(p_value text, p_positive boolean default false)
returns bigint language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p_value is null or p_positive is null
    or p_value !~ '^(0|[1-9][0-9]{0,14})$'
    or (p_positive and p_value = '0') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  return p_value::bigint;
end; $$;

create function private.planning_reject_mutation()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  raise exception using errcode='42501', message='planning_history_immutable';
end; $$;

create function private.planning_guard_insert()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_owner name;
begin
  select r.rolname into v_owner from pg_catalog.pg_class c
  join pg_catalog.pg_roles r on r.oid=c.relowner where c.oid=tg_relid;
  if current_user is distinct from v_owner then
    raise exception using errcode='42501', message='planning_command_required';
  end if;
  return new;
end; $$;

create table public.planning_command_receipts (
  sequence_id bigint generated always as identity unique,
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  command text not null check (char_length(command) between 1 and 80),
  fingerprint bytea not null check (octet_length(fingerprint)=32),
  actor_id uuid not null references auth.users(id) on delete restrict,
  result jsonb not null check (
    (jsonb_typeof(result)='object' and octet_length(result::text)<=16384) is true),
  created_at timestamptz not null default now(),
  primary key(space_id,request_id)
);
create index planning_receipts_history_idx
  on public.planning_command_receipts(space_id,sequence_id desc);

alter table public.planning_command_receipts enable row level security;

create trigger planning_command_receipts_guard_insert
before insert on public.planning_command_receipts
for each row execute function private.planning_guard_insert();
create trigger planning_command_receipts_reject_mutation
before update or delete or truncate on public.planning_command_receipts
for each statement execute function private.planning_reject_mutation();

revoke all on public.planning_command_receipts from public, anon, authenticated, service_role;
revoke all on sequence public.planning_command_receipts_sequence_id_seq from public, anon, authenticated, service_role;

create function private.lock_planning_actor(p_space_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  perform 1 from public.spaces where id=p_space_id for update;
  if not found or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  return v_actor;
end; $$;
revoke all on function private.lock_planning_actor(uuid) from public, anon, authenticated, service_role;

create function private.planning_fingerprint(p_command text,p_actor uuid,p_payload jsonb)
returns bytea language sql immutable set search_path=pg_catalog,extensions as $$
  select extensions.digest(jsonb_build_object(
    'version',1,'command',p_command,'actor',p_actor,'payload',p_payload)::text,'sha256')
$$;
revoke all on function private.planning_fingerprint(text,uuid,jsonb) from public, anon, authenticated, service_role;

create function private.planning_replay(
  p_space_id uuid,p_request_id uuid,p_command text,p_actor uuid,p_fingerprint bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set statement_timeout='10s' as $$
declare v_receipt public.planning_command_receipts%rowtype;
begin
  if p_space_id is null or p_request_id is null or p_command is null
    or p_actor is null or p_fingerprint is null
    or char_length(p_command) not between 1 and 80
    or octet_length(p_fingerprint)<>32 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'budget-planning-request:'||p_space_id::text||':'||p_request_id::text,0));
  select * into v_receipt from public.planning_command_receipts
  where space_id=p_space_id and request_id=p_request_id;
  if not found then return null; end if;
  if v_receipt.command is distinct from p_command
    or v_receipt.actor_id is distinct from p_actor
    or v_receipt.fingerprint is distinct from p_fingerprint then
    raise exception using errcode='P0001',message='planning_idempotency_conflict';
  end if;
  return v_receipt.result;
end; $$;
revoke all on function private.planning_replay(uuid,uuid,text,uuid,bytea)
  from public,anon,authenticated,service_role;

create function public.find_planning_command(p_space_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog set statement_timeout='10s' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if v_actor is null or p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501',message='planning_not_authorized';
  end if;
  if p_request_id is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  select jsonb_build_object('command',command,'sequenceId',sequence_id::text,'result',result)
  into v_result from public.planning_command_receipts
  where space_id=p_space_id and request_id=p_request_id and actor_id=v_actor;
  return v_result;
end; $$;
revoke all on function public.find_planning_command(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.find_planning_command(uuid,uuid) to authenticated;

create function private.planning_child_request(p_parent uuid,p_operation text)
returns uuid language plpgsql immutable set search_path=pg_catalog,extensions as $$
declare v_bytes bytea; v_hex text;
begin
  if p_parent is null or p_operation is null or char_length(p_operation) not between 1 and 120 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  v_bytes:=substring(extensions.digest(jsonb_build_array(p_parent,p_operation)::text,'sha256') from 1 for 16);
  v_bytes:=set_byte(v_bytes,6,(get_byte(v_bytes,6) & 15) | 128);
  v_bytes:=set_byte(v_bytes,8,(get_byte(v_bytes,8) & 63) | 128);
  v_hex:=encode(v_bytes,'hex');
  return (substring(v_hex,1,8)||'-'||substring(v_hex,9,4)||'-'||
    substring(v_hex,13,4)||'-'||substring(v_hex,17,4)||'-'||substring(v_hex,21,12))::uuid;
end; $$;
revoke all on function private.planning_child_request(uuid,text)
  from public,anon,authenticated,service_role;

-- Task 3: give the existing setter the shared space-row lock before its own
-- advisory locks, so a later publish wrapper can hold that same lock across
-- several planning writes without inverting the lock order from 01-sql-contract.md.
-- Signature, normalization, return shape, and fingerprints are unchanged.
create or replace function private.set_monthly_budget_plan(
  p_space_id uuid,
  p_request_id uuid,
  p_category_id uuid,
  p_month date,
  p_currency public.currency_code,
  p_amount_minor text,
  p_expected_revision_id bigint,
  p_plan_kind text
)
returns table (id bigint, month_start date)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_month_start date;
  v_amount_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_id bigint;
  v_current_id bigint;
  v_category_archived_at timestamptz;
  v_category_parent_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_request_id is null or p_month is null or p_currency is null or p_plan_kind not in ('income', 'expense_category') then
    raise exception using errcode = 'P0001', message = 'monthly budget plan inputs are required';
  end if;
  if p_plan_kind = 'income' and p_category_id is not null then
    raise exception using errcode = 'P0001', message = 'income plans cannot have a category';
  end if;
  if p_plan_kind = 'expense_category' and p_category_id is null then
    raise exception using errcode = 'P0001', message = 'expense category targets require a category';
  end if;
  v_amount_minor := private.parse_nonnegative_minor_amount(p_amount_minor);
  v_month_start := date_trunc('month', p_month)::date;
  v_fingerprint := extensions.digest(
    'monthly_budget|' || p_plan_kind || '|' || coalesce(p_category_id::text, '') || '|' || v_month_start::text || '|' || p_currency::text || '|' || v_amount_minor::text || '|' || coalesce(p_expected_revision_id::text, ''),
    'sha256'
  );
  perform private.lock_planning_actor(p_space_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_space_id::text || '|' || p_request_id::text, 0));
  select revision.request_fingerprint, revision.id into v_existing_fingerprint, v_existing_id
  from public.monthly_budget_plan_revisions as revision
  where revision.space_id = p_space_id and revision.request_id = p_request_id;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;
    return query select v_existing_id, v_month_start;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_space_id::text || '|' || p_plan_kind || '|' || coalesce(p_category_id::text, '') || '|' || v_month_start::text || '|' || p_currency::text, 0));
  select revision.id into v_current_id
  from public.monthly_budget_plan_revisions as revision
  where revision.space_id = p_space_id and revision.month_start = v_month_start and revision.currency = p_currency
    and revision.plan_kind = p_plan_kind and revision.category_id is not distinct from p_category_id
  order by revision.id desc limit 1 for update;
  if v_current_id is distinct from p_expected_revision_id then
    raise exception using errcode = 'P0001', message = 'the monthly budget plan has changed; refresh and try again';
  end if;
  if p_plan_kind = 'expense_category' then
    select category.archived_at, category.parent_category_id into v_category_archived_at, v_category_parent_id from public.categories as category
    where category.id = p_category_id and category.space_id = p_space_id and category.kind = 'expense';
    if not found then raise exception using errcode = 'P0001', message = 'the requested expense category was not found'; end if;
    if v_category_parent_id is not null then
      raise exception using errcode = 'P0001', message = 'a monthly budget target must reference a root category, not a subcategory';
    end if;
    if v_category_archived_at is not null and v_amount_minor > 0 then
      raise exception using errcode = 'P0001', message = 'an archived category cannot receive a positive target';
    end if;
  end if;
  insert into public.monthly_budget_plan_revisions (
    space_id, request_id, request_fingerprint, plan_kind, month_start, currency, category_id, category_kind, amount_minor, expected_revision_id, actor_id
  ) values (
    p_space_id, p_request_id, v_fingerprint, p_plan_kind, v_month_start, p_currency, p_category_id,
    case when p_plan_kind = 'expense_category' then 'expense'::public.category_kind else null end,
    v_amount_minor, p_expected_revision_id, v_actor_id
  ) returning monthly_budget_plan_revisions.id into v_existing_id;
  return query select v_existing_id, v_month_start;
end;
$$;
