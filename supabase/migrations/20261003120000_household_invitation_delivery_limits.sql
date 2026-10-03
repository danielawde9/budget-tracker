-- Durable, atomic limits survive Edge Function isolate restarts. No email or token is stored.
create table private.household_invitation_delivery_limits (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  window_start timestamptz not null,
  attempts integer not null check (attempts >= 0),
  primary key (actor_user_id, scope)
);
alter table private.household_invitation_delivery_limits enable row level security;
revoke all on private.household_invitation_delivery_limits from public, anon, authenticated, service_role;

create function public.consume_household_invitation_delivery_limit(p_space_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_window timestamptz;
  v_scope text;
  v_actor_attempts integer;
  v_space_attempts integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.space_memberships as membership
    join public.spaces as space on space.id = membership.space_id
    where membership.user_id = v_actor and membership.space_id = p_space_id
      and membership.role = 'owner' and membership.status = 'active'
      and space.kind = 'household'
  ) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- One lock per actor serializes all their households and both counters.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-delivery|' || v_actor::text, 0));
  v_window := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  foreach v_scope in array array['actor', p_space_id::text] loop
    insert into private.household_invitation_delivery_limits (actor_user_id, scope, window_start, attempts)
    values (v_actor, v_scope, v_window, 0)
    on conflict (actor_user_id, scope) do update
      set attempts = case when household_invitation_delivery_limits.window_start = excluded.window_start
          then household_invitation_delivery_limits.attempts else 0 end,
          window_start = excluded.window_start;
  end loop;
  select attempts into v_actor_attempts from private.household_invitation_delivery_limits
    where actor_user_id = v_actor and scope = 'actor';
  select attempts into v_space_attempts from private.household_invitation_delivery_limits
    where actor_user_id = v_actor and scope = p_space_id::text;
  if v_actor_attempts >= 20 or v_space_attempts >= 3 then return false; end if;
  update private.household_invitation_delivery_limits set attempts = attempts + 1
    where actor_user_id = v_actor and scope in ('actor', p_space_id::text);
  return true;
end;
$$;
revoke all on function public.consume_household_invitation_delivery_limit(uuid) from public, anon, service_role;
grant execute on function public.consume_household_invitation_delivery_limit(uuid) to authenticated;
