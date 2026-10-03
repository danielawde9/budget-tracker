-- Financial children and standalone financial commands share space-first order.
CREATE OR REPLACE FUNCTION private.lock_financial_request(p_space_id uuid,p_request_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM private.lock_planning_actor(p_space_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_space_id::text || ':' || p_request_id::text,0));
END $$;

CREATE OR REPLACE FUNCTION private.require_wallet_command_actor(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) RETURNS uuid
    LANGUAGE plpgsql VOLATILE
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_request_id is null or p_wallet_id is null then
    raise exception using errcode = 'P0001', message = 'request ID and wallet ID are required';
  end if;

  perform private.lock_planning_actor(p_space_id);
  return v_actor_id;
end;
$$;



-- Current command authority is independent of any selected historical period.
CREATE FUNCTION public.record_settlement_context(p_space_id uuid,p_occurrence_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE occurrence public.scheduled_occurrences%rowtype; today date; goal_head text;
BEGIN
 IF NOT private.is_active_member(p_space_id) THEN RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized'; END IF;
 SELECT * INTO occurrence FROM public.scheduled_occurrences WHERE id=p_occurrence_id AND space_id=p_space_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 today:=private.space_today(p_space_id);
 IF occurrence.funding_goal_id IS NOT NULL THEN SELECT head INTO goal_head FROM private.goal_financing_state(occurrence.funding_goal_id,today); END IF;
 RETURN jsonb_build_object('occurrenceId',occurrence.id,'settlementHead',private.occurrence_settlement_head(occurrence.id),'fundingGoalId',occurrence.funding_goal_id,'expectedFundingGoalHead',goal_head,'asOf',today);
END $$;

CREATE FUNCTION public.record_and_settle(p_space_id uuid,p_request_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE actor uuid; fingerprint bytea; result jsonb; occurrence public.scheduled_occurrences%rowtype;
 event_kind text; category_id uuid; amount bigint; eligible numeric:=0; movement jsonb; wallet public.wallets%rowtype;
 event_id uuid; field text; settled numeric; skipped boolean; goal_head text; today date; effective date;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR
 NOT p_input ?& ARRAY['kind','effectiveDate','movements','categoryId','occurrenceId','settlementAmountMinor','expectedSettlementHead'] OR
 p_input-ARRAY['kind','effectiveDate','movements','categoryId','occurrenceId','settlementAmountMinor','expectedSettlementHead','expectedFundingGoalHead','payeeName','note']<>'{}'::jsonb THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 FOREACH field IN ARRAY ARRAY['payeeName','note','expectedFundingGoalHead'] LOOP
  IF p_input ? field AND jsonb_typeof(p_input->field) NOT IN ('string','null') THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END LOOP;
 actor:=private.lock_planning_actor(p_space_id);
 fingerprint:=private.planning_fingerprint('record_and_settle',actor,p_input);
 result:=private.planning_replay(p_space_id,p_request_id,'record_and_settle',actor,fingerprint);
 IF result IS NOT NULL THEN RETURN result; END IF;
 event_kind:=p_input->>'kind';
 IF event_kind NOT IN ('income','expense') OR event_kind IS NULL OR jsonb_typeof(p_input->'settlementAmountMinor') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'expectedSettlementHead') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 PERFORM private.period_plan_id(p_input->'categoryId',true,true);
 PERFORM private.period_plan_id(p_input->'occurrenceId',true,false);
 category_id:=(p_input->>'categoryId')::uuid;
 amount:=private.planning_minor(p_input->>'settlementAmountMinor',true);
 effective:=(p_input->>'effectiveDate')::date; today:=private.space_today(p_space_id);
 IF effective IS NULL OR NOT isfinite(effective) OR effective>today THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT o.* INTO occurrence FROM public.scheduled_occurrences o JOIN public.schedules s ON s.id=o.schedule_id WHERE o.id=(p_input->>'occurrenceId')::uuid AND o.space_id=p_space_id AND s.kind=event_kind FOR UPDATE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 IF private.occurrence_settlement_head(occurrence.id) IS DISTINCT FROM p_input->>'expectedSettlementHead' THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 IF occurrence.funding_goal_id IS NOT NULL THEN
  SELECT head INTO goal_head FROM private.goal_financing_state(occurrence.funding_goal_id,today);
  IF goal_head IS NULL OR goal_head IS DISTINCT FROM p_input->>'expectedFundingGoalHead' THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 ELSIF p_input->>'expectedFundingGoalHead' IS NOT NULL THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 SELECT settled_minor,s.skipped INTO settled,skipped FROM private.schedule_occurrence_settlement(occurrence.id,today)s;
 IF skipped OR amount>greatest(occurrence.expected_minor-settled,0) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 IF category_id IS NOT NULL THEN
  PERFORM 1 FROM public.categories WHERE id=category_id AND space_id=p_space_id AND categories.kind::text=event_kind AND archived_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END IF;
 IF jsonb_typeof(p_input->'movements') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'movements') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 FOR movement IN SELECT value FROM jsonb_array_elements(p_input->'movements') LOOP
  PERFORM private.period_plan_object(movement,ARRAY['walletId','amountMinor']);
  PERFORM private.period_plan_id(movement->'walletId',true,false);
  IF jsonb_typeof(movement->'amountMinor') IS DISTINCT FROM 'string' OR movement->>'amountMinor' !~ '^-?[1-9][0-9]*$' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
  SELECT * INTO wallet FROM public.wallets WHERE id=(movement->>'walletId')::uuid AND space_id=p_space_id AND archived_at IS NULL FOR KEY SHARE;
  IF NOT FOUND OR wallet.currency<>occurrence.currency OR (event_kind='income' AND (movement->>'amountMinor')::bigint<=0) OR (event_kind='expense' AND (movement->>'amountMinor')::bigint>=0) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
  eligible:=eligible+abs((movement->>'amountMinor')::numeric);
 END LOOP;
 IF amount>eligible THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 -- Child commands retain their own guards and deterministic receipts. Any late
 -- failure rolls back this entire transaction, including descriptions/coverage.
 IF category_id IS NULL THEN
  SELECT id INTO event_id FROM public.record_financial_event(p_space_id,private.planning_child_request(p_request_id,'record'),event_kind::public.financial_event_kind,effective,p_input->'movements');
 ELSE
  SELECT id INTO event_id FROM public.record_categorized_financial_event(p_space_id,private.planning_child_request(p_request_id,'record'),event_kind::public.financial_event_kind,effective,p_input->'movements',category_id);
 END IF;
 IF p_input->>'payeeName' IS NOT NULL OR p_input->>'note' IS NOT NULL THEN
  PERFORM public.describe_financial_event(p_space_id,private.planning_child_request(p_request_id,'description'),event_id,p_input->>'payeeName',p_input->>'note');
 END IF;
 result:=public.link_scheduled_payment_v2(p_space_id,private.planning_child_request(p_request_id,'settlement'),occurrence.id,event_id,amount::text,p_input->>'expectedSettlementHead');
 result:=jsonb_build_object('financialEventId',event_id,'occurrenceEventId',result->'occurrenceEventId','occurrenceId',occurrence.id,'settlementHead',result->'settlementHead');
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'record_and_settle',fingerprint,actor,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_settlement_context(uuid,uuid),public.record_and_settle(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_settlement_context(uuid,uuid),public.record_and_settle(uuid,uuid,jsonb) TO authenticated;
