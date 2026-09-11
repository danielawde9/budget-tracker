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
