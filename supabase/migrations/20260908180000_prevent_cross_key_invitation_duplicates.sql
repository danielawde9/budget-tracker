grant create on schema public to household_command_owner;
grant household_command_owner to postgres;
set role household_command_owner;

create or replace function public.create_household_invitation(
  p_space_id uuid,
  p_request_id uuid,
  p_invitee_email text
)
returns table (invitation_id uuid, invitation_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_space_kind public.space_kind;
  v_normalized_email text;
  v_request_exists boolean;
  v_duplicate_exists boolean;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_request_id is null or p_space_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  perform private.lock_household_request(v_actor_id, p_request_id);
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

  select exists (
    select 1
    from public.household_membership_events as event
    where event.actor_user_id = v_actor_id
      and event.request_id = p_request_id
    limit 1
  )
  into v_request_exists;

  if not v_request_exists then
    v_normalized_email := private.normalize_household_invitee_email(p_invitee_email);
    select exists (
      select 1
      from public.household_invitations as invitation
      where invitation.space_id = p_space_id
        and invitation.status = 'pending'
        and invitation.expires_at > v_now
        and invitation.invitee_identity_digest = private.household_identity_digest(
          invitation.key_version,
          v_normalized_email
        )
      limit 1
    )
    into v_duplicate_exists;

    if v_duplicate_exists then
      raise exception using errcode = 'P0001', message = 'invitation_already_pending';
    end if;
  end if;

  return query
  select result.invitation_id, result.invitation_token, result.expires_at
  from private.household_execute_invitation_creation(
    p_space_id,
    p_request_id,
    p_invitee_email
  ) as result;
end;
$$;

revoke all on function public.create_household_invitation(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.create_household_invitation(uuid, uuid, text)
  to authenticated;

reset role;
revoke household_command_owner from postgres;
revoke create on schema public from household_command_owner;
