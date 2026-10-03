create or replace function private.assert_space_membership_invariant(p_space_id uuid)
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
  where space.id = p_space_id
  for update;

  if not found then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where membership.status = 'active' and membership.role = 'owner'
    )::integer
  into v_membership_count, v_active_owner_count
  from public.space_memberships as membership
  where membership.space_id = p_space_id;

  if v_kind = 'personal'
    and not (v_membership_count = 1 and v_active_owner_count = 1) then
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

revoke all on function private.assert_space_membership_invariant(uuid)
  from public, anon, authenticated, service_role;
