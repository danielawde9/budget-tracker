# 03 — Common planning SQL boundary implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development.

**Goal:** Add shared exact parsers, immutable receipts and authorization/locking
helpers for subsequent planning commands. **Layer:** DB. **Depends on:** 02.
**Architecture:** explicit small helpers; no generic arbitrary-entity writer.
**Tech Stack:** existing PostgreSQL, pgcrypto, pg/Vitest.

Create one timestamped `_planning_command_foundation.sql` and
`tests/db/planning-command-foundation.integration.test.ts`; update decisions,
inventory and `docs/verification/future-planning/03.md`. No source UI edits.

## Task 1 — Parsers and immutable guards

- [ ] Write tests rejecting NULL, whitespace, signs, decimals, exponent notation,
  16-digit money and invalid JSON/array bounds. Then add:

```sql
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
```

Do not attach the invoker INSERT guard to existing financial tables; those
retain their existing owner/lifecycle contracts. Attach it to each new planning
table with `BEFORE INSERT FOR EACH ROW`, and attach the mutation guard with
`BEFORE UPDATE OR DELETE OR TRUNCATE FOR EACH STATEMENT`.

## Task 2 — Receipt and exact lock helper

```sql
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

create function private.planning_fingerprint(p_command text,p_actor uuid,p_payload jsonb)
returns bytea language sql immutable set search_path=pg_catalog,extensions as $$
  select extensions.digest(jsonb_build_object(
    'version',1,'command',p_command,'actor',p_actor,'payload',p_payload)::text,'sha256')
$$;
```

`planning_fingerprint` is called only after validation/canonicalization and is
not public. Do not fingerprint raw client JSON with arbitrary optional keys.
Normalize missing optional values to explicit null, money to canonical text,
UUIDs to UUID JSON values, and unordered collections to stable identity order.

- [ ] Implement `private.planning_replay(p_space_id uuid,p_request_id uuid,
  p_command text,p_actor uuid,p_fingerprint bytea) RETURNS jsonb` exactly:
  reject null inputs → acquire `pg_advisory_xact_lock(hashtextextended(
  'budget-planning-request:'||space||':'||request,0))` → select receipt by PK →
  if found compare command/actor/fingerprint with `IS DISTINCT FROM` and reject
  on any difference → return stored result; no row returns SQL null. It does
  not authorize itself; only a locked authorized command calls it.
- [ ] Implement `public.find_planning_command(p_space_id uuid,p_request_id uuid)
  RETURNS jsonb`: auth and current membership required, no mutation lock;
  select only same-space **same-actor** receipt; return null or object with
  `command, sequenceId` (text), `result`. It must not reveal another actor's
  receipt. Validate request not null and set bounded statement timeout.
- [ ] Receipt results are validated by each owning command before insertion;
  they contain only IDs/heads/posted-state flags from the command's contract,
  never payee names, raw payloads or private user records.

## Task 3 — Existing setter lock integration and grants

- [ ] In a new forward definition of `private.set_monthly_budget_plan`, insert
  `perform private.lock_planning_actor(p_space_id);` after required syntax
  validation and before either existing advisory lock. Preserve its signature,
  normalization, return shape and fingerprints. Reentrant space row locking
  permits a later publish wrapper to call it. Test direct old setter racing
  against a wrapper holding the space lock with `orderedAuthenticatedRace`.
- [ ] Apply all RLS/grants/guards from [01](01-sql-contract.md) to the receipt.
  Revoke each private helper from all API roles, and grant only the public
  lookup RPC to authenticated. Revoke sequence rights as well as table rights.
- [ ] Tests: lookup authorization, same actor replay, foreign actor conflict,
  removed member denial, no financial digest change, invoker INSERT guard under
  temporary grants+permissive RLS, zero-row DELETE/TRUNCATE and rollback receipt.
- [ ] Do not create a public “insert receipt” RPC; only domain commands write it.

Run focused file with the env-loaded Vitest command and full DB gate from test
recipes. Verify empty/seeded replay, then commit
`feat(planning): add protected command foundation`. Exit before domain schema.

## Exact replay and lookup bodies

Use these bodies for the task 2 contracts; the public lookup remains read-only.

```sql
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
```

## Exact deterministic child request helper

The helper is shared by all later wrapper commands, including schedules/imports.
Only internal operation labels use it; it is not a generic public UUID service.

```sql
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
```

This uses the first128 digest bits with version/variant bits set. The namespace
is the parent request UUID and explicit operation label; labels must be unique
within that operation, e.g. `confirm:<occurrenceUuid>` and `goal-link:<eventUuid>`.
Golden-vector inputs and expected output are recorded in the plan-pack review.
Same input must remain stable after future migrations; do not change the digest
encoding once a wrapper can have ambiguous outstanding requests.
