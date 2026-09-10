create type public.membership_status as enum ('active', 'revoked', 'left');
create type public.household_invitation_status as enum ('pending', 'accepted', 'cancelled');
create type public.household_membership_event_kind as enum (
  'invitation_created',
  'invitation_cancelled',
  'invitation_accepted',
  'member_removed',
  'member_left',
  'member_promoted',
  'member_demoted'
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'household_command_owner') then
    create role household_command_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

alter table public.space_memberships
  add column status public.membership_status not null default 'active',
  add column activated_at timestamptz,
  add column ended_at timestamptz,
  add column ended_by_user_id uuid references auth.users(id) on delete restrict;

update public.space_memberships
set activated_at = created_at
where activated_at is null;

alter table public.space_memberships
  alter column activated_at set not null,
  alter column activated_at set default now(),
  add constraint space_memberships_lifecycle_check check (
    (status = 'active' and ended_at is null and ended_by_user_id is null)
    or (status in ('revoked', 'left') and ended_at is not null and ended_by_user_id is not null)
  ),
  add constraint space_memberships_end_actor_check check (
    (status = 'active')
    or (status = 'left' and ended_by_user_id = user_id)
    or (status = 'revoked' and ended_by_user_id <> user_id)
  ),
  add constraint space_memberships_lifecycle_time_check check (
    activated_at >= created_at
    and (ended_at is null or ended_at >= activated_at)
  );

drop index public.space_memberships_user_space_idx;

create index space_memberships_active_user_space_idx
  on public.space_memberships (user_id, space_id)
  where status = 'active';

create index space_memberships_active_owner_idx
  on public.space_memberships (space_id, user_id)
  where status = 'active' and role = 'owner';

create index space_memberships_ended_by_idx
  on public.space_memberships (ended_by_user_id)
  where ended_by_user_id is not null;

create table private.household_invitation_keys (
  key_version smallint primary key check (key_version > 0),
  identity_hmac_key bytea not null,
  token_hmac_key bytea not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint household_invitation_key_lengths_check check (
    octet_length(identity_hmac_key) = 32 and octet_length(token_hmac_key) = 32
  ),
  constraint household_invitation_key_retirement_check check (
    retired_at is null or retired_at > created_at
  )
);

create unique index household_invitation_keys_one_active_idx
  on private.household_invitation_keys ((true))
  where retired_at is null;

insert into private.household_invitation_keys (
  key_version,
  identity_hmac_key,
  token_hmac_key
)
values (1, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32));

create table public.household_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  key_version smallint not null references private.household_invitation_keys(key_version) on delete restrict,
  invitee_identity_digest bytea not null,
  token_digest bytea not null unique,
  status public.household_invitation_status not null default 'pending',
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by_user_id uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  constraint household_invitation_identity_digest_check check (
    octet_length(invitee_identity_digest) = 32
  ),
  constraint household_invitation_token_digest_check check (
    octet_length(token_digest) = 32
  ),
  constraint household_invitation_lifecycle_check check (
    (status = 'pending'
      and accepted_by_user_id is null and accepted_at is null
      and cancelled_by_user_id is null and cancelled_at is null)
    or (status = 'accepted'
      and accepted_by_user_id is not null and accepted_at is not null
      and cancelled_by_user_id is null and cancelled_at is null)
    or (status = 'cancelled'
      and cancelled_by_user_id is not null and cancelled_at is not null
      and accepted_by_user_id is null and accepted_at is null)
  ),
  constraint household_invitation_expiry_check check (
    expires_at = created_at + interval '7 days'
  )
);

create index household_invitations_key_version_idx
  on public.household_invitations (key_version);

create index household_invitations_pending_identity_idx
  on public.household_invitations (space_id, invitee_identity_digest, expires_at desc)
  where status = 'pending';

create index household_invitations_space_created_idx
  on public.household_invitations (space_id, created_at desc, id desc);

create index household_invitations_created_by_idx
  on public.household_invitations (created_by_user_id);

create index household_invitations_accepted_by_idx
  on public.household_invitations (accepted_by_user_id)
  where accepted_by_user_id is not null;

create index household_invitations_cancelled_by_idx
  on public.household_invitations (cancelled_by_user_id)
  where cancelled_by_user_id is not null;

create table public.household_membership_events (
  id uuid primary key default extensions.gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  subject_user_id uuid references auth.users(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint bytea not null check (octet_length(request_fingerprint) = 32),
  kind public.household_membership_event_kind not null,
  invitation_id uuid references public.household_invitations(id) on delete restrict,
  prior_status public.membership_status,
  next_status public.membership_status,
  prior_role public.member_role,
  next_role public.member_role,
  occurred_at timestamptz not null default now(),
  constraint household_membership_events_actor_request_key unique (actor_user_id, request_id),
  constraint household_membership_events_shape_check check (
    (kind in ('invitation_created', 'invitation_cancelled')
      and invitation_id is not null and subject_user_id is null
      and prior_status is null and next_status is null
      and prior_role is null and next_role is null)
    or (kind = 'invitation_accepted'
      and invitation_id is not null and subject_user_id is not null
      and prior_status is distinct from 'active'
      and next_status = 'active' and next_role = 'member')
    or (kind = 'member_removed'
      and invitation_id is null and subject_user_id is not null
      and prior_status = 'active' and next_status = 'revoked'
      and prior_role is not null and next_role = prior_role)
    or (kind = 'member_left'
      and invitation_id is null and subject_user_id is not null
      and prior_status = 'active' and next_status = 'left'
      and prior_role is not null and next_role = prior_role)
    or (kind = 'member_promoted'
      and invitation_id is null and subject_user_id is not null
      and prior_status = 'active' and next_status = 'active'
      and prior_role = 'member' and next_role = 'owner')
    or (kind = 'member_demoted'
      and invitation_id is null and subject_user_id is not null
      and prior_status = 'active' and next_status = 'active'
      and prior_role = 'owner' and next_role = 'member')
  )
);

create index household_membership_events_space_time_idx
  on public.household_membership_events (space_id, occurred_at desc, id desc);

create index household_membership_events_subject_idx
  on public.household_membership_events (subject_user_id)
  where subject_user_id is not null;

create index household_membership_events_invitation_idx
  on public.household_membership_events (invitation_id)
  where invitation_id is not null;

create or replace function private.is_active_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create function private.is_active_owner(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = 'owner'
  );
$$;

create function private.lock_household_space(p_space_id uuid)
returns public.space_kind
language sql
volatile
security definer
set search_path = ''
as $$
  select space.kind
  from public.spaces as space
  where space.id = p_space_id
  for update;
$$;

create function private.assert_space_membership_invariant(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.space_kind;
  v_membership_count integer;
  v_active_owner_count integer;
begin
  select space.kind
  into v_kind
  from public.spaces as space
  where space.id = p_space_id;

  if not found then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where membership.status = 'active' and membership.role = 'owner')::integer
  into v_membership_count, v_active_owner_count
  from public.space_memberships as membership
  where membership.space_id = p_space_id;

  if v_kind = 'personal' and not (v_membership_count = 1 and v_active_owner_count = 1) then
    raise exception using
      errcode = '23514',
      message = 'personal space membership invariant violated';
  end if;

  if v_kind = 'household' and v_active_owner_count < 1 then
    raise exception using
      errcode = '23514',
      message = 'household must retain an active owner';
  end if;
end;
$$;

create function private.enforce_space_membership_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.assert_space_membership_invariant(old.space_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.space_id is distinct from old.space_id) then
    perform private.assert_space_membership_invariant(new.space_id);
  elsif tg_op = 'UPDATE' then
    perform private.assert_space_membership_invariant(new.space_id);
  end if;
  return null;
end;
$$;

create function private.enforce_space_row_membership_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_space_membership_invariant(new.id);
  return null;
end;
$$;

create constraint trigger space_memberships_preserve_space_owners
after insert or update or delete on public.space_memberships
deferrable initially deferred
for each row execute function private.enforce_space_membership_invariant();

create constraint trigger spaces_preserve_membership_invariants
after insert or update of kind on public.spaces
deferrable initially deferred
for each row execute function private.enforce_space_row_membership_invariant();

create function private.enforce_household_invitation_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.spaces as space
    where space.id = new.space_id and space.kind = 'household'
  ) then
    raise exception using
      errcode = '23514',
      message = 'household invitations require a household space';
  end if;
  return null;
end;
$$;

create constraint trigger household_invitations_require_household_space
after insert or update of space_id on public.household_invitations
deferrable initially deferred
for each row execute function private.enforce_household_invitation_space();

create function private.reject_household_membership_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'household membership events are immutable';
end;
$$;

create trigger household_membership_events_reject_row_mutation
before update or delete on public.household_membership_events
for each row execute function private.reject_household_membership_event_mutation();

create trigger household_membership_events_reject_truncate
before truncate on public.household_membership_events
for each statement execute function private.reject_household_membership_event_mutation();

alter table public.household_invitations enable row level security;
alter table public.household_invitations force row level security;
alter table public.household_membership_events enable row level security;
alter table public.household_membership_events force row level security;

create policy space_memberships_household_command_owner
  on public.space_memberships
  for all
  to household_command_owner
  using (true)
  with check (true);

create policy household_invitations_command_owner
  on public.household_invitations
  for all
  to household_command_owner
  using (true)
  with check (true);

create policy household_membership_events_command_owner
  on public.household_membership_events
  for all
  to household_command_owner
  using (true)
  with check (true);

revoke all on table private.household_invitation_keys from public, anon, authenticated, service_role;
revoke all on table public.household_invitations, public.household_membership_events
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on table public.spaces, public.space_memberships
  from anon, authenticated, service_role;

grant usage on schema public, private, auth, extensions to household_command_owner;
grant select on table public.spaces to household_command_owner;
grant select, insert, update on table public.space_memberships to household_command_owner;
grant select, insert, update on table public.household_invitations to household_command_owner;
grant select, insert on table public.household_membership_events to household_command_owner;
grant select on table private.household_invitation_keys to household_command_owner;
grant select (id, email, email_confirmed_at) on table auth.users to household_command_owner;

revoke all on function private.is_active_member(uuid) from public, anon, service_role;
grant execute on function private.is_active_member(uuid) to authenticated, household_command_owner;

revoke all on function private.is_active_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_active_owner(uuid) to household_command_owner;

revoke all on function private.lock_household_space(uuid) from public, anon, authenticated, service_role;
grant execute on function private.lock_household_space(uuid) to household_command_owner;

revoke all on function private.assert_space_membership_invariant(uuid) from public, anon, authenticated, service_role;
revoke all on function private.enforce_space_membership_invariant() from public, anon, authenticated, service_role;
revoke all on function private.enforce_space_row_membership_invariant() from public, anon, authenticated, service_role;
revoke all on function private.enforce_household_invitation_space() from public, anon, authenticated, service_role;
revoke all on function private.reject_household_membership_event_mutation() from public, anon, authenticated, service_role;
