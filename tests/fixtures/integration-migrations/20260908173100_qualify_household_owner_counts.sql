grant create on schema public to household_command_owner;
grant household_command_owner to postgres;

create or replace function public.set_household_member_role(
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
    and (select count(*) from public.space_memberships as owner_membership
         where owner_membership.space_id = p_space_id
           and owner_membership.status = 'active'
           and owner_membership.role = 'owner') <= 1 then
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

create or replace function public.remove_household_member(
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
    and (select count(*) from public.space_memberships as owner_membership
         where owner_membership.space_id = p_space_id
           and owner_membership.status = 'active'
           and owner_membership.role = 'owner') <= 1 then
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

create or replace function public.leave_household_space(p_space_id uuid, p_request_id uuid)
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
    and (select count(*) from public.space_memberships as owner_membership
         where owner_membership.space_id = p_space_id
           and owner_membership.status = 'active'
           and owner_membership.role = 'owner') <= 1 then
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

revoke household_command_owner from postgres;
revoke create on schema public from household_command_owner;
