-- v2 invitations use owner-created, email-bound links. No mail provider or
-- service credential is needed. The browser generates 256 bits of randomness;
-- only its SHA-256 digest is stored. Existing spaces and money are untouched.
create table budget.space_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id),
  unique (space_id, created_by, request_id)
);
create index space_invitations_space on budget.space_invitations(space_id, created_at desc);
alter table budget.space_invitations enable row level security;
revoke all on budget.space_invitations from public, anon, authenticated, service_role;

create function budget.require_owner(p_space uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from budget.space_members where space_id=p_space and user_id=(select auth.uid()) and role='owner') then
    raise exception using errcode='42501', message='BUDGET_OWNER_REQUIRED';
  end if;
end;
$$;
revoke all on function budget.require_owner(uuid) from public, anon, authenticated, service_role;

create function public.space_invitations(p_space uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform budget.require_owner(p_space);
  return (select coalesce(jsonb_agg(jsonb_build_object('invitationId', id, 'email', email, 'expiresAt', expires_at) order by created_at desc), '[]'::jsonb)
    from budget.space_invitations where space_id=p_space and revoked_at is null and accepted_by is null and expires_at>now());
end;
$$;

create function public.create_space_invitation(p_space uuid, p_request uuid, p_email text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_hash text := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  v_invite budget.space_invitations;
begin
  perform budget.require_owner(p_space);
  perform budget.lock_space(p_space);
  if p_request is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' or v_email is null or char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023', message='BUDGET_INVITATION_INPUT';
  end if;
  select * into v_invite from budget.space_invitations where space_id=p_space and created_by=(select auth.uid()) and request_id=p_request;
  if found then
    if v_invite.email<>v_email or v_invite.token_hash<>v_hash then
      raise exception using errcode='22023', message='BUDGET_REQUEST_REUSED';
    end if;
    return jsonb_build_object('invitationId', v_invite.id, 'expiresAt', v_invite.expires_at);
  end if;
  if exists (select 1 from budget.space_members m join auth.users u on u.id=m.user_id where m.space_id=p_space and lower(u.email)=v_email) then
    raise exception using errcode='22023', message='BUDGET_ALREADY_MEMBER';
  end if;
  if (select count(*) from budget.space_invitations where space_id=p_space and email<>v_email and revoked_at is null and accepted_by is null and expires_at>now())>=20 then
    raise exception using errcode='22023', message='BUDGET_INVITATION_LIMIT';
  end if;
  -- A new link replaces the previous outstanding link to the same address.
  update budget.space_invitations set revoked_at=now() where space_id=p_space and email=v_email and accepted_by is null and revoked_at is null;
  insert into budget.space_invitations(space_id, email, token_hash, created_by, request_id)
    values (p_space, v_email, v_hash, (select auth.uid()), p_request) returning * into v_invite;
  return jsonb_build_object('invitationId', v_invite.id, 'expiresAt', v_invite.expires_at);
end;
$$;

create function public.revoke_space_invitation(p_space uuid, p_invitation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform budget.require_owner(p_space);
  perform budget.lock_space(p_space);
  update budget.space_invitations set revoked_at=coalesce(revoked_at, now()) where id=p_invitation and space_id=p_space and accepted_by is null;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.accept_space_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_invite budget.space_invitations;
  v_email text;
begin
  if v_user is null then raise exception using errcode='42501', message='BUDGET_NOT_AUTHENTICATED'; end if;
  select lower(email) into v_email from auth.users where id=v_user and email_confirmed_at is not null;
  select * into v_invite from budget.space_invitations where token_hash=encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or v_email is null or v_email<>v_invite.email then
    raise exception using errcode='22023', message='BUDGET_INVITATION_INVALID';
  end if;
  -- Lock in the same order as owner commands; re-read after waiting.
  perform budget.lock_space(v_invite.space_id);
  select * into v_invite from budget.space_invitations where id=v_invite.id for update;
  if v_invite.accepted_by=v_user then return jsonb_build_object('spaceId', v_invite.space_id); end if;
  if v_invite.accepted_by is not null or v_invite.revoked_at is not null or v_invite.expires_at<=now() then
    raise exception using errcode='22023', message='BUDGET_INVITATION_INVALID';
  end if;
  insert into budget.space_members(space_id, user_id, role) values (v_invite.space_id, v_user, 'member') on conflict do nothing;
  update budget.space_invitations set accepted_by=v_user where id=v_invite.id;
  return jsonb_build_object('spaceId', v_invite.space_id);
end;
$$;

revoke all on function public.space_invitations(uuid) from public, anon, service_role;
revoke all on function public.create_space_invitation(uuid, uuid, text, text) from public, anon, service_role;
revoke all on function public.revoke_space_invitation(uuid, uuid) from public, anon, service_role;
revoke all on function public.accept_space_invitation(text) from public, anon, service_role;
grant execute on function public.space_invitations(uuid) to authenticated;
grant execute on function public.create_space_invitation(uuid, uuid, text, text) to authenticated;
grant execute on function public.revoke_space_invitation(uuid, uuid) to authenticated;
grant execute on function public.accept_space_invitation(text) to authenticated;
