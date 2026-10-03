create extension if not exists pgcrypto;

create type public.space_kind as enum ('personal', 'household');
create type public.member_role as enum ('owner', 'member');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind public.space_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.space_memberships (
  space_id uuid not null references public.spaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index space_memberships_user_space_idx
  on public.space_memberships (user_id, space_id);

create schema private;

create function private.is_active_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = (select auth.uid())
  );
$$;

alter table public.spaces enable row level security;
alter table public.space_memberships enable row level security;

create policy spaces_read_for_members
  on public.spaces
  for select
  to authenticated
  using ((select private.is_active_member(id)));

create policy memberships_read_for_self
  on public.space_memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create function public.create_space(
  p_name text,
  p_kind public.space_kind
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_space_id uuid;
begin
  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'an authenticated user is required';
  end if;

  insert into public.spaces (name, kind)
  values (btrim(p_name), p_kind)
  returning spaces.id into v_space_id;

  insert into public.space_memberships (space_id, user_id, role)
  values (v_space_id, v_actor_id, 'owner');

  return query select v_space_id;
end;
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.is_active_member(uuid) from public;
grant execute on function private.is_active_member(uuid) to authenticated;

revoke all on table public.spaces, public.space_memberships from anon, authenticated;
grant select on table public.spaces, public.space_memberships to authenticated;

revoke all on function public.create_space(text, public.space_kind) from public;
grant execute on function public.create_space(text, public.space_kind) to authenticated;
