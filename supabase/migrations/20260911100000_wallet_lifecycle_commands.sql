-- Wallet lifecycle: protected rename, archive, and restore commands.
-- Spec: docs/superpowers/specs/2026-09-11-wallet-rename-archive-design.md

-- 1. Append-only wallet command log and wallet row guards.

create table public.wallet_command_requests (
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  command_kind text not null,
  request_fingerprint bytea not null,
  wallet_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  previous_name text,
  name text,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id),
  constraint wallet_command_requests_kind_check
    check (command_kind in ('rename_wallet', 'archive_wallet', 'restore_wallet')),
  constraint wallet_command_requests_names_check check (
    case
      when command_kind = 'rename_wallet' then
        previous_name is not null
        and name is not null
        and name = btrim(name)
        and char_length(name) between 1 and 120
      else previous_name is null and name is null
    end
  ),
  constraint wallet_command_requests_wallet_fkey foreign key (wallet_id, space_id)
    references public.wallets (id, space_id) on delete restrict
);

create index wallet_command_requests_wallet_idx
  on public.wallet_command_requests (space_id, wallet_id);

alter table public.wallet_command_requests enable row level security;

create function private.reject_wallet_command_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'wallet command history is immutable';
end;
$$;

create function private.guard_wallet_update()
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

  if new.id is distinct from old.id
    or new.space_id is distinct from old.space_id
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
    or (old.archived_at is not null
      and new.archived_at is not null
      and new.archived_at is distinct from old.archived_at) then
    raise exception using
      errcode = '42501',
      message = 'wallets may change only their name and archive state';
  end if;

  return new;
end;
$$;

create function private.reject_wallet_deletion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'wallets are archived, never deleted';
end;
$$;

create trigger wallet_command_requests_require_owner_insert
before insert on public.wallet_command_requests
for each row execute function private.require_table_owner_write();

create trigger wallet_command_requests_reject_row_mutation
before update or delete on public.wallet_command_requests
for each row execute function private.reject_wallet_command_history_mutation();

create trigger wallet_command_requests_reject_statement_mutation
before delete or truncate on public.wallet_command_requests
for each statement execute function private.reject_wallet_command_history_mutation();

create trigger wallets_guard_update
before update on public.wallets
for each row execute function private.guard_wallet_update();

create trigger wallets_reject_delete
before delete on public.wallets
for each row execute function private.reject_wallet_deletion();

create trigger wallets_reject_delete_statement
before delete or truncate on public.wallets
for each statement execute function private.reject_wallet_deletion();

revoke all on table public.wallet_command_requests from public, anon, authenticated, service_role;
revoke all on function private.reject_wallet_command_history_mutation() from public, anon, authenticated, service_role;
revoke all on function private.guard_wallet_update() from public, anon, authenticated, service_role;
revoke all on function private.reject_wallet_deletion() from public, anon, authenticated, service_role;

-- 2. Archived wallets accept no money movement from any writer.

create function private.require_active_movement_wallet()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_wallet_id uuid;
begin
  -- FOR SHARE conflicts with archive_wallet's FOR UPDATE, so a movement and an
  -- archive of the same wallet serialize instead of both committing.
  select wallet.id
  into v_wallet_id
  from public.wallets as wallet
  where wallet.id = new.wallet_id
    and wallet.space_id = new.space_id
    and wallet.archived_at is null
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'every wallet movement must use an active wallet';
  end if;

  return new;
end;
$$;

create trigger wallet_movements_require_active_wallet
before insert on public.wallet_movements
for each row execute function private.require_active_movement_wallet();

revoke all on function private.require_active_movement_wallet() from public, anon, authenticated, service_role;

-- 3. Shared command preconditions, request replay, rename, and result lookup.

create function private.require_wallet_command_actor(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid
)
returns uuid
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_request_id is null or p_wallet_id is null then
    raise exception using errcode = 'P0001', message = 'request ID and wallet ID are required';
  end if;

  return v_actor_id;
end;
$$;

create function private.replay_wallet_command(
  p_space_id uuid,
  p_request_id uuid,
  p_command_kind text,
  p_fingerprint bytea,
  p_wallet_id uuid
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_wallet_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wallet:' || p_space_id::text || ':' || p_request_id::text, 0)
  );

  select request.command_kind, request.request_fingerprint, request.wallet_id
  into v_existing_kind, v_existing_fingerprint, v_existing_wallet_id
  from public.wallet_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id;

  if not found then
    return false;
  end if;

  if v_existing_kind <> p_command_kind
    or v_existing_fingerprint <> p_fingerprint
    or v_existing_wallet_id <> p_wallet_id then
    raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
  end if;

  return true;
end;
$$;

create function private.lock_space_wallet(
  p_space_id uuid,
  p_wallet_id uuid
)
returns public.wallets
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_wallet public.wallets;
begin
  select wallet.*
  into v_wallet
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the wallet does not belong to the requested space';
  end if;

  return v_wallet;
end;
$$;

create function public.rename_wallet(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid,
  p_name text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid;
  v_name text := pg_catalog.btrim(p_name);
  v_fingerprint bytea;
  v_wallet public.wallets;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'rename_wallet',
      'walletId', p_wallet_id,
      'name', v_name
    )::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'rename_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the wallet is archived';
  end if;

  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'the wallet name must be 1 to 120 characters';
  end if;

  if v_name = v_wallet.name then
    raise exception using errcode = 'P0001', message = 'the wallet already has this name';
  end if;

  update public.wallets as wallet
  set name = v_name
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id, previous_name, name
  )
  values (
    p_space_id, p_request_id, 'rename_wallet', v_fingerprint, p_wallet_id, v_actor_id, v_wallet.name, v_name
  );

  return query select p_wallet_id;
end;
$$;

create function public.get_wallet_command_result(
  p_space_id uuid,
  p_request_id uuid
)
returns table (
  command_kind text,
  wallet_id uuid,
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
  select request.command_kind, request.wallet_id, request.created_at
  from public.wallet_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;
end;
$$;

revoke all on function private.require_wallet_command_actor(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.replay_wallet_command(uuid, uuid, text, bytea, uuid) from public, anon, authenticated, service_role;
revoke all on function private.lock_space_wallet(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.rename_wallet(uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.get_wallet_command_result(uuid, uuid) from public, anon, service_role;

grant execute on function public.rename_wallet(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.get_wallet_command_result(uuid, uuid) to authenticated;

-- 4. Archive at zero balance and restore.

create function public.archive_wallet(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid;
  v_fingerprint bytea;
  v_wallet public.wallets;
  v_balance_minor numeric;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object('version', 1, 'command', 'archive_wallet', 'walletId', p_wallet_id)::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'archive_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the wallet is already archived';
  end if;

  select coalesce(sum(movement.amount_minor), 0)
  into v_balance_minor
  from public.wallet_movements as movement
  where movement.wallet_id = p_wallet_id
    and movement.space_id = p_space_id;

  if v_balance_minor <> 0 then
    raise exception using errcode = 'P0001', message = 'the wallet balance must be zero to archive';
  end if;

  update public.wallets as wallet
  set archived_at = pg_catalog.now()
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
  )
  values (p_space_id, p_request_id, 'archive_wallet', v_fingerprint, p_wallet_id, v_actor_id);

  return query select p_wallet_id;
end;
$$;

create function public.restore_wallet(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid;
  v_fingerprint bytea;
  v_wallet public.wallets;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object('version', 1, 'command', 'restore_wallet', 'walletId', p_wallet_id)::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'restore_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is null then
    raise exception using errcode = 'P0001', message = 'the wallet is not archived';
  end if;

  update public.wallets as wallet
  set archived_at = null
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
  )
  values (p_space_id, p_request_id, 'restore_wallet', v_fingerprint, p_wallet_id, v_actor_id);

  return query select p_wallet_id;
end;
$$;

revoke all on function public.archive_wallet(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.restore_wallet(uuid, uuid, uuid) from public, anon, service_role;

grant execute on function public.archive_wallet(uuid, uuid, uuid) to authenticated;
grant execute on function public.restore_wallet(uuid, uuid, uuid) to authenticated;
