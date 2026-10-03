-- One receipt owns the expense, coverage and optional completion. Child guards
-- remain authoritative; any failure rolls back every child and receipt.
CREATE FUNCTION public.purchase_goal(p_space_id uuid,p_request_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE actor uuid; fingerprint bytea; result jsonb; goal public.goals%rowtype;
 revision public.goal_revisions%rowtype; wallet public.wallets%rowtype;
 financing_head text; field text; amount bigint; effective date; today date;
 event_id uuid; links jsonb; closed_revision text; definition jsonb; milestones jsonb;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
 OR NOT p_input ?& ARRAY['goalId','expectedHead','expectedRevisionId','walletId','categoryId','amountMinor','effectiveDate','closeGoal']
 OR p_input-ARRAY['goalId','expectedHead','expectedRevisionId','walletId','categoryId','amountMinor','effectiveDate','closeGoal']<>'{}'::jsonb THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 FOREACH field IN ARRAY ARRAY['goalId','expectedHead','expectedRevisionId','walletId','categoryId','amountMinor','effectiveDate'] LOOP
  IF jsonb_typeof(p_input->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END LOOP;
 IF jsonb_typeof(p_input->'closeGoal') IS DISTINCT FROM 'boolean' OR p_input->>'expectedRevisionId' !~ '^[0-9]+$'
 OR p_input->>'expectedHead' !~ '^[0-9a-f]{64}$' OR p_input->>'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR NOT pg_input_is_valid(p_input->>'effectiveDate','date') THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 PERFORM private.period_plan_id(p_input->'goalId',true,false);
 PERFORM private.period_plan_id(p_input->'walletId',true,false);
 PERFORM private.period_plan_id(p_input->'categoryId',true,false);
 actor:=private.lock_planning_actor(p_space_id);
 fingerprint:=private.planning_fingerprint('purchase_goal',actor,p_input);
 result:=private.planning_replay(p_space_id,p_request_id,'purchase_goal',actor,fingerprint);
 IF result IS NOT NULL THEN RETURN result; END IF;
 amount:=private.planning_minor(p_input->>'amountMinor',true);
 effective:=(p_input->>'effectiveDate')::date;today:=private.space_today(p_space_id);
 IF effective>today OR NOT isfinite(effective) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT * INTO goal FROM public.goals WHERE id=(p_input->>'goalId')::uuid AND space_id=p_space_id FOR UPDATE;
 IF NOT FOUND OR goal.kind<>'purchase' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT * INTO revision FROM public.goal_revisions WHERE goal_id=goal.id ORDER BY id DESC LIMIT 1;
 SELECT head INTO financing_head FROM private.goal_financing_state(goal.id,today);
 IF revision.id::text IS DISTINCT FROM p_input->>'expectedRevisionId' OR financing_head IS DISTINCT FROM p_input->>'expectedHead' THEN
  RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision';
 END IF;
 IF revision.state<>'active' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT * INTO wallet FROM public.wallets WHERE id=(p_input->>'walletId')::uuid AND space_id=p_space_id AND archived_at IS NULL FOR KEY SHARE;
 IF NOT FOUND OR wallet.currency<>goal.currency THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 PERFORM 1 FROM public.categories WHERE id=(p_input->>'categoryId')::uuid AND space_id=p_space_id AND kind='expense' AND archived_at IS NULL FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT id INTO event_id FROM public.record_categorized_financial_event(p_space_id,private.planning_child_request(p_request_id,'record'),'expense',effective,
  jsonb_build_array(jsonb_build_object('walletId',wallet.id,'amountMinor',(-amount)::text)),(p_input->>'categoryId')::uuid);
 links:=public.link_goal_purchase(p_space_id,private.planning_child_request(p_request_id,'coverage'),event_id,
  jsonb_build_array(jsonb_build_object('goalId',goal.id,'amountMinor',amount::text,'expectedHead',financing_head)));
 IF (p_input->>'closeGoal')::boolean THEN
  definition:=jsonb_build_object('kind',goal.kind,'currency',goal.currency,'nameEn',revision.name_en,'nameAr',revision.name_ar,'note',revision.note,
   'targetMinor',revision.target_minor::text,'deadline',revision.deadline,'contributionMode',revision.contribution_mode,'monthlyAmountMinor',revision.monthly_minor::text,'priority',revision.priority);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',milestone_id,'kind',kind,'labelEn',label_en,'labelAr',label_ar,'thresholdMinor',threshold_minor::text,'dueDate',due_date,'ordinal',ordinal) ORDER BY ordinal),'[]'::jsonb)
   INTO milestones FROM public.goal_revision_milestones WHERE revision_id=revision.id;
  result:=public.revise_goal_plan(p_space_id,private.planning_child_request(p_request_id,'close'),goal.id,revision.id,definition,milestones,'closed');
  closed_revision:=result->>'revisionId';
 END IF;
 result:=jsonb_build_object('financialEventId',event_id,'goalPurchaseLinkIds',links->'linkIds','goalRevisionId',closed_revision,'closed',(p_input->>'closeGoal')::boolean);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'purchase_goal',fingerprint,actor,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.purchase_goal(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.purchase_goal(uuid,uuid,jsonb) TO authenticated;
