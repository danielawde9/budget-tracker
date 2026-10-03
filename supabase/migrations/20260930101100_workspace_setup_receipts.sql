-- Before a space exists its actor/request owns construction. Wallet construction
-- belongs to space/request across active members; actor_id records its creator.
-- Exact immutable bodies replay; normal Manage constructors remain available.
CREATE TABLE public.workspace_setup_receipts (
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 space_id uuid REFERENCES public.spaces(id),
 request_id uuid NOT NULL,
 command text NOT NULL CHECK(command IN ('create_onboarding_space','create_onboarding_wallet')),
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((command='create_onboarding_space')=(space_id IS NULL))
);
CREATE UNIQUE INDEX workspace_setup_space_request ON public.workspace_setup_receipts(actor_id,request_id) WHERE space_id IS NULL;
CREATE UNIQUE INDEX workspace_setup_wallet_request ON public.workspace_setup_receipts(space_id,request_id) WHERE space_id IS NOT NULL;
ALTER TABLE public.workspace_setup_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_setup_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_onboarding_space(p_request_id uuid,p_name text,p_kind public.space_kind,p_timezone text,p_payday_day integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=auth.uid(); v_payload jsonb; v_receipt public.workspace_setup_receipts%rowtype; v_space uuid; v_schedule jsonb; v_result jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION USING errcode='42501',message='workspace_setup_not_authorized'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION USING errcode='22023',message='workspace_setup_request_required'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace_setup:'||v_actor::text||':'||p_request_id::text,0));
 v_payload:=jsonb_build_object('name',p_name,'kind',p_kind,'timezone',p_timezone,'paydayDay',p_payday_day);
 SELECT * INTO v_receipt FROM public.workspace_setup_receipts WHERE actor_id=v_actor AND space_id IS NULL AND request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.command<>'create_onboarding_space' OR v_receipt.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION USING errcode='22023',message='workspace_setup_idempotency_conflict'; END IF;
  IF NOT private.is_active_member((v_receipt.result->>'spaceId')::uuid) THEN RAISE EXCEPTION USING errcode='42501',message='workspace_setup_not_authorized'; END IF;
  RETURN v_receipt.result;
 END IF;
 SELECT id INTO v_space FROM public.create_space(p_name,p_kind);
 v_schedule:=public.set_space_schedule(v_space,p_request_id,p_timezone,p_payday_day,NULL);
 v_result:=jsonb_build_object('spaceId',v_space,'clock',v_schedule->'clock');
 INSERT INTO public.workspace_setup_receipts(actor_id,request_id,command,payload,result) VALUES(v_actor,p_request_id,'create_onboarding_space',v_payload,v_result);
 RETURN v_result;
END; $$;

CREATE FUNCTION public.create_onboarding_wallet(p_space_id uuid,p_request_id uuid,p_name text,p_currency public.currency_code)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid; v_payload jsonb; v_receipt public.workspace_setup_receipts%rowtype; v_wallet uuid; v_result jsonb;
BEGIN
 v_actor:=private.lock_planning_actor(p_space_id);
 IF p_request_id IS NULL THEN RAISE EXCEPTION USING errcode='22023',message='workspace_setup_request_required'; END IF;
 v_payload:=jsonb_build_object('name',p_name,'currency',p_currency);
 SELECT * INTO v_receipt FROM public.workspace_setup_receipts WHERE space_id=p_space_id AND request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.command<>'create_onboarding_wallet' OR v_receipt.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION USING errcode='22023',message='workspace_setup_idempotency_conflict'; END IF;
  RETURN v_receipt.result;
 END IF;
 SELECT id INTO v_wallet FROM public.create_wallet(p_space_id,p_name,p_currency);
 v_result:=jsonb_build_object('walletId',v_wallet);
 INSERT INTO public.workspace_setup_receipts(actor_id,space_id,request_id,command,payload,result) VALUES(v_actor,p_space_id,p_request_id,'create_onboarding_wallet',v_payload,v_result);
 RETURN v_result;
END; $$;

CREATE FUNCTION public.find_workspace_setup_receipt(p_request_id uuid,p_space_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid:=auth.uid(); v_receipt public.workspace_setup_receipts%rowtype;
BEGIN
 IF v_actor IS NULL OR (p_space_id IS NOT NULL AND NOT private.is_active_member(p_space_id)) THEN RAISE EXCEPTION USING errcode='42501',message='workspace_setup_not_authorized'; END IF;
 SELECT * INTO v_receipt FROM public.workspace_setup_receipts WHERE request_id=p_request_id AND ((p_space_id IS NULL AND space_id IS NULL AND actor_id=v_actor) OR (p_space_id IS NOT NULL AND space_id=p_space_id));
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p_space_id IS NULL AND NOT private.is_active_member((v_receipt.result->>'spaceId')::uuid) THEN RAISE EXCEPTION USING errcode='42501',message='workspace_setup_not_authorized'; END IF;
 RETURN jsonb_build_object('command',v_receipt.command,'result',v_receipt.result);
END; $$;
REVOKE ALL ON FUNCTION public.create_onboarding_space(uuid,text,public.space_kind,text,integer),public.create_onboarding_wallet(uuid,uuid,text,public.currency_code),public.find_workspace_setup_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_onboarding_space(uuid,text,public.space_kind,text,integer),public.create_onboarding_wallet(uuid,uuid,text,public.currency_code),public.find_workspace_setup_receipt(uuid,uuid) TO authenticated;

-- Preserve accepted B1 receipts before validating a new schedule body. A returned
-- space_schedule_invalid for a non-null request now follows the same serialized
-- original-receipt check as the setup constructor. CREATE OR REPLACE preserves
-- the existing signature and authenticated-only grants.
CREATE OR REPLACE FUNCTION public.set_space_schedule(p_space_id uuid,p_request_id uuid,p_timezone text,p_payday_day integer,p_expected_revision_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
declare v_actor uuid; v_head bigint; v_revision bigint; v_fingerprint bytea; v_result jsonb;
begin
  v_actor:=private.lock_planning_actor(p_space_id);
  if not private.is_active_owner(p_space_id) then raise exception using errcode='42501',message='planning_not_authorized'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='space_schedule_invalid'; end if;
  v_fingerprint:=private.planning_fingerprint('set_space_schedule',v_actor,
    jsonb_build_object('timezone',p_timezone,'paydayDay',p_payday_day,'expectedRevisionId',p_expected_revision_id));
  v_result:=private.planning_replay(p_space_id,p_request_id,'set_space_schedule',v_actor,v_fingerprint);
  if v_result is not null then return v_result; end if;
  if p_timezone is null or p_payday_day is null or p_payday_day not between 1 and 31
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception using errcode='22023',message='space_schedule_invalid';
  end if;
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
