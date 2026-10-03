create function private.household_actor_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

create function private.household_has_active_identity(
  p_space_id uuid,
  p_key_version smallint,
  p_identity_digest bytea
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_memberships as membership
    join auth.users as account on account.id = membership.user_id
    where membership.space_id = p_space_id
      and membership.status = 'active'
      and account.email is not null
      and private.household_identity_digest(
        p_key_version,
        private.normalize_household_invitee_email(account.email)
      ) = p_identity_digest
  );
$$;

revoke all on function private.household_actor_user_id() from public, anon, authenticated, service_role;
revoke all on function private.household_has_active_identity(uuid, smallint, bytea)
  from public, anon, authenticated, service_role;
grant execute on function private.household_actor_user_id() to household_command_owner;
grant execute on function private.household_has_active_identity(uuid, smallint, bytea)
  to household_command_owner;

revoke select (id, email, email_confirmed_at) on table auth.users from household_command_owner;

grant create on schema public to household_command_owner;
grant household_command_owner to postgres;

create or replace function public.create_household_invitation(
  p_space_id uuid,
  p_request_id uuid,
  p_invitee_email text
)
returns table (invitation_id uuid, invitation_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_normalized_email text;
  v_key_version smallint;
  v_identity_digest bytea;
  v_fingerprint bytea;
  v_existing_event public.household_membership_events%rowtype;
  v_existing_invitation public.household_invitations%rowtype;
  v_space_kind public.space_kind;
  v_invitation_id uuid;
  v_token text;
  v_created_at timestamptz := now();
  v_expires_at timestamptz;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_request_id is null or p_space_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_normalized_email := private.normalize_household_invitee_email(p_invitee_email);
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.*
  into v_existing_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_event.kind <> 'invitation_created'
      or v_existing_event.invitation_id is null then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    select invitation.*
    into v_existing_invitation
    from public.household_invitations as invitation
    where invitation.id = v_existing_event.invitation_id;

    v_identity_digest := private.household_identity_digest(
      v_existing_invitation.key_version,
      v_normalized_email
    );
    v_fingerprint := private.household_command_fingerprint(
      'create_household_invitation|'
        || p_space_id::text || '|'
        || encode(v_identity_digest, 'hex')
    );

    if v_existing_invitation.space_id <> p_space_id
      or v_existing_event.request_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    v_token := private.derive_household_invitation_token(
      v_existing_invitation.key_version,
      v_actor_id,
      p_request_id,
      p_space_id,
      v_identity_digest
    );
    return query
    select v_existing_invitation.id, v_token, v_existing_invitation.expires_at;
    return;
  end if;

  v_key_version := private.active_household_invitation_key_version();
  v_identity_digest := private.household_identity_digest(v_key_version, v_normalized_email);
  v_fingerprint := private.household_command_fingerprint(
    'create_household_invitation|'
      || p_space_id::text || '|'
      || encode(v_identity_digest, 'hex')
  );

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

  perform private.lock_household_invitee(p_space_id, v_identity_digest);

  if private.household_has_active_identity(
    p_space_id,
    v_key_version,
    v_identity_digest
  ) then
    raise exception using errcode = 'P0001', message = 'membership_already_active';
  end if;

  if exists (
    select 1
    from public.household_invitations as invitation
    where invitation.space_id = p_space_id
      and invitation.invitee_identity_digest = v_identity_digest
      and invitation.status = 'pending'
      and invitation.expires_at > v_created_at
  ) then
    raise exception using errcode = 'P0001', message = 'invitation_already_pending';
  end if;

  v_invitation_id := extensions.gen_random_uuid();
  v_token := private.derive_household_invitation_token(
    v_key_version,
    v_actor_id,
    p_request_id,
    p_space_id,
    v_identity_digest
  );
  v_expires_at := v_created_at + interval '7 days';

  insert into public.household_invitations (
    id, space_id, key_version, invitee_identity_digest, token_digest, status,
    created_by_user_id, created_at, expires_at
  )
  values (
    v_invitation_id, p_space_id, v_key_version, v_identity_digest,
    private.household_invitation_token_digest(v_token), 'pending',
    v_actor_id, v_created_at, v_expires_at
  );

  insert into public.household_membership_events (
    space_id, actor_user_id, request_id, request_fingerprint,
    kind, invitation_id, occurred_at
  )
  values (
    p_space_id, v_actor_id, p_request_id, v_fingerprint,
    'invitation_created', v_invitation_id, v_created_at
  );

  return query select v_invitation_id, v_token, v_expires_at;
end;
$$;

revoke household_command_owner from postgres;
revoke create on schema public from household_command_owner;

revoke all on function public.create_household_invitation(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.create_household_invitation(uuid, uuid, text)
  to authenticated;
