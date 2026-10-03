-- Schedule and approved period history. Bounds always use independent civil-date anchors.
CREATE TABLE public.space_schedule_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES public.spaces(id),
  timezone text NOT NULL,
  payday_day integer NOT NULL CHECK (payday_day BETWEEN 1 AND 31),
  expected_revision_id bigint,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,space_id), UNIQUE(space_id,request_id),
  FOREIGN KEY(expected_revision_id,space_id) REFERENCES public.space_schedule_revisions(id,space_id),
  CHECK (expected_revision_id IS NULL OR expected_revision_id < id)
);
CREATE INDEX space_schedule_revisions_head_idx ON public.space_schedule_revisions(space_id,id DESC);
CREATE TABLE public.space_period_definitions (
  space_id uuid NOT NULL REFERENCES public.spaces(id),
  period_key date NOT NULL CHECK (period_key=date_trunc('month',period_key)::date),
  period_start date NOT NULL,
  end_exclusive date NOT NULL,
  timezone text NOT NULL,
  payday_day integer NOT NULL CHECK (payday_day BETWEEN 1 AND 31),
  schedule_revision_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,period_key),
  FOREIGN KEY(schedule_revision_id,space_id) REFERENCES public.space_schedule_revisions(id,space_id),
  CHECK (period_start=least(period_key+(payday_day-1),(period_key+interval '1 month'-interval '1 day')::date)),
  CHECK (end_exclusive=least((period_key+interval '1 month')::date+(payday_day-1),(period_key+interval '2 months'-interval '1 day')::date))
);
DO $$
declare tab text;
begin
  foreach tab in array array['space_schedule_revisions','space_period_definitions'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(space_id))',tab||'_member_read',tab);
    execute format('create trigger %I before insert on public.%I for each statement execute function private.require_table_owner_write()',tab||'_owner_write',tab);
    execute format('create trigger %I before update or delete or truncate on public.%I for each statement execute function private.planning_reject_mutation()',tab||'_reject_mutation',tab);
    execute format('create trigger %I before insert on public.%I for each row execute function private.validate_space_timezone()',tab||'_timezone',tab);
  end loop;
end; $$;

-- Server-only core; public entry points supply authorization. B2 uses this for selected-period reads.
CREATE FUNCTION private.space_period_context(p_space_id uuid,p_period_key date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
declare
  v_timezone text; v_payday integer; v_today date; v_key date;
  v_start date; v_end date; v_head bigint; v_definition public.space_period_definitions%rowtype;
begin
  select timezone,payday_day into v_timezone,v_payday from public.spaces where id=p_space_id;
  if not found then raise exception using errcode='42501',message='planning_not_authorized'; end if;
  v_today := private.space_today(p_space_id);
  v_key := coalesce(p_period_key,date_trunc('month',private.space_period_start(p_space_id,now()))::date);
  if not isfinite(v_key) or v_key<>date_trunc('month',v_key)::date then
    raise exception using errcode='22023',message='space_period_key_invalid';
  end if;
  select * into v_definition from public.space_period_definitions where space_id=p_space_id and period_key=v_key;
  if found then
    v_timezone:=v_definition.timezone; v_payday:=v_definition.payday_day;
    v_start:=v_definition.period_start; v_end:=v_definition.end_exclusive; v_head:=v_definition.schedule_revision_id;
    -- In normal operation schedule locking keeps the zones equal; frozen history remains authoritative.
    v_today:=(now() at time zone v_timezone)::date;
  else
    select period_start,period_end into v_start,v_end from private.space_period_bounds(p_space_id,v_key);
    select id into v_head from public.space_schedule_revisions where space_id=p_space_id order by id desc limit 1;
  end if;
  return jsonb_build_object('spaceId',p_space_id,'timezone',v_timezone,'today',v_today,
    'periodKey',v_key,'start',v_start,'endExclusive',v_end,'asOf',least(v_today,v_end-1),
    'paydayDay',v_payday,'scheduleHead',v_head::text);
end; $$;
CREATE FUNCTION public.space_period_context(p_space_id uuid,p_period_key date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501',message='planning_not_authorized';
  end if;
  return private.space_period_context(p_space_id,p_period_key);
end; $$;

CREATE OR REPLACE FUNCTION public.space_clock(p_space_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
declare v_context jsonb;
begin
  v_context:=public.space_period_context(p_space_id);
  return jsonb_build_object('timezone',v_context->'timezone','today',v_context->'today',
    'currentMonth',v_context->'periodKey','paydayDay',v_context->'paydayDay',
    'periodStart',v_context->'start','periodEnd',((v_context->>'endExclusive')::date-1),
    'periodEndExclusive',v_context->'endExclusive','scheduleHead',v_context->'scheduleHead');
end; $$;

-- Called inside publish/close transactions. The same space lock protects schedule writes.
CREATE FUNCTION private.ensure_space_period_definition(p_space_id uuid,p_period_key date)
RETURNS public.space_period_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
declare v_context jsonb; v_definition public.space_period_definitions%rowtype;
begin
  perform private.lock_planning_actor(p_space_id);
  if p_period_key is null then raise exception using errcode='22023',message='space_period_key_invalid'; end if;
  v_context:=private.space_period_context(p_space_id,p_period_key);
  insert into public.space_period_definitions(space_id,period_key,period_start,end_exclusive,timezone,payday_day,schedule_revision_id)
    values(p_space_id,p_period_key,(v_context->>'start')::date,(v_context->>'endExclusive')::date,
      v_context->>'timezone',(v_context->>'paydayDay')::integer,(v_context->>'scheduleHead')::bigint)
    on conflict(space_id,period_key) do nothing;
  select * into v_definition from public.space_period_definitions where space_id=p_space_id and period_key=p_period_key;
  return v_definition;
end; $$;

CREATE FUNCTION public.set_space_schedule(p_space_id uuid,p_request_id uuid,p_timezone text,p_payday_day integer,p_expected_revision_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
declare v_actor uuid; v_head bigint; v_revision bigint; v_fingerprint bytea; v_result jsonb;
begin
  v_actor:=private.lock_planning_actor(p_space_id);
  if not private.is_active_owner(p_space_id) then raise exception using errcode='42501',message='planning_not_authorized'; end if;
  if p_request_id is null or p_timezone is null or p_payday_day is null or p_payday_day not between 1 and 31
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception using errcode='22023',message='space_schedule_invalid';
  end if;
  v_fingerprint:=private.planning_fingerprint('set_space_schedule',v_actor,
    jsonb_build_object('timezone',p_timezone,'paydayDay',p_payday_day,'expectedRevisionId',p_expected_revision_id));
  v_result:=private.planning_replay(p_space_id,p_request_id,'set_space_schedule',v_actor,v_fingerprint);
  if v_result is not null then return v_result; end if;
  select id into v_head from public.space_schedule_revisions where space_id=p_space_id order by id desc limit 1;
  if v_head is distinct from p_expected_revision_id then raise exception using errcode='40001',message='planning_stale_revision'; end if;
  if exists(select 1 from public.allocation_month_snapshots where space_id=p_space_id)
    or exists(select 1 from public.budget_month_closes where space_id=p_space_id)
    or exists(select 1 from public.space_period_definitions where space_id=p_space_id) then
    raise exception using errcode='P0001',message='space_schedule_locked';
  end if;
  insert into public.space_schedule_revisions(space_id,timezone,payday_day,expected_revision_id,request_id,actor_id)
    values(p_space_id,p_timezone,p_payday_day,p_expected_revision_id,p_request_id,v_actor) returning id into v_revision;
  update public.spaces set timezone=p_timezone,payday_day=p_payday_day where id=p_space_id;
  v_result:=jsonb_build_object('revisionId',v_revision::text,'clock',public.space_clock(p_space_id));
  insert into public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result)
    values(p_space_id,p_request_id,'set_space_schedule',v_fingerprint,v_actor,v_result);
  return v_result;
end; $$;
REVOKE ALL ON FUNCTION private.space_period_context(uuid,date),private.ensure_space_period_definition(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.space_period_context(uuid,date),public.set_space_schedule(uuid,uuid,text,integer,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.space_period_context(uuid,date),public.set_space_schedule(uuid,uuid,text,integer,bigint) TO authenticated;
REVOKE ALL ON SEQUENCE public.space_schedule_revisions_id_seq FROM PUBLIC,anon,authenticated,service_role;
