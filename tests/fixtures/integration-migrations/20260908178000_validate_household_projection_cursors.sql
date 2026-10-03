grant create on schema public, private to household_command_owner;
grant household_command_owner to postgres;
set role household_command_owner;

alter function public.list_household_members(uuid, integer, uuid)
  set schema private;
alter function private.list_household_members(uuid, integer, uuid)
  rename to household_execute_member_listing;
alter function public.list_household_invitations(uuid, integer, timestamptz, uuid)
  set schema private;
alter function private.list_household_invitations(uuid, integer, timestamptz, uuid)
  rename to household_execute_invitation_listing;

revoke all on function private.household_execute_member_listing(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.household_execute_invitation_listing(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;

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
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if private.household_actor_user_id() is null
    or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if p_after_user_id is not null and not exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = p_after_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  return query
  select result.user_id, result.role, result.status, result.created_at,
         result.activated_at, result.ended_at, result.is_self
  from private.household_execute_member_listing(
    p_space_id,
    p_limit,
    p_after_user_id
  ) as result;
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
declare
  v_after_created_at timestamptz;
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

  if p_after_id is not null then
    select invitation.created_at
    into v_after_created_at
    from public.household_invitations as invitation
    where invitation.space_id = p_space_id
      and invitation.id = p_after_id;
    if not found
      or date_trunc('milliseconds', v_after_created_at)
        <> date_trunc('milliseconds', p_after_created_at) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
  end if;

  return query
  select result.invitation_id, result.effective_status, result.created_at,
         result.expires_at, result.accepted_at, result.cancelled_at
  from private.household_execute_invitation_listing(
    p_space_id,
    p_limit,
    v_after_created_at,
    p_after_id
  ) as result;
end;
$$;

revoke all on function public.list_household_members(uuid, integer, uuid)
  from public, anon, service_role;
revoke all on function public.list_household_invitations(uuid, integer, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.list_household_members(uuid, integer, uuid)
  to authenticated;
grant execute on function public.list_household_invitations(uuid, integer, timestamptz, uuid)
  to authenticated;

reset role;
revoke household_command_owner from postgres;
revoke create on schema public, private from household_command_owner;
