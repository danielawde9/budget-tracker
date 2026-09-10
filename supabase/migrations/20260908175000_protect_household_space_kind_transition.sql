create or replace function private.enforce_space_row_membership_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_space_membership_invariant(new.id);

  if new.kind = 'personal' and exists (
    select 1
    from public.household_invitations as invitation
    where invitation.space_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'household invitations require a household space';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_space_row_membership_invariant()
  from public, anon, authenticated, service_role;
