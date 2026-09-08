create function private.household_space_kind(p_space_id uuid)
returns public.space_kind
language sql
stable
security definer
set search_path = ''
as $$
  select space.kind from public.spaces as space where space.id = p_space_id;
$$;

revoke all on function private.household_space_kind(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.household_space_kind(uuid)
  to household_command_owner;

create function public.set_household_member_role(
  p_space_id uuid,
  p_request_id uuid,
  p_member_user_id uuid,
  p_role public.member_role
)
returns table (user_id uuid, status public.membership_status, role public.member_role)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_kind public.household_membership_event_kind;
  v_event public.household_membership_events%rowtype;
  v_membership public.space_memberships%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null or p_member_user_id is null or p_role is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_kind := case when p_role = 'owner' then 'member_promoted' else 'member_demoted' end;
  v_fingerprint := private.household_command_fingerprint(
    'set_household_member_role|' || p_space_id::text || '|'
      || p_member_user_id::text || '|' || p_role::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.* into v_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id and event.request_id = p_request_id;
  if found then
    if v_event.kind <> v_kind
      or v_event.request_fingerprint <> v_fingerprint
      or v_event.subject_user_id <> p_member_user_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select p_member_user_id, v_event.next_status, v_event.next_role;
    return;
  end if;

  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select membership.* into v_membership
  from public.space_memberships as membership
  where membership.space_id = p_space_id and membership.user_id = p_member_user_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'membership_not_active';
  end if;
  if v_membership.role = p_role then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_membership.role = 'owner' and p_role = 'member'
    and (select count(*) from public.space_memberships
         where space_id = p_space_id and status = 'active' and role = 'owner') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_owner';
  end if;

  update public.space_memberships
  set role = p_role
  where space_id = p_space_id and space_memberships.user_id = p_member_user_id;

  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, prior_status, next_status, prior_role, next_role, occurred_at
  ) values (
    p_space_id, v_actor_id, p_member_user_id, p_request_id, v_fingerprint,
    v_kind, 'active', 'active', v_membership.role, p_role, v_now
  );

  return query select p_member_user_id, 'active'::public.membership_status, p_role;
end;
$$;

create function public.remove_household_member(
  p_space_id uuid,
  p_request_id uuid,
  p_member_user_id uuid
)
returns table (user_id uuid, status public.membership_status)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_event public.household_membership_events%rowtype;
  v_membership public.space_memberships%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null or p_member_user_id is null
    or p_member_user_id = v_actor_id then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_fingerprint := private.household_command_fingerprint(
    'remove_household_member|' || p_space_id::text || '|' || p_member_user_id::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);
  select event.* into v_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id and event.request_id = p_request_id;
  if found then
    if v_event.kind <> 'member_removed'
      or v_event.request_fingerprint <> v_fingerprint
      or v_event.subject_user_id <> p_member_user_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select p_member_user_id, v_event.next_status;
    return;
  end if;

  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select membership.* into v_membership
  from public.space_memberships as membership
  where membership.space_id = p_space_id and membership.user_id = p_member_user_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'membership_not_active';
  end if;
  if v_membership.role = 'owner'
    and (select count(*) from public.space_memberships
         where space_id = p_space_id and status = 'active' and role = 'owner') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_owner';
  end if;

  update public.space_memberships
  set status = 'revoked', ended_at = v_now, ended_by_user_id = v_actor_id
  where space_id = p_space_id and space_memberships.user_id = p_member_user_id;

  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, prior_status, next_status, prior_role, next_role, occurred_at
  ) values (
    p_space_id, v_actor_id, p_member_user_id, p_request_id, v_fingerprint,
    'member_removed', 'active', 'revoked', v_membership.role, v_membership.role, v_now
  );

  return query select p_member_user_id, 'revoked'::public.membership_status;
end;
$$;

create function public.leave_household_space(p_space_id uuid, p_request_id uuid)
returns table (user_id uuid, status public.membership_status)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_event public.household_membership_events%rowtype;
  v_membership public.space_memberships%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_fingerprint := private.household_command_fingerprint(
    'leave_household_space|' || p_space_id::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);
  select event.* into v_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id and event.request_id = p_request_id;
  if found then
    if v_event.kind <> 'member_left'
      or v_event.request_fingerprint <> v_fingerprint
      or v_event.subject_user_id <> v_actor_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select v_actor_id, v_event.next_status;
    return;
  end if;

  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;

  select membership.* into v_membership
  from public.space_memberships as membership
  where membership.space_id = p_space_id and membership.user_id = v_actor_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'membership_not_active';
  end if;
  if v_membership.role = 'owner'
    and (select count(*) from public.space_memberships
         where space_id = p_space_id and status = 'active' and role = 'owner') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_owner';
  end if;

  update public.space_memberships
  set status = 'left', ended_at = v_now, ended_by_user_id = v_actor_id
  where space_id = p_space_id and space_memberships.user_id = v_actor_id;

  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, prior_status, next_status, prior_role, next_role, occurred_at
  ) values (
    p_space_id, v_actor_id, v_actor_id, p_request_id, v_fingerprint,
    'member_left', 'active', 'left', v_membership.role, v_membership.role, v_now
  );

  return query select v_actor_id, 'left'::public.membership_status;
end;
$$;

create function public.list_household_members(
  p_space_id uuid,
  p_limit integer default 50,
  p_after_user_id uuid default null
)
returns table (
  user_id uuid,
  role public.member_role,
  status public.membership_status,
  created_at timestamptz,
  activated_at timestamptz,
  ended_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_actor_id is null or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return query
  select membership.user_id, membership.role, membership.status,
         membership.created_at, membership.activated_at, membership.ended_at,
         membership.user_id = v_actor_id
  from public.space_memberships as membership
  where membership.space_id = p_space_id
    and (p_after_user_id is null or membership.user_id > p_after_user_id)
  order by membership.user_id
  limit p_limit;
end;
$$;

create function public.list_household_invitations(
  p_space_id uuid,
  p_limit integer default 50,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  invitation_id uuid,
  effective_status text,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
    or ((p_after_created_at is null) <> (p_after_id is null)) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if private.household_actor_user_id() is null
    or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return query
  select invitation.id,
         case when invitation.status = 'pending' and invitation.expires_at <= now()
           then 'expired' else invitation.status::text end,
         invitation.created_at, invitation.expires_at,
         invitation.accepted_at, invitation.cancelled_at
  from public.household_invitations as invitation
  where invitation.space_id = p_space_id
    and (p_after_created_at is null
      or (invitation.created_at, invitation.id) < (p_after_created_at, p_after_id))
  order by invitation.created_at desc, invitation.id desc
  limit p_limit;
end;
$$;

grant create on schema public to household_command_owner;
grant household_command_owner to postgres;
alter function public.set_household_member_role(uuid, uuid, uuid, public.member_role)
  owner to household_command_owner;
alter function public.remove_household_member(uuid, uuid, uuid)
  owner to household_command_owner;
alter function public.leave_household_space(uuid, uuid)
  owner to household_command_owner;
alter function public.list_household_members(uuid, integer, uuid)
  owner to household_command_owner;
alter function public.list_household_invitations(uuid, integer, timestamptz, uuid)
  owner to household_command_owner;
revoke household_command_owner from postgres;
revoke create on schema public from household_command_owner;

revoke all on function public.set_household_member_role(uuid, uuid, uuid, public.member_role)
  from public, anon, service_role;
revoke all on function public.remove_household_member(uuid, uuid, uuid)
  from public, anon, service_role;
revoke all on function public.leave_household_space(uuid, uuid)
  from public, anon, service_role;
revoke all on function public.list_household_members(uuid, integer, uuid)
  from public, anon, service_role;
revoke all on function public.list_household_invitations(uuid, integer, timestamptz, uuid)
  from public, anon, service_role;

grant execute on function public.set_household_member_role(uuid, uuid, uuid, public.member_role)
  to authenticated;
grant execute on function public.remove_household_member(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.leave_household_space(uuid, uuid)
  to authenticated;
grant execute on function public.list_household_members(uuid, integer, uuid)
  to authenticated;
grant execute on function public.list_household_invitations(uuid, integer, timestamptz, uuid)
  to authenticated;
