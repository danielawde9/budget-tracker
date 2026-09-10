create function private.household_actor_email_confirmed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as account
    where account.id = auth.uid()
      and account.email is not null
      and account.email_confirmed_at is not null
  );
$$;

create function private.household_actor_identity_digest(p_key_version smallint)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select private.household_identity_digest(
    p_key_version,
    private.normalize_household_invitee_email(account.email)
  )
  from auth.users as account
  where account.id = auth.uid()
    and account.email is not null
    and account.email_confirmed_at is not null;
$$;

revoke all on function private.household_actor_email_confirmed()
  from public, anon, authenticated, service_role;
revoke all on function private.household_actor_identity_digest(smallint)
  from public, anon, authenticated, service_role;
grant execute on function private.household_actor_email_confirmed()
  to household_command_owner;
grant execute on function private.household_actor_identity_digest(smallint)
  to household_command_owner;

create function public.accept_household_invitation(
  p_request_id uuid,
  p_invitation_token text
)
returns table (
  space_id uuid,
  membership_status public.membership_status,
  role public.member_role
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_token_digest bytea;
  v_fingerprint bytea;
  v_existing_event public.household_membership_events%rowtype;
  v_discovered_space_id uuid;
  v_invitation public.household_invitations%rowtype;
  v_membership public.space_memberships%rowtype;
  v_actor_identity_digest bytea;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_invitation_token is null
    or p_invitation_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  v_token_digest := private.household_invitation_token_digest(p_invitation_token);
  v_fingerprint := private.household_command_fingerprint(
    'accept_household_invitation|' || encode(v_token_digest, 'hex')
  );
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.*
  into v_existing_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_event.kind <> 'invitation_accepted'
      or v_existing_event.request_fingerprint <> v_fingerprint
      or v_existing_event.subject_user_id <> v_actor_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    return query
    select v_existing_event.space_id, v_existing_event.next_status, v_existing_event.next_role;
    return;
  end if;

  if not private.household_actor_email_confirmed() then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select invitation.space_id
  into v_discovered_space_id
  from public.household_invitations as invitation
  where invitation.token_digest = v_token_digest;

  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  v_space_kind := private.lock_household_space(v_discovered_space_id);
  if v_space_kind is null or v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  select invitation.*
  into v_invitation
  from public.household_invitations as invitation
  where invitation.token_digest = v_token_digest
  for update;

  v_actor_identity_digest := private.household_actor_identity_digest(v_invitation.key_version);
  if v_invitation.status <> 'pending'
    or v_invitation.expires_at <= v_now
    or v_actor_identity_digest is null
    or v_actor_identity_digest <> v_invitation.invitee_identity_digest then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  select membership.*
  into v_membership
  from public.space_memberships as membership
  where membership.space_id = v_invitation.space_id
    and membership.user_id = v_actor_id
  for update;

  if found and v_membership.status = 'active' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  if found then
    update public.space_memberships
    set status = 'active',
        role = 'member',
        activated_at = v_now,
        ended_at = null,
        ended_by_user_id = null
    where space_memberships.space_id = v_invitation.space_id
      and space_memberships.user_id = v_actor_id;
  else
    insert into public.space_memberships (
      space_id, user_id, role, status, created_at, activated_at
    )
    values (
      v_invitation.space_id, v_actor_id, 'member', 'active', v_now, v_now
    );
  end if;

  update public.household_invitations
  set status = 'accepted',
      accepted_by_user_id = v_actor_id,
      accepted_at = v_now
  where id = v_invitation.id;

  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, invitation_id, prior_status, next_status, prior_role, next_role, occurred_at
  )
  values (
    v_invitation.space_id, v_actor_id, v_actor_id, p_request_id, v_fingerprint,
    'invitation_accepted', v_invitation.id,
    v_membership.status, 'active', v_membership.role, 'member', v_now
  );

  return query select v_invitation.space_id, 'active'::public.membership_status, 'member'::public.member_role;
end;
$$;

create function public.cancel_household_invitation(
  p_space_id uuid,
  p_request_id uuid,
  p_invitation_id uuid
)
returns table (
  invitation_id uuid,
  status public.household_invitation_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_existing_event public.household_membership_events%rowtype;
  v_invitation public.household_invitations%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null or p_invitation_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_fingerprint := private.household_command_fingerprint(
    'cancel_household_invitation|' || p_space_id::text || '|' || p_invitation_id::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.*
  into v_existing_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_event.kind <> 'invitation_cancelled'
      or v_existing_event.request_fingerprint <> v_fingerprint
      or v_existing_event.invitation_id <> p_invitation_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select p_invitation_id, 'cancelled'::public.household_invitation_status;
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

  select invitation.*
  into v_invitation
  from public.household_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.space_id = p_space_id
  for update;

  if not found or v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  update public.household_invitations
  set status = 'cancelled',
      cancelled_by_user_id = v_actor_id,
      cancelled_at = v_now
  where id = v_invitation.id;

  insert into public.household_membership_events (
    space_id, actor_user_id, request_id, request_fingerprint,
    kind, invitation_id, occurred_at
  )
  values (
    p_space_id, v_actor_id, p_request_id, v_fingerprint,
    'invitation_cancelled', p_invitation_id, v_now
  );

  return query select p_invitation_id, 'cancelled'::public.household_invitation_status;
end;
$$;

grant create on schema public to household_command_owner;
grant household_command_owner to postgres;
alter function public.accept_household_invitation(uuid, text)
  owner to household_command_owner;
alter function public.cancel_household_invitation(uuid, uuid, uuid)
  owner to household_command_owner;
revoke household_command_owner from postgres;
revoke create on schema public from household_command_owner;

revoke all on function public.accept_household_invitation(uuid, text)
  from public, anon, service_role;
revoke all on function public.cancel_household_invitation(uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.accept_household_invitation(uuid, text)
  to authenticated;
grant execute on function public.cancel_household_invitation(uuid, uuid, uuid)
  to authenticated;
