revoke select on table private.household_invitation_keys from household_command_owner;

create function private.normalize_household_invitee_email(p_email text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if p_email is null
    or octet_length(v_email) not between 3 and 254
    or v_email ~ '[[:space:][:cntrl:]]'
    or length(v_email) - length(replace(v_email, '@', '')) <> 1
    or split_part(v_email, '@', 1) = ''
    or split_part(v_email, '@', 2) = '' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  return v_email;
end;
$$;

create function private.active_household_invitation_key_version()
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key_version smallint;
begin
  select keyring.key_version
  into v_key_version
  from private.household_invitation_keys as keyring
  where keyring.retired_at is null;

  if not found then
    raise exception using errcode = '55000', message = 'invitation_key_unavailable';
  end if;

  return v_key_version;
end;
$$;

create function private.household_identity_digest(p_key_version smallint, p_normalized_email text)
returns bytea
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_key bytea;
begin
  select keyring.identity_hmac_key
  into v_key
  from private.household_invitation_keys as keyring
  where keyring.key_version = p_key_version;

  if not found then
    raise exception using errcode = '55000', message = 'invitation_key_unavailable';
  end if;

  return extensions.hmac(
    convert_to('household-invitation-identity-v1|' || p_normalized_email, 'UTF8'),
    v_key,
    'sha256'
  );
end;
$$;

create function private.derive_household_invitation_token(
  p_key_version smallint,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_space_id uuid,
  p_identity_digest bytea
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_key bytea;
  v_encoded text;
begin
  select keyring.token_hmac_key
  into v_key
  from private.household_invitation_keys as keyring
  where keyring.key_version = p_key_version;

  if not found then
    raise exception using errcode = '55000', message = 'invitation_key_unavailable';
  end if;

  v_encoded := encode(
    extensions.hmac(
      convert_to(
        'household-invitation-token-v1|'
          || p_actor_user_id::text || '|'
          || p_request_id::text || '|'
          || p_space_id::text || '|'
          || encode(p_identity_digest, 'hex'),
        'UTF8'
      ),
      v_key,
      'sha256'
    ),
    'base64'
  );

  return rtrim(replace(replace(replace(v_encoded, E'\n', ''), '+', '-'), '/', '_'), '=');
end;
$$;

create function private.household_invitation_token_digest(p_token text)
returns bytea
language sql
immutable
security definer
set search_path = pg_catalog, extensions
as $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$$;

create function private.household_command_fingerprint(p_canonical_input text)
returns bytea
language sql
immutable
security definer
set search_path = pg_catalog, extensions
as $$
  select extensions.digest(convert_to(p_canonical_input, 'UTF8'), 'sha256');
$$;

create function private.lock_household_request(p_actor_user_id uuid, p_request_id uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended(p_actor_user_id::text || ':' || p_request_id::text, 7421)
  );
$$;

create function private.lock_household_invitee(p_space_id uuid, p_identity_digest bytea)
returns void
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended(p_space_id::text || ':' || encode(p_identity_digest, 'hex'), 7422)
  );
$$;

revoke all on function private.normalize_household_invitee_email(text) from public, anon, authenticated, service_role;
revoke all on function private.active_household_invitation_key_version() from public, anon, authenticated, service_role;
revoke all on function private.household_identity_digest(smallint, text) from public, anon, authenticated, service_role;
revoke all on function private.derive_household_invitation_token(smallint, uuid, uuid, uuid, bytea) from public, anon, authenticated, service_role;
revoke all on function private.household_invitation_token_digest(text) from public, anon, authenticated, service_role;
revoke all on function private.household_command_fingerprint(text) from public, anon, authenticated, service_role;
revoke all on function private.lock_household_request(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.lock_household_invitee(uuid, bytea) from public, anon, authenticated, service_role;

grant execute on function private.normalize_household_invitee_email(text) to household_command_owner;
grant execute on function private.active_household_invitation_key_version() to household_command_owner;
grant execute on function private.household_identity_digest(smallint, text) to household_command_owner;
grant execute on function private.derive_household_invitation_token(smallint, uuid, uuid, uuid, bytea) to household_command_owner;
grant execute on function private.household_invitation_token_digest(text) to household_command_owner;
grant execute on function private.household_command_fingerprint(text) to household_command_owner;
grant execute on function private.lock_household_request(uuid, uuid) to household_command_owner;
grant execute on function private.lock_household_invitee(uuid, bytea) to household_command_owner;

create function public.create_household_invitation(
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
  v_actor_id uuid := auth.uid();
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

  if exists (
    select 1
    from public.space_memberships as membership
    join auth.users as account on account.id = membership.user_id
    where membership.space_id = p_space_id
      and membership.status = 'active'
      and account.email is not null
      and private.household_identity_digest(
        v_key_version,
        private.normalize_household_invitee_email(account.email)
      ) = v_identity_digest
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
    id,
    space_id,
    key_version,
    invitee_identity_digest,
    token_digest,
    status,
    created_by_user_id,
    created_at,
    expires_at
  )
  values (
    v_invitation_id,
    p_space_id,
    v_key_version,
    v_identity_digest,
    private.household_invitation_token_digest(v_token),
    'pending',
    v_actor_id,
    v_created_at,
    v_expires_at
  );

  insert into public.household_membership_events (
    space_id,
    actor_user_id,
    request_id,
    request_fingerprint,
    kind,
    invitation_id,
    occurred_at
  )
  values (
    p_space_id,
    v_actor_id,
    p_request_id,
    v_fingerprint,
    'invitation_created',
    v_invitation_id,
    v_created_at
  );

  return query select v_invitation_id, v_token, v_expires_at;
end;
$$;

grant create on schema public to household_command_owner;
grant household_command_owner to postgres;
alter function public.create_household_invitation(uuid, uuid, text)
  owner to household_command_owner;
revoke household_command_owner from postgres;
revoke create on schema public from household_command_owner;

revoke all on function public.create_household_invitation(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.create_household_invitation(uuid, uuid, text)
  to authenticated;
