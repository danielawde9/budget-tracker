grant household_command_owner to postgres;
set role household_command_owner;

revoke all on function public.create_household_invitation(uuid, uuid, text)
  from public, anon, service_role;
revoke all on function public.accept_household_invitation(uuid, text)
  from public, anon, service_role;
revoke all on function public.cancel_household_invitation(uuid, uuid, uuid)
  from public, anon, service_role;
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

grant execute on function public.create_household_invitation(uuid, uuid, text)
  to authenticated;
grant execute on function public.accept_household_invitation(uuid, text)
  to authenticated;
grant execute on function public.cancel_household_invitation(uuid, uuid, uuid)
  to authenticated;
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

reset role;
revoke household_command_owner from postgres;
