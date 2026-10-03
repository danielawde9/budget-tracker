-- D4: balance observations read the authoritative journal through the chosen date.
CREATE FUNCTION public.wallet_balance_as_of(p_space_id uuid,p_wallet_id uuid,p_as_of date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wallet_currency public.currency_code; balance numeric;
BEGIN
 IF p_space_id IS NULL OR NOT private.is_active_member(p_space_id) THEN
  RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized';
 END IF;
 IF p_wallet_id IS NULL OR p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of>private.space_today(p_space_id) THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 SELECT currency INTO wallet_currency FROM public.wallets WHERE id=p_wallet_id AND space_id=p_space_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized'; END IF;
 SELECT coalesce(sum(m.amount_minor),0) INTO balance
 FROM public.wallet_movements m JOIN public.financial_events e ON e.id=m.event_id AND e.space_id=m.space_id
 WHERE m.space_id=p_space_id AND m.wallet_id=p_wallet_id AND e.effective_date<=p_as_of;
 RETURN jsonb_build_object('spaceId',p_space_id,'walletId',p_wallet_id,'currency',wallet_currency,'asOf',p_as_of,'balanceMinor',balance::text);
END; $$;
REVOKE ALL ON FUNCTION public.wallet_balance_as_of(uuid,uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.wallet_balance_as_of(uuid,uuid,date) TO authenticated;
-- Complete accepted carry read.
CREATE OR REPLACE FUNCTION private.period_plan_read(p_space_id uuid,p_period_key date,p_currency public.currency_code,p_review boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE
 s public.allocation_month_snapshots%rowtype;
 template_head bigint; income_head bigint; income_amount bigint;
 v_template_id bigint; groups jsonb; mappings jsonb; roots jsonb; goals jsonb;
 loans jsonb := '[]'; categories jsonb; archived jsonb;
 role_head public.allocation_group_role_revisions%rowtype; defaults jsonb; default_heads jsonb;
 loan_group uuid; review boolean := false; context jsonb;
 carry_total numeric; carry_ids jsonb; carry_lines jsonb;
 left_minor numeric; excess numeric; debt_minor numeric := 0;
BEGIN
 IF p_space_id IS NULL OR NOT private.is_active_member(p_space_id) THEN
  RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized';
 END IF;
 IF p_period_key IS NULL OR NOT isfinite(p_period_key) OR p_period_key<>date_trunc('month',p_period_key)::date OR p_currency IS NULL THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 context := private.space_period_context(p_space_id,p_period_key);
 SELECT * INTO s FROM public.allocation_month_snapshots
 WHERE space_id=p_space_id AND currency=p_currency AND month_start=p_period_key ORDER BY id DESC LIMIT 1;
 SELECT id INTO template_head FROM public.allocation_template_revisions
 WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1;
 SELECT id,amount_minor INTO income_head,income_amount FROM public.monthly_budget_plan_revisions
 WHERE space_id=p_space_id AND currency=p_currency AND month_start=p_period_key AND plan_kind='income' ORDER BY id DESC LIMIT 1;
 SELECT * INTO role_head FROM public.allocation_group_role_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1;
 v_template_id := coalesce(s.template_revision_id,template_head);
 income_amount := CASE WHEN s.id IS NOT NULL THEN s.base_income_minor ELSE coalesce(income_amount,0) END;
 IF s.id IS NOT NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',group_id,'purpose',purpose,'nameEn',name_en,'nameAr',name_ar,'order',display_order,'basisPoints',basis_points) ORDER BY display_order,group_id),'[]')
  INTO groups FROM public.allocation_month_groups WHERE snapshot_id=s.id;
  SELECT group_id INTO loan_group
  FROM public.allocation_month_commitments WHERE snapshot_id=s.id;
  review := income_head IS DISTINCT FROM s.income_plan_revision_id;
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.group_id,'purpose',g.purpose,'nameEn',l.name_en,'nameAr',l.name_ar,'order',l.display_order,'basisPoints',l.basis_points) ORDER BY l.display_order,l.group_id),'[]')
  INTO groups FROM public.allocation_template_lines l JOIN public.allocation_groups g ON g.id=l.group_id WHERE l.template_id=v_template_id;
  loan_group:=private.resolve_debt_plan_group(p_space_id,p_currency,null);
  IF NOT EXISTS(SELECT 1 FROM public.allocation_template_lines WHERE template_id=v_template_id AND group_id=loan_group) THEN loan_group:=null; END IF;
  review := income_head IS NOT NULL;
 END IF;

 -- Mapping-only template roots remain present even when no target was stored.
 WITH ids AS (
  SELECT category_id FROM public.allocation_template_roots WHERE allocation_template_roots.template_id=v_template_id
  UNION SELECT category_id FROM public.allocation_month_roots WHERE snapshot_id=s.id
  UNION SELECT category_id FROM public.monthly_budget_plan_revisions WHERE space_id=p_space_id AND currency=p_currency AND month_start=p_period_key AND plan_kind='expense_category'
  UNION SELECT id FROM public.categories WHERE space_id=p_space_id AND kind='expense' AND parent_category_id IS NULL AND archived_at IS NULL
 ), lines AS (
  SELECT i.category_id, CASE WHEN s.id IS NOT NULL THEN CASE WHEN saved.category_id IS NOT NULL THEN saved.group_id ELSE tr.group_id END ELSE tr.group_id END group_id,
   CASE WHEN s.id IS NOT NULL THEN coalesce(saved.target_minor,0) ELSE coalesce(h.amount_minor,0) END amount,
   h.id head, saved.target_revision_id saved_head
  FROM ids i LEFT JOIN public.allocation_month_roots saved ON saved.snapshot_id=s.id AND saved.category_id=i.category_id
  LEFT JOIN public.allocation_template_roots tr ON tr.template_id=v_template_id AND tr.category_id=i.category_id
  LEFT JOIN LATERAL(SELECT id,amount_minor FROM public.monthly_budget_plan_revisions WHERE space_id=p_space_id AND currency=p_currency AND month_start=p_period_key AND plan_kind='expense_category' AND category_id=i.category_id ORDER BY id DESC LIMIT 1)h ON true
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'groupId',group_id) ORDER BY category_id) FILTER(WHERE group_id IS NOT NULL),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'amountMinor',amount::text,'expectedRevisionId',head::text) ORDER BY category_id),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'groupId',group_id,'limitMinor',nullif(amount,0)::text) ORDER BY category_id),'[]'),
 review OR coalesce(bool_or(CASE WHEN s.id IS NULL THEN head IS NOT NULL ELSE head IS DISTINCT FROM saved_head END),false)
 INTO mappings,roots,categories,review FROM lines;

 -- Join historical references directly, not the current-only goal card page.
 WITH lines AS (
  SELECT g.id, CASE WHEN s.id IS NOT NULL THEN saved.group_id ELSE (SELECT l.group_id FROM public.allocation_template_lines l WHERE l.template_id=v_template_id AND l.group_id=private.resolve_goal_plan_group(p_space_id,p_currency,g.id,null)) END group_id,
   CASE WHEN s.id IS NOT NULL THEN coalesce(saved.amount_minor,0) ELSE coalesce(h.amount_minor,0) END amount,
   h.id head,saved.target_revision_id saved_head
  FROM public.goals g
  JOIN LATERAL(SELECT state FROM public.goal_revisions WHERE goal_id=g.id ORDER BY id DESC LIMIT 1) state ON true
  LEFT JOIN public.allocation_month_goal_lines saved ON saved.snapshot_id=s.id AND saved.goal_id=g.id
  LEFT JOIN LATERAL(SELECT id,amount_minor FROM public.goal_monthly_target_revisions WHERE space_id=p_space_id AND currency=p_currency AND month_start=p_period_key AND goal_id=g.id ORDER BY id DESC LIMIT 1) h ON true
  WHERE g.space_id=p_space_id AND g.currency=p_currency AND (state.state IN ('active','paused') OR h.id IS NOT NULL OR saved.goal_id IS NOT NULL)
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',id,'groupId',group_id,'amountMinor',amount::text,'expectedRevisionId',head::text) ORDER BY id),'[]'),
 review OR coalesce(bool_or(CASE WHEN s.id IS NULL THEN head IS NOT NULL ELSE head IS DISTINCT FROM saved_head END),false)
 INTO goals,review FROM lines;

 -- Current metadata is independent of the snapshot template and its saved overrides.
 WITH rows AS (
 SELECT (g->>'goalId')::uuid goal_id,d.group_id,d.id revision_id,
 (SELECT l.group_id FROM public.allocation_template_lines l WHERE l.template_id=template_head AND l.group_id=private.resolve_goal_plan_group(p_space_id,p_currency,(g->>'goalId')::uuid,null)) resolved
 FROM jsonb_array_elements(goals)g
 LEFT JOIN LATERAL(SELECT id,group_id FROM public.goal_default_group_revisions WHERE space_id=p_space_id AND goal_id=(g->>'goalId')::uuid ORDER BY id DESC LIMIT 1)d ON true
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',goal_id,'groupId',group_id,'resolvedGroupId',resolved,'revisionId',revision_id::text) ORDER BY goal_id),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('goalId',goal_id,'expectedRevisionId',revision_id::text) ORDER BY goal_id),'[]') INTO defaults,default_heads FROM rows;
 IF NOT p_review AND s.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=s.id) THEN
  RAISE EXCEPTION USING errcode='P0001',message='period_plan_legacy_debt_review_required';
 END IF;
 WITH lines AS (
  SELECT loan.id, CASE WHEN s.id IS NOT NULL AND NOT p_review THEN coalesce(saved.amount_minor,0) ELSE coalesce(h.target_minor,0) END amount,
   h.id head,saved.target_revision_id saved_head
  FROM public.loans loan
  LEFT JOIN public.period_plan_loan_lines saved ON saved.snapshot_id=s.id AND saved.loan_id=loan.id
  LEFT JOIN private.current_loan_period_targets(p_space_id,p_period_key)h ON h.loan_id=loan.id
  WHERE loan.space_id=p_space_id AND loan.currency=p_currency AND loan.direction='i_owe_them'
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('loanId',id,'amountMinor',amount::text,'expectedRevisionId',head) ORDER BY id),'[]'),
 review OR coalesce(bool_or(CASE WHEN s.id IS NULL THEN head IS NOT NULL ELSE head IS DISTINCT FROM saved_head END),false)
 INTO loans,review FROM lines;
 -- Editor excess uses assignments, never the observed/capped accounting pool.
 SELECT coalesce(sum((r->>'amountMinor')::numeric),0) INTO debt_minor FROM jsonb_array_elements(loans)r;

 SELECT coalesce(jsonb_agg(ref ORDER BY ref->>'kind',ref->>'id'),'[]') INTO archived FROM (
  SELECT jsonb_build_object('kind','category','id',c.id,'nameEn',c.name_en,'nameAr',c.name_ar) ref
  FROM public.categories c JOIN jsonb_array_elements(categories) r ON (r->>'categoryId')::uuid=c.id WHERE c.archived_at IS NOT NULL
  UNION ALL
  SELECT jsonb_build_object('kind','goal','id',g.goal_id,'nameEn',g.name_en,'nameAr',g.name_ar)
  FROM jsonb_array_elements(goals) r JOIN LATERAL(SELECT goal_id,state,name_en,name_ar FROM public.goal_revisions WHERE goal_id=(r->>'goalId')::uuid ORDER BY id DESC LIMIT 1) g ON true WHERE g.state='closed'
 ) refs;
 IF greatest(jsonb_array_length(roots),jsonb_array_length(goals),jsonb_array_length(loans),jsonb_array_length(archived))>10000 THEN
  RAISE EXCEPTION USING errcode='54000',message='period_plan_too_large';
 END IF;
 SELECT (t->>'leftToAssignMinor')::numeric,(t->>'overcommittedMinor')::numeric INTO left_minor,excess
 FROM (SELECT private.period_plan_assignment_totals(income_amount::text,groups,roots,mappings,goals,loans,loan_group)t) x;
 SELECT coalesce(sum(carry_minor),0),coalesce(jsonb_agg(DISTINCT source_close_id::text ORDER BY source_close_id::text),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('categoryId',root_id,'amountMinor',carry_minor::text,'sourceCloseId',source_close_id::text) ORDER BY root_id),'[]')
 INTO carry_total,carry_ids,carry_lines FROM public.budget_month_carry_links WHERE target_snapshot_id=s.id;
 left_minor:=left_minor+coalesce((SELECT sum(c.carry_minor) FROM private.allocation_snapshot_carry(s.id)c WHERE c.group_id IS NULL),0);
 RETURN jsonb_build_object('lineCounts',jsonb_build_object('goalDefaults',jsonb_array_length(defaults),'goalDefaultHeads',jsonb_array_length(default_heads),'groups',jsonb_array_length(groups),'rootMappings',jsonb_array_length(mappings),'rootTargets',jsonb_array_length(roots),'goalTargets',jsonb_array_length(goals),'loanTargets',jsonb_array_length(loans),'categories',jsonb_array_length(categories),'archivedReferences',jsonb_array_length(archived)),'context',context,'currency',p_currency,'snapshotId',s.id::text,
 'roleDefaults',jsonb_build_object('goalsGroupId',role_head.goals_group_id,'debtGroupId',role_head.debt_group_id,'revisionId',role_head.id::text),'goalDefaults',defaults,
 'allocationBaseMinor',(income_amount+carry_total)::text,'acceptedCarryMinor',carry_total::text,'carrySourceIds',carry_ids,'carryLines',carry_lines,
 'draft',jsonb_build_object('acceptedCarryMinor',carry_total::text,'carrySourceIds',carry_ids,'expectedRoleRevisionId',role_head.id::text,'expectedGoalDefaultRevisionIds',default_heads,'roleChange',null,'expectedSnapshotId',s.id::text,'expectedTemplateRevisionId',template_head::text,'expectedIncomeRevisionId',income_head::text,'incomeMinor',income_amount::text,'groups',groups,'rootMappings',mappings,'rootTargets',roots,'goalTargets',goals,'loanTargets',loans,'loanGroupId',loan_group,'acceptOverallocated',false,'goalDefaultChanges','[]'::jsonb),
 'categories',categories,'needsLegacyReview',review,'archivedReferences',archived,'leftToAssignMinor',left_minor::text,'overcommittedMinor',excess::text);
END; $$;

CREATE OR REPLACE FUNCTION private.save_period_plan_with_carry(p_space_id uuid,p_request_id uuid,p_period_key date,p_currency public.currency_code,p_draft jsonb,p_transition_carry jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE
 actor uuid; fingerprint bytea; result jsonb; current_draft jsonb; line jsonb; current_line jsonb;
 collection text; identity_key text; field text; expected bigint; source_snapshot bigint;
 template_id bigint; sources jsonb:='[]'; source_revision uuid; found_source boolean;
 carry_lines jsonb; carry_total numeric; carry_ids jsonb;
 totals jsonb; excess numeric; accepted boolean; sid bigint;
BEGIN
 IF p_space_id IS NULL OR p_request_id IS NULL OR p_period_key IS NULL OR NOT isfinite(p_period_key) OR p_period_key<>date_trunc('month',p_period_key)::date OR p_currency IS NULL THEN
 RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 actor:=private.lock_planning_actor(p_space_id);
 -- Ordinary Save keeps C3's exact fingerprint and replays before requiring
 -- the new carry fields. This permits an already accepted pre-D4 original
 -- payload to recover, while every new command still needs checked carry.
 fingerprint:=private.planning_fingerprint('save_period_plan',actor,
  jsonb_build_object('periodKey',p_period_key,'currency',p_currency,'draft',p_draft)
  || CASE WHEN p_transition_carry IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('transitionCarry',p_transition_carry) END);
 result:=private.planning_replay(p_space_id,p_request_id,'save_period_plan',actor,fingerprint);
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM private.period_plan_object(p_draft,ARRAY['acceptedCarryMinor','carrySourceIds','expectedRoleRevisionId','expectedGoalDefaultRevisionIds','roleChange','expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId','incomeMinor','groups','rootMappings','rootTargets','goalTargets','loanTargets','loanGroupId','acceptOverallocated','goalDefaultChanges']);
 FOREACH field IN ARRAY ARRAY['expectedRoleRevisionId','expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId'] LOOP
 PERFORM private.period_plan_id(p_draft->field,false); END LOOP;
 PERFORM private.period_plan_id(p_draft->'loanGroupId',true);
 IF jsonb_typeof(p_draft->'incomeMinor') IS DISTINCT FROM 'string' OR jsonb_typeof(p_draft->'acceptOverallocated') IS DISTINCT FROM 'boolean' THEN
 RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 PERFORM private.planning_minor(p_draft->>'incomeMinor');
 accepted:=(p_draft->>'acceptOverallocated')::boolean;
 FOREACH collection IN ARRAY ARRAY['groups','rootMappings','rootTargets','goalTargets','loanTargets','expectedGoalDefaultRevisionIds','goalDefaultChanges'] LOOP
 IF jsonb_typeof(p_draft->collection) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 IF jsonb_array_length(p_draft->collection)>10000 THEN RAISE EXCEPTION USING errcode='54000',message='period_plan_too_large'; END IF;
 identity_key:=CASE collection WHEN 'groups' THEN 'id' WHEN 'rootMappings' THEN 'categoryId' WHEN 'rootTargets' THEN 'categoryId' WHEN 'loanTargets' THEN 'loanId' ELSE 'goalId' END;
 IF (SELECT count(DISTINCT r->>identity_key) FROM jsonb_array_elements(p_draft->collection)r)<>jsonb_array_length(p_draft->collection) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_draft->collection) LOOP
 PERFORM private.period_plan_id(line->identity_key,true,false);
 CASE collection
 WHEN 'groups' THEN
 PERFORM private.period_plan_object(line,ARRAY['id','purpose','nameEn','nameAr','order','basisPoints']);
 IF line->>'purpose' NOT IN ('spending','future') OR jsonb_typeof(line->'purpose') IS DISTINCT FROM 'string'
 OR jsonb_typeof(line->'nameEn') NOT IN ('string','null') OR jsonb_typeof(line->'nameAr') NOT IN ('string','null')
 OR coalesce(nullif(line->>'nameEn',''),nullif(line->>'nameAr','')) IS NULL
 OR jsonb_typeof(line->'order') IS DISTINCT FROM 'number' OR jsonb_typeof(line->'basisPoints') IS DISTINCT FROM 'number'
 OR (line->>'order')::numeric<>floor((line->>'order')::numeric) OR (line->>'basisPoints')::numeric<>floor((line->>'basisPoints')::numeric)
 OR (line->>'order')::numeric NOT BETWEEN 0 AND 11 OR (line->>'basisPoints')::numeric NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 WHEN 'rootMappings' THEN
 PERFORM private.period_plan_object(line,ARRAY['categoryId','groupId']); PERFORM private.period_plan_id(line->'groupId',true,false);
 WHEN 'expectedGoalDefaultRevisionIds' THEN
 PERFORM private.period_plan_object(line,ARRAY['goalId','expectedRevisionId']); PERFORM private.period_plan_id(line->'expectedRevisionId',false);
 WHEN 'goalDefaultChanges' THEN
 PERFORM private.period_plan_object(line,ARRAY['goalId','groupId','expectedRevisionId']); PERFORM private.period_plan_id(line->'groupId',true); PERFORM private.period_plan_id(line->'expectedRevisionId',false);
 ELSE
 PERFORM private.period_plan_object(line,CASE WHEN collection='goalTargets' THEN ARRAY['goalId','groupId','amountMinor','expectedRevisionId'] ELSE ARRAY[identity_key,'amountMinor','expectedRevisionId'] END);
 PERFORM private.period_plan_id(line->'expectedRevisionId',collection='loanTargets');
 IF collection='goalTargets' THEN PERFORM private.period_plan_id(line->'groupId',true); END IF;
 IF jsonb_typeof(line->'amountMinor') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 PERFORM private.planning_minor(line->>'amountMinor');
 END CASE;
 END LOOP;
 END LOOP;
 IF jsonb_array_length(p_draft->'groups')>12 OR (SELECT coalesce(sum((g->>'basisPoints')::int),0)>10000 OR count(DISTINCT g->>'order')<>count(*) FROM jsonb_array_elements(p_draft->'groups')g) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 IF p_draft->'roleChange'<>'null'::jsonb THEN
 PERFORM private.period_plan_object(p_draft->'roleChange',ARRAY['goalsGroupId','debtGroupId','expectedRevisionId']);
 PERFORM private.period_plan_id(p_draft#>'{roleChange,goalsGroupId}',true,false); PERFORM private.period_plan_id(p_draft#>'{roleChange,debtGroupId}',true,false);
 PERFORM private.period_plan_id(p_draft#>'{roleChange,expectedRevisionId}',false);
 IF p_draft#>'{roleChange,expectedRevisionId}' IS DISTINCT FROM p_draft->'expectedRoleRevisionId' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END IF;
 -- This explicit private proposal read supplies current authorization heads even
 -- for old snapshots lacking exact debt evidence. It never becomes approved data.
 current_draft:=private.period_plan_read(p_space_id,p_period_key,p_currency,true)->'draft';
 FOREACH field IN ARRAY ARRAY['expectedRoleRevisionId','expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId'] LOOP
 IF p_draft->field IS DISTINCT FROM current_draft->field THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 END LOOP;
 source_snapshot:=(p_draft->>'expectedSnapshotId')::bigint;
 IF p_transition_carry IS NULL THEN
  IF p_draft->'acceptedCarryMinor' IS DISTINCT FROM current_draft->'acceptedCarryMinor' OR p_draft->'carrySourceIds' IS DISTINCT FROM current_draft->'carrySourceIds' THEN
   RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('rootId',root_id,'sourceCloseId',source_close_id::text,'carryMinor',carry_minor::text) ORDER BY root_id),'[]') INTO carry_lines
  FROM public.budget_month_carry_links WHERE target_snapshot_id=source_snapshot;
 ELSE
  -- Only the guarded transition command calls this private path. Public Save
  -- never supplies new carry evidence, even when a caller guesses its request.
  carry_lines:=p_transition_carry;
 END IF;
 SELECT coalesce(sum((c->>'carryMinor')::numeric),0),coalesce(jsonb_agg(DISTINCT c->>'sourceCloseId' ORDER BY c->>'sourceCloseId'),'[]') INTO carry_total,carry_ids FROM jsonb_array_elements(carry_lines)c;
 IF p_draft->'acceptedCarryMinor' IS DISTINCT FROM to_jsonb(carry_total::text) OR p_draft->'carrySourceIds' IS DISTINCT FROM carry_ids THEN
  RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(carry_lines)c WHERE (c->>'sourceCloseId')::bigint IS DISTINCT FROM
  (SELECT max(id) FROM public.budget_month_closes WHERE space_id=p_space_id AND currency=p_currency AND month_start=(p_period_key-interval '1 month')::date)) THEN
  RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;

 FOREACH collection IN ARRAY ARRAY['rootTargets','goalTargets','loanTargets','expectedGoalDefaultRevisionIds'] LOOP
 identity_key:=CASE collection WHEN 'rootTargets' THEN 'categoryId' WHEN 'loanTargets' THEN 'loanId' ELSE 'goalId' END;
 IF (SELECT coalesce(jsonb_agg(r->identity_key ORDER BY r->>identity_key),'[]') FROM jsonb_array_elements(p_draft->collection)r) IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(r->identity_key ORDER BY r->>identity_key),'[]') FROM jsonb_array_elements(current_draft->collection)r) THEN RAISE EXCEPTION USING errcode='22023',message='period_plan_incomplete_draft'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_draft->collection) LOOP
 SELECT r INTO current_line FROM jsonb_array_elements(current_draft->collection)r WHERE r->identity_key=line->identity_key;
 IF line->'expectedRevisionId' IS DISTINCT FROM current_line->'expectedRevisionId' THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 END LOOP; END LOOP;
 FOR line IN SELECT value FROM jsonb_array_elements(p_draft->'goalDefaultChanges') LOOP
 SELECT r INTO current_line FROM jsonb_array_elements(p_draft->'expectedGoalDefaultRevisionIds')r WHERE r->'goalId'=line->'goalId';
 IF NOT FOUND OR line->'expectedRevisionId' IS DISTINCT FROM current_line->'expectedRevisionId' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END LOOP;
 -- Every mapped identity must have its complete line and the intended purpose.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'rootMappings')m WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'rootTargets')r WHERE r->'categoryId'=m->'categoryId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'groups')g WHERE g->'id'=m->'groupId' AND g->>'purpose'='spending'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'goalTargets')t WHERE t->'groupId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'groups')g WHERE g->'id'=t->'groupId' AND g->>'purpose'='future'))
 OR (p_draft->'loanGroupId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'groups')g WHERE g->'id'=p_draft->'loanGroupId' AND g->>'purpose'='future')) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 totals:=private.period_plan_assignment_totals(p_draft->>'incomeMinor',p_draft->'groups',p_draft->'rootTargets',p_draft->'rootMappings',p_draft->'goalTargets',p_draft->'loanTargets',(p_draft->>'loanGroupId')::uuid);
 excess:=(totals->>'overcommittedMinor')::numeric;
 IF excess>0 AND NOT accepted THEN RAISE EXCEPTION USING errcode='P0001',message='period_plan_overcommit_requires_acceptance'; END IF;
 -- All current expected heads have passed before the first child command.
 template_id:=(private.save_period_template(p_space_id,private.planning_child_request(p_request_id,'template'),p_currency,(p_draft->>'expectedTemplateRevisionId')::bigint,p_draft->'groups',p_draft->'rootMappings',source_snapshot)->>'templateRevisionId')::bigint;
 IF p_draft->'roleChange'<>'null'::jsonb THEN
 PERFORM public.save_allocation_group_roles(p_space_id,private.planning_child_request(p_request_id,'roles'),p_currency,(p_draft->>'expectedRoleRevisionId')::bigint,(p_draft#>>'{roleChange,goalsGroupId}')::uuid,(p_draft#>>'{roleChange,debtGroupId}')::uuid);
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_draft->'goalDefaultChanges') ORDER BY value->>'goalId' LOOP
 PERFORM public.set_goal_default_group(p_space_id,private.planning_child_request(p_request_id,'default:'||(line->>'goalId')),(line->>'goalId')::uuid,(line->>'groupId')::uuid,(line->>'expectedRevisionId')::bigint);
 END LOOP;
 FOR line IN SELECT value FROM jsonb_array_elements(p_draft->'loanTargets') ORDER BY value->>'loanId' LOOP
 SELECT target_revision_id INTO source_revision FROM public.period_plan_loan_lines WHERE snapshot_id=source_snapshot AND loan_id=(line->>'loanId')::uuid AND amount_minor=(line->>'amountMinor')::bigint;
 found_source:=FOUND;
 IF NOT found_source THEN
 SELECT id INTO source_revision FROM public.set_loan_monthly_target(p_space_id,private.planning_child_request(p_request_id,'loan:'||(line->>'loanId')),(line->>'loanId')::uuid,p_period_key,line->>'amountMinor');
 END IF;
 sources:=sources||jsonb_build_array(jsonb_build_object('loanId',line->'loanId','revisionId',source_revision,'amountMinor',line->'amountMinor'));
 END LOOP;
 result:=private.publish_period_plan(p_space_id,private.planning_child_request(p_request_id,'publish'),p_period_key,p_currency,source_snapshot,template_id,(p_draft->>'expectedIncomeRevisionId')::bigint,p_draft->>'incomeMinor',p_draft->'rootTargets',(p_draft->>'loanGroupId')::uuid,p_draft->'goalTargets',true,sources);
 sid:=(result->>'snapshotId')::bigint;
 INSERT INTO public.budget_month_carry_links(space_id,currency,source_close_id,source_month_start,target_snapshot_id,target_month_start,root_id,carry_minor,actor_id)
 SELECT p_space_id,p_currency,(c->>'sourceCloseId')::bigint,(p_period_key-interval '1 month')::date,sid,p_period_key,(c->>'rootId')::uuid,(c->>'carryMinor')::numeric,actor FROM jsonb_array_elements(carry_lines)c;

 INSERT INTO private.period_plan_save_evidence(snapshot_id,space_id,request_id,actor_id,excess_minor,accepted) VALUES(sid,p_space_id,p_request_id,actor,excess,accepted);
 result:=jsonb_build_object('snapshotId',sid::text,'templateRevisionId',template_id::text,'periodKey',p_period_key,'currency',p_currency);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'save_period_plan',fingerprint,actor,result);
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION private.save_period_plan_with_carry(uuid,uuid,date,public.currency_code,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.save_period_plan(p_space_id uuid,p_request_id uuid,p_period_key date,p_currency public.currency_code,p_draft jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.save_period_plan_with_carry(p_space_id,p_request_id,p_period_key,p_currency,p_draft,NULL);
$$;

CREATE OR REPLACE FUNCTION private.check_budget_month_carry_links(p_target_snapshot_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_close_count integer;
  v_close_id bigint;
  v_head bigint;
  v_problems integer;
begin
  select * into v_snapshot from public.allocation_month_snapshots where id = p_target_snapshot_id for update;
  if not found then
    raise exception using errcode='23514', message='budget_month_carry_snapshot_missing';
  end if;

  -- now() is the transaction timestamp: a snapshot or link from any earlier
  -- transaction cannot match it.
  if v_snapshot.created_at is distinct from now() or exists (
    select 1 from public.budget_month_carry_links link
    where link.target_snapshot_id = p_target_snapshot_id and link.created_at is distinct from now()
  ) then
    raise exception using errcode='23514', message='budget_month_carry_link_late';
  end if;

  select count(distinct link.source_close_id), max(link.source_close_id) into v_close_count, v_close_id
    from public.budget_month_carry_links link where link.target_snapshot_id = p_target_snapshot_id;
  if v_close_count <> 1 then
    raise exception using errcode='23514', message='budget_month_carry_links_mixed_sources';
  end if;

  select max(id) into v_head from public.budget_month_closes
    where space_id = v_snapshot.space_id and currency = v_snapshot.currency
      and month_start = (v_snapshot.month_start - interval '1 month')::date;
  if v_head is distinct from v_close_id then
    raise exception using errcode='23514', message='budget_month_carry_link_source_not_head';
  end if;

  -- A receipted ordinary Save may preserve the exact same-period predecessor
  -- links after a category is archived. It cannot add, remove, or alter a link.
  IF EXISTS(SELECT 1 FROM private.period_plan_save_evidence e JOIN public.allocation_month_snapshots prior ON prior.id=v_snapshot.expected_snapshot_id
    WHERE e.snapshot_id=p_target_snapshot_id AND prior.space_id=v_snapshot.space_id AND prior.currency=v_snapshot.currency AND prior.month_start=v_snapshot.month_start)
    AND NOT EXISTS((SELECT root_id,source_close_id,carry_minor FROM public.budget_month_carry_links WHERE target_snapshot_id=p_target_snapshot_id
      EXCEPT SELECT root_id,source_close_id,carry_minor FROM public.budget_month_carry_links WHERE target_snapshot_id=v_snapshot.expected_snapshot_id)
      UNION ALL (SELECT root_id,source_close_id,carry_minor FROM public.budget_month_carry_links WHERE target_snapshot_id=v_snapshot.expected_snapshot_id
      EXCEPT SELECT root_id,source_close_id,carry_minor FROM public.budget_month_carry_links WHERE target_snapshot_id=p_target_snapshot_id)) THEN RETURN; END IF;
  with expected as (
    select close_root.root_id, close_root.outgoing_carry_minor as carry_minor
    from public.budget_month_close_roots close_root
    join public.categories category
      on category.id = close_root.root_id and category.space_id = close_root.space_id and category.archived_at is null
    where close_root.close_id = v_close_id and close_root.enabled and close_root.base_target_minor>0
      and (close_root.outgoing_carry_minor <> 0 or exists (
        select 1 from public.allocation_month_roots snapshot_root
        where snapshot_root.snapshot_id = p_target_snapshot_id and snapshot_root.category_id = close_root.root_id
      ))
  ), linked as (
    select link.root_id, link.carry_minor from public.budget_month_carry_links link
    where link.target_snapshot_id = p_target_snapshot_id
  )
  select count(*) into v_problems from (
    (select * from expected except select * from linked)
    union all
    (select * from linked except select * from expected)
  ) difference;
  if v_problems <> 0 then
    raise exception using errcode='23514', message='budget_month_carry_links_incomplete';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION private.month_copy_preview(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_source public.allocation_month_snapshots%rowtype;
  v_distance integer;
  v_target_head bigint;
  v_income_head bigint;
  v_loan_group uuid;
  v_close_id bigint;
  v_roots jsonb;
  v_carry jsonb;
  v_root_omissions jsonb;
  v_root_count integer;
  v_goals jsonb;
  v_goal_omissions jsonb;
  v_goal_count integer;
  v_groups jsonb;
  v_omissions jsonb;
  v_preview jsonb;
  v_draft jsonb; v_target_draft jsonb; v_line jsonb; v_source_line jsonb; v_lines jsonb; v_collection text; v_key text;
  v_close_review jsonb;
begin
  select * into v_source from public.allocation_month_snapshots
    where id = p_source_snapshot_id and space_id = p_space_id and currency = p_currency;
  if not found then
    raise exception using errcode='P0001', message='month_copy_source_not_found';
  end if;

  v_distance := 12 * (extract(year from p_target_month)::integer - extract(year from v_source.month_start)::integer)
    + (extract(month from p_target_month)::integer - extract(month from v_source.month_start)::integer);
  if v_distance = 0 or abs(v_distance) > 24 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  select id into v_target_head from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = p_target_month
    order by id desc limit 1;
  select id into v_income_head from public.monthly_budget_plan_revisions
    where space_id = p_space_id and currency = p_currency and month_start = p_target_month and plan_kind = 'income'
    order by id desc limit 1;
  select group_id into v_loan_group from public.allocation_month_commitments where snapshot_id = v_source.id;
  select id into v_close_id from public.budget_month_closes
    where space_id = p_space_id and currency = p_currency
      and month_start = (p_target_month - interval '1 month')::date
    order by id desc limit 1;

  -- Accepted carry stays frozen until an explicit reclose. Bind this preview
  -- to current source facts so late entries/reversals cannot reuse an old hash.
  if v_close_id is not null then
    v_close_review := private.budget_month_close_preview(
      p_space_id, p_currency, (p_target_month - interval '1 month')::date, v_close_id);
  end if;

  with source_roots as (
    select source_root.category_id, source_root.target_minor
    from public.allocation_month_roots source_root where source_root.snapshot_id = v_source.id
  ), destination_positive as (
    -- Mirrors publish_allocation_month_v2's complete-set rule exactly.
    select distinct revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = p_target_month
      and revision.plan_kind = 'expense_category' and revision.amount_minor > 0
  ), carry_candidates as (
    select close_root.root_id, close_root.outgoing_carry_minor
    from public.budget_month_close_roots close_root
    where close_root.close_id = v_close_id and close_root.enabled and close_root.base_target_minor>0
  ), candidate_ids as (
    select category_id from source_roots
    union select category_id from destination_positive
    union select root_id from carry_candidates where outgoing_carry_minor <> 0
    union select template_root.category_id from public.allocation_template_roots template_root
      where template_root.template_id = v_source.template_revision_id
  ), resolved as (
    select category.id as category_id, category.name_en, category.name_ar,
      category.archived_at is not null as archived,
      template_root.group_id,
      source_roots.category_id is not null as in_source,
      source_roots.target_minor as source_target,
      destination_positive.category_id is not null as destination_positive,
      carry_candidates.outgoing_carry_minor as close_carry
    from candidate_ids
    join public.categories category on category.id = candidate_ids.category_id and category.space_id = p_space_id
    left join source_roots on source_roots.category_id = candidate_ids.category_id
    left join public.allocation_template_roots template_root
      on template_root.template_id = v_source.template_revision_id and template_root.category_id = candidate_ids.category_id
    left join destination_positive on destination_positive.category_id = candidate_ids.category_id
    left join carry_candidates on carry_candidates.root_id = candidate_ids.category_id
  ), included as (
    select resolved.*,
      case when resolved.in_source and not resolved.archived then resolved.source_target else 0 end as base_minor,
      case when not resolved.archived then resolved.close_carry else null end as link_carry,
      head.id as expected_revision_id
    from resolved
    left join lateral (
      select revision.id from public.monthly_budget_plan_revisions revision
      where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = p_target_month
        and revision.plan_kind = 'expense_category' and revision.category_id = resolved.category_id
      order by revision.id desc limit 1
    ) head on true
    where (resolved.in_source and not resolved.archived) or resolved.group_id is not null
      or resolved.destination_positive or (not resolved.archived and coalesce(resolved.close_carry, 0) <> 0)
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'categoryId', included.category_id, 'nameEn', included.name_en, 'nameAr', included.name_ar,
        'groupId', included.group_id, 'baseMinor', included.base_minor::text,
        'carryMinor', coalesce(included.link_carry, 0)::text,
        'effectiveMinor', (included.base_minor + coalesce(included.link_carry, 0))::text,
        'actualMinor', null, 'outgoingCarryMinor', null,
        'expectedRevisionId', included.expected_revision_id::text
      ) order by included.category_id), '[]'::jsonb) from included),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'rootId', included.category_id, 'sourceCloseId', v_close_id::text, 'carryMinor', included.link_carry::text
      ) order by included.category_id), '[]'::jsonb) from included where included.link_carry is not null),
    (select coalesce(jsonb_agg(omission.value), '[]'::jsonb) from (
        select jsonb_build_object('entityId', resolved.category_id, 'kind', 'root', 'reason', 'archived') as value
        from resolved where resolved.in_source and resolved.archived
        union all
        select jsonb_build_object('entityId', resolved.category_id, 'kind', 'carry', 'reason', 'archived')
        from resolved where resolved.archived and coalesce(resolved.close_carry, 0) <> 0
      ) omission),
    (select count(*) from included)
  into v_roots, v_carry, v_root_omissions, v_root_count;
  if v_root_count > 200 then
    raise exception using errcode='P0001', message='month_copy_too_many_roots';
  end if;

  with source_goals as (
    select goal_line.goal_id, goal_line.group_id, goal_line.amount_minor
    from public.allocation_month_goal_lines goal_line where goal_line.snapshot_id = v_source.id
  ), destination_positive_goals as (
    select latest.goal_id from (
      select distinct on (revision.goal_id) revision.goal_id, revision.amount_minor
      from public.goal_monthly_target_revisions revision
      where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = p_target_month
      order by revision.goal_id, revision.id desc
    ) latest where latest.amount_minor > 0
  ), candidate_goals as (
    select goal_id from source_goals union select goal_id from destination_positive_goals
  ), resolved_goals as (
    select candidate_goals.goal_id, goal_state.state,
      source_goals.goal_id is not null as in_source, source_goals.group_id, source_goals.amount_minor,
      destination_positive_goals.goal_id is not null as destination_positive,
      head.id as expected_revision_id
    from candidate_goals
    join lateral (
      select revision.state from public.goal_revisions revision
      where revision.goal_id = candidate_goals.goal_id order by revision.id desc limit 1
    ) goal_state on true
    left join source_goals on source_goals.goal_id = candidate_goals.goal_id
    left join destination_positive_goals on destination_positive_goals.goal_id = candidate_goals.goal_id
    left join lateral (
      select revision.id from public.goal_monthly_target_revisions revision
      where revision.goal_id = candidate_goals.goal_id and revision.month_start = p_target_month
      order by revision.id desc limit 1
    ) head on true
  ), included_goals as (
    select resolved_goals.goal_id,
      case when resolved_goals.in_source and resolved_goals.state = 'active' then resolved_goals.group_id else null end as group_id,
      case when resolved_goals.in_source and resolved_goals.state = 'active' then resolved_goals.amount_minor else 0 end as target_minor,
      resolved_goals.expected_revision_id
    from resolved_goals
    where (resolved_goals.in_source and resolved_goals.state = 'active') or resolved_goals.destination_positive
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'goalId', included_goals.goal_id, 'groupId', included_goals.group_id,
        'targetMinor', included_goals.target_minor::text,
        'expectedRevisionId', included_goals.expected_revision_id::text
      ) order by included_goals.goal_id), '[]'::jsonb) from included_goals),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'entityId', resolved_goals.goal_id, 'kind', 'goal', 'reason', resolved_goals.state
      )), '[]'::jsonb) from resolved_goals where resolved_goals.in_source and resolved_goals.state <> 'active'),
    (select count(*) from included_goals)
  into v_goals, v_goal_omissions, v_goal_count;
  if v_goal_count > 100 then
    raise exception using errcode='P0001', message='month_copy_too_many_goals';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', month_group.group_id, 'nameEn', month_group.name_en, 'nameAr', month_group.name_ar,
      'purpose', month_group.purpose, 'order', month_group.display_order, 'basisPoints', month_group.basis_points,
      'targetMinor', month_group.target_minor::text,
      'carryMinor', coalesce(group_carry.carry_minor, 0)::text,
      'effectiveMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0))::text
    ) order by month_group.display_order), '[]'::jsonb)
  into v_groups
  from public.allocation_month_groups month_group
  left join (
    select (root->>'groupId')::uuid as group_id, sum((root->>'carryMinor')::numeric) as carry_minor
    from jsonb_array_elements(v_roots) root
    where root->>'groupId' is not null
    group by (root->>'groupId')::uuid
  ) group_carry on group_carry.group_id = month_group.group_id
  where month_group.snapshot_id = v_source.id;

  select coalesce(jsonb_agg(omission order by omission->>'kind', (omission->>'entityId') collate "C"), '[]'::jsonb)
    into v_omissions
    from jsonb_array_elements(v_root_omissions || v_goal_omissions) omission;

  IF NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=v_source.id) THEN
   RAISE EXCEPTION USING errcode='P0001',message='period_plan_legacy_review_required'; END IF;
  v_draft:=private.period_plan_read(p_space_id,p_target_month,p_currency,true)->'draft';
  v_target_draft:=v_draft;
  v_draft:=v_draft||jsonb_build_object('incomeMinor',v_source.base_income_minor::text,'loanGroupId',v_loan_group,'acceptOverallocated',true,
    'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g->'groupId','purpose',g->'purpose','nameEn',g->'nameEn','nameAr',g->'nameAr','order',g->'order','basisPoints',g->'basisPoints')),'[]') FROM jsonb_array_elements(v_groups)g),
    'rootMappings',(SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',r->'categoryId','groupId',r->'groupId')),'[]') FROM jsonb_array_elements(v_roots)r JOIN public.categories c ON c.id=(r->>'categoryId')::uuid WHERE r->>'groupId' IS NOT NULL AND c.archived_at IS NULL),
    'acceptedCarryMinor',(SELECT coalesce(sum((c->>'carryMinor')::numeric),0)::text FROM jsonb_array_elements(v_carry)c),
    'carrySourceIds',(SELECT coalesce(jsonb_agg(DISTINCT c->>'sourceCloseId' ORDER BY c->>'sourceCloseId'),'[]') FROM jsonb_array_elements(v_carry)c));
  FOREACH v_collection IN ARRAY ARRAY['rootTargets','goalTargets','loanTargets'] LOOP
   v_key:=CASE v_collection WHEN 'rootTargets' THEN 'categoryId' WHEN 'goalTargets' THEN 'goalId' ELSE 'loanId' END;
   v_lines:='[]';
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->v_collection) LOOP
    IF v_collection='rootTargets' THEN
     SELECT r INTO v_source_line FROM jsonb_array_elements(v_roots)r WHERE r->v_key=v_line->v_key;
     v_line:=v_line||jsonb_build_object('amountMinor',coalesce(v_source_line->>'baseMinor','0'));
    ELSIF v_collection='goalTargets' THEN
     SELECT r INTO v_source_line FROM jsonb_array_elements(v_goals)r WHERE r->v_key=v_line->v_key;
     v_line:=v_line||jsonb_build_object('amountMinor',coalesce(v_source_line->>'targetMinor','0'),'groupId',v_source_line->'groupId');
    ELSE
     SELECT jsonb_build_object('amountMinor',amount_minor::text) INTO v_source_line FROM public.period_plan_loan_lines WHERE snapshot_id=v_source.id AND loan_id=(v_line->>'loanId')::uuid;
     v_line:=v_line||jsonb_build_object('amountMinor',coalesce(v_source_line->>'amountMinor','0'));
    END IF;
    v_lines:=v_lines||jsonb_build_array(v_line);
   END LOOP;
   v_draft:=jsonb_set(v_draft,ARRAY[v_collection],v_lines);
  END LOOP;
  v_preview := jsonb_build_object(
    'restatementRequired',coalesce((v_close_review->>'restatementRequired')::boolean,false),
    'carryReviewMonth',v_close_review->'month','carryFactDigest',v_close_review->'factDigest',
    'sourceBounds',private.space_period_context(p_space_id,v_source.month_start)-ARRAY['today','asOf'],'targetBounds',private.space_period_context(p_space_id,p_target_month)-ARRAY['today','asOf'],
    'loanTargets',(SELECT coalesce(jsonb_agg(jsonb_build_object('loanId',r->'loanId','personName',l.person_name,'amountMinor',r->'amountMinor','previousMinor',old->'amountMinor') ORDER BY r->>'loanId'),'[]') FROM jsonb_array_elements(v_draft->'loanTargets')r JOIN public.loans l ON l.id=(r->>'loanId')::uuid LEFT JOIN jsonb_array_elements(v_target_draft->'loanTargets')old ON old->'loanId'=r->'loanId'),'draft',v_draft,'sourceSnapshotId', v_source.id::text, 'sourceMonth', v_source.month_start, 'targetMonth', p_target_month,
    'currency', p_currency, 'expectedTargetSnapshotId', v_target_head::text,
    'templateRevisionId', v_source.template_revision_id::text, 'expectedIncomeRevisionId', v_income_head::text,
    'incomeMinor', v_source.base_income_minor::text, 'loanGroupId', v_loan_group,
    'carryCloseId', v_close_id::text,
    'groups', v_groups, 'roots', v_roots, 'goals', v_goals, 'omissions', v_omissions, 'carrySources', v_carry
  );
  return v_preview || jsonb_build_object('previewHash', encode(extensions.digest(jsonb_build_object(
    'version', 1, 'kind', 'month_copy', 'spaceId', p_space_id, 'preview', v_preview
  )::text, 'sha256'), 'hex'));
end;
$$;

CREATE OR REPLACE FUNCTION public.copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_preview jsonb;
  v_published jsonb;
  v_snapshot_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_source_snapshot_id is null
    or p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date
    or p_accepted_preview_hash is null or p_accepted_preview_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('copy_allocation_month', v_actor, jsonb_build_object(
    'currency', p_currency, 'sourceSnapshotId', p_source_snapshot_id::text, 'targetMonth', p_target_month,
    'expectedTargetSnapshotId', p_expected_target_snapshot_id::text, 'acceptedPreviewHash', p_accepted_preview_hash
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'copy_allocation_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  v_preview := private.month_copy_preview(p_space_id, p_currency, p_source_snapshot_id, p_target_month);
  if (v_preview->>'expectedTargetSnapshotId') is distinct from p_expected_target_snapshot_id::text
    or (v_preview->>'previewHash') is distinct from p_accepted_preview_hash then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if (v_preview->>'restatementRequired')::boolean then
    raise exception using errcode='P0001', message='month_copy_source_restatement_required';
  end if;

  -- Publish the complete approved choices through C3 under a deterministic
  -- child request; carry evidence is supplied only by this private path.
  perform private.ensure_space_period_definition(p_space_id,(v_preview->>'sourceMonth')::date);
  v_published:=private.save_period_plan_with_carry(p_space_id,private.planning_child_request(p_request_id,'copy_allocation_month:save'),p_target_month,p_currency,v_preview->'draft',v_preview->'carrySources');
  v_snapshot_id:=(v_published->>'snapshotId')::bigint;

  v_result := jsonb_build_object(
    'sourceBounds',v_preview->'sourceBounds','targetBounds',v_preview->'targetBounds','snapshotId', v_snapshot_id::text, 'sourceSnapshotId', p_source_snapshot_id::text,
    'previewHash', p_accepted_preview_hash
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'copy_allocation_month', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION private.budget_month_close_preview(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_today date := private.space_today(p_space_id);
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_head public.budget_month_closes%rowtype;
  v_has_head boolean;
  v_facts jsonb;
  v_roots jsonb;
  v_restatement boolean := false;
  v_preview jsonb;
begin
  if (private.space_period_context(p_space_id,p_month)->>'endExclusive')::date > v_today then
    raise exception using errcode='22023', message='budget_month_not_ended';
  end if;

  select * into v_snapshot from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = p_month
    order by id desc limit 1;
  if not found then
    raise exception using errcode='P0001', message='budget_month_close_requires_plan';
  end if;

  IF (private.period_plan_read(p_space_id,p_month,p_currency,false)->>'needsLegacyReview')::boolean THEN RAISE EXCEPTION USING errcode='P0001',message='period_plan_review_required'; END IF;

  select * into v_head from public.budget_month_closes
    where space_id = p_space_id and currency = p_currency and month_start = p_month
    order by id desc limit 1;
  v_has_head := found;

  v_facts := private.budget_month_close_facts(p_space_id, p_currency, p_month, v_snapshot.id, 100000);

  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', snapshot_root.category_id, 'nameEn', category.name_en, 'nameAr', category.name_ar,
      'groupId', snapshot_root.group_id,
      'baseMinor', snapshot_root.target_minor::text,
      'carryMinor', coalesce(link.carry_minor, 0)::text,
      'effectiveMinor', (snapshot_root.target_minor + coalesce(link.carry_minor, 0))::text,
      'actualMinor', coalesce(v_facts->'roots'->>snapshot_root.category_id::text, '0'),
      'outgoingCarryMinor', (case when coalesce(policy.enabled, false)
        then snapshot_root.target_minor + coalesce(link.carry_minor, 0)
          - coalesce((v_facts->'roots'->>snapshot_root.category_id::text)::numeric, 0)
        else 0 end)::text,
      'enabled', coalesce(policy.enabled, false),
      'policyRevisionId', policy.id::text,
      'carrySourceCloseId', link.source_close_id::text
    ) order by snapshot_root.category_id), '[]'::jsonb)
  into v_roots
  from public.allocation_month_roots snapshot_root
  join public.categories category on category.id = snapshot_root.category_id and category.space_id = p_space_id
  left join lateral (
    select revision.id, revision.enabled from public.rollover_policy_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.root_id = snapshot_root.category_id
    order by revision.id desc limit 1
  ) policy on true
  left join public.budget_month_carry_links link
    on link.target_snapshot_id = snapshot_root.snapshot_id and link.root_id = snapshot_root.category_id
  where snapshot_root.snapshot_id = v_snapshot.id;

  -- Restatement is required exactly when re-closing now would freeze
  -- something different from the latest close.
  if v_has_head then
    v_restatement := v_head.source_snapshot_id is distinct from v_snapshot.id
      or encode(v_head.fact_digest, 'hex') is distinct from (v_facts->>'factDigest')
      or v_head.fact_count::text is distinct from (v_facts->>'factCount')
      or (select coalesce(jsonb_agg(jsonb_build_object(
            'categoryId', close_root.root_id, 'baseMinor', close_root.base_target_minor::text,
            'carryMinor', close_root.incoming_carry_minor::text, 'actualMinor', close_root.actual_minor::text,
            'outgoingCarryMinor', close_root.outgoing_carry_minor::text, 'enabled', close_root.enabled,
            'policyRevisionId', close_root.policy_revision_id::text
          ) order by close_root.root_id), '[]'::jsonb)
          from public.budget_month_close_roots close_root where close_root.close_id = v_head.id)
        is distinct from
         (select coalesce(jsonb_agg(jsonb_build_object(
            'categoryId', root->'categoryId', 'baseMinor', root->'baseMinor', 'carryMinor', root->'carryMinor',
            'actualMinor', root->'actualMinor', 'outgoingCarryMinor', root->'outgoingCarryMinor',
            'enabled', root->'enabled', 'policyRevisionId', root->'policyRevisionId'
          ) order by (root->>'categoryId')::uuid), '[]'::jsonb)
          from jsonb_array_elements(v_roots) root);
  end if;

  v_preview := jsonb_build_object(
    'periodBounds',private.space_period_context(p_space_id,p_month)-ARRAY['today','asOf'],'month', p_month, 'currency', p_currency,
    'expectedCloseId', case when v_has_head then v_head.id::text else null end,
    'snapshotId', v_snapshot.id::text,
    'incomeMinor', v_facts->'incomeMinor', 'spendingMinor', v_facts->'spendingMinor',
    'factCount', v_facts->'factCount', 'factDigest', v_facts->'factDigest',
    'restatementRequired', v_restatement, 'roots', v_roots
  );
  return v_preview || jsonb_build_object('previewHash', encode(extensions.digest(jsonb_build_object(
    'version', 1, 'kind', 'budget_month_close', 'spaceId', p_space_id,
    'expectedCloseIdInput', p_expected_close_id::text, 'preview', v_preview
  )::text, 'sha256'), 'hex'));
end;
$$;

CREATE OR REPLACE FUNCTION public.close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_preview jsonb;
  v_snapshot_id bigint;
  v_close_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_month is null
    or p_accepted_preview_hash is null or p_accepted_preview_hash !~ '^[0-9a-f]{64}$'
    or p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('close_budget_month', v_actor, jsonb_build_object(
    'currency', p_currency, 'month', p_month, 'expectedCloseId', p_expected_close_id::text,
    'acceptedPreviewHash', p_accepted_preview_hash
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'close_budget_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Recompute under the space lock: a posting committed since the preview
  -- changes the fact digest and therefore the hash.
  v_preview := private.budget_month_close_preview(p_space_id, p_currency, p_month, p_expected_close_id);
  if (v_preview->>'expectedCloseId') is distinct from p_expected_close_id::text
    or (v_preview->>'previewHash') is distinct from p_accepted_preview_hash then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;
  v_snapshot_id := (v_preview->>'snapshotId')::bigint;

  perform private.ensure_space_period_definition(p_space_id,p_month);
  insert into public.budget_month_closes (
    space_id, currency, month_start, source_snapshot_id, expected_close_id, fact_digest, fact_count, root_count,
    closed_income_minor, closed_spending_minor, request_id, actor_id
  ) values (
    p_space_id, p_currency, p_month, v_snapshot_id, p_expected_close_id, decode(v_preview->>'factDigest', 'hex'),
    (v_preview->>'factCount')::bigint, jsonb_array_length(v_preview->'roots'),
    (v_preview->>'incomeMinor')::numeric, (v_preview->>'spendingMinor')::numeric, p_request_id, v_actor
  ) returning id into v_close_id;

  insert into public.budget_month_close_roots (
    close_id, space_id, currency, month_start, source_snapshot_id, root_id, policy_revision_id, enabled,
    base_target_minor, incoming_carry_minor, actual_minor, outgoing_carry_minor
  )
  select v_close_id, p_space_id, p_currency, p_month, v_snapshot_id, (root->>'categoryId')::uuid,
    (root->>'policyRevisionId')::bigint, (root->>'enabled')::boolean, (root->>'baseMinor')::bigint,
    (root->>'carryMinor')::numeric, (root->>'actualMinor')::numeric, (root->>'outgoingCarryMinor')::numeric
  from jsonb_array_elements(v_preview->'roots') root;

  v_result := jsonb_build_object(
    'snapshotId',v_snapshot_id::text,'periodBounds',v_preview->'periodBounds','closeId', v_close_id::text, 'previewHash', p_accepted_preview_hash, 'restatesCloseId', p_expected_close_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'close_budget_month', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION private.allocation_snapshot_carry_needs_review(p_snapshot_id bigint) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_latest_close bigint;
  v_linked_close bigint;
begin
  select * into v_snapshot from public.allocation_month_snapshots where id = p_snapshot_id;
  if not found then
    return false;
  end if;
  select id into v_latest_close from public.budget_month_closes
    where space_id = v_snapshot.space_id and currency = v_snapshot.currency
      and month_start = (v_snapshot.month_start - interval '1 month')::date
    order by id desc limit 1;
  if v_latest_close is null then
    return false;
  end if;
  select max(link.source_close_id) into v_linked_close
    from public.budget_month_carry_links link where link.target_snapshot_id = p_snapshot_id;
  if v_linked_close is not null and v_linked_close <> v_latest_close then
    return true;
  end if;
  return exists (
    with expected as (
      select close_root.root_id, close_root.outgoing_carry_minor as carry_minor
      from public.budget_month_close_roots close_root
      join public.categories category
        on category.id = close_root.root_id and category.space_id = close_root.space_id and category.archived_at is null
      where close_root.close_id = v_latest_close and close_root.enabled and close_root.base_target_minor>0 and close_root.outgoing_carry_minor <> 0
    ), linked as (
      select link.root_id, link.carry_minor from public.budget_month_carry_links link
      where link.target_snapshot_id = p_snapshot_id and link.carry_minor <> 0
    )
    (select * from expected except select * from linked)
    union all
    (select * from linked except select * from expected)
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.initialize_period_plan(p_space_id uuid,p_request_id uuid,p_period_key date,p_currency public.currency_code,p_accepted_preview_hash text,p_accepted_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE actor uuid; fingerprint bytea; result jsonb; preview jsonb; draft jsonb:=p_accepted_draft; groups jsonb:='{}'; categories jsonb:='{}'; resolved jsonb; lines jsonb; item jsonb; choice jsonb; collection text; field text; new_id uuid; proposal_key text;
BEGIN
 IF p_request_id IS NULL OR p_accepted_preview_hash IS NULL OR p_accepted_preview_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 actor:=private.lock_planning_actor(p_space_id);
 fingerprint:=private.planning_fingerprint('initialize_period_plan',actor,jsonb_build_object('periodKey',p_period_key,'currency',p_currency,'previewHash',p_accepted_preview_hash,'draft',draft));
 result:=private.planning_replay(p_space_id,p_request_id,'initialize_period_plan',actor,fingerprint);IF result IS NOT NULL THEN RETURN result; END IF;
 -- Category constructors/archive share our space-first protocol. Retain source
 -- row locks as well; all category locks are now acquired after the space lock.
 PERFORM 1 FROM public.categories WHERE space_id=p_space_id ORDER BY id FOR SHARE;
 preview:=public.preview_default_period_plan(p_space_id,p_period_key,p_currency);
 IF preview->>'previewHash' IS DISTINCT FROM p_accepted_preview_hash THEN RAISE EXCEPTION USING errcode='40001',message='default_plan_stale_preview'; END IF;
 -- Older zero-carry setup clients omit both fields. Preserve their original
 -- request fingerprint above; partial fields and invented carry still reject.
 IF NOT (draft ? 'acceptedCarryMinor') AND NOT (draft ? 'carrySourceIds')
    AND preview#>'{source,snapshotId}'='null'::jsonb THEN
  draft:=draft||jsonb_build_object('acceptedCarryMinor','0','carrySourceIds','[]'::jsonb);
 END IF;
 PERFORM private.period_plan_object(draft,ARRAY['acceptedCarryMinor','carrySourceIds','expectedRoleRevisionId','expectedGoalDefaultRevisionIds','roleChange','expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId','incomeMinor','groups','rootMappings','rootTargets','goalTargets','loanTargets','loanGroupId','acceptOverallocated','goalDefaultChanges']);
 FOREACH field IN ARRAY ARRAY['expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId','expectedRoleRevisionId','expectedGoalDefaultRevisionIds'] LOOP
  IF draft->field IS DISTINCT FROM preview#>ARRAY['source','draft',field] THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 END LOOP;
 FOREACH collection IN ARRAY ARRAY['groups','rootTargets','rootMappings','goalTargets','loanTargets','goalDefaultChanges'] LOOP
  IF jsonb_typeof(draft->collection) IS DISTINCT FROM 'array' OR jsonb_array_length(draft->collection)>10000 THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(draft->'groups') LOOP
  IF item#>>'{id,kind}'='proposed' THEN
   proposal_key:=item#>>'{id,key}';IF proposal_key IS NULL OR proposal_key !~ '^[a-zA-Z0-9:_-]{1,100}$' OR groups ? proposal_key THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
   groups:=groups||jsonb_build_object(proposal_key,gen_random_uuid());
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(preview#>'{source,draft,groups}')g WHERE g->'id'=item#>'{id,id}') THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
 END LOOP;
 -- Only predefined preview category keys may create a root. Existing IDs are
 -- deliberate accepted choices and must name active expense roots in this space.
 FOR item IN SELECT value FROM jsonb_array_elements(draft->'rootTargets') LOOP
  IF item#>>'{categoryId,kind}'='proposed' THEN
   proposal_key:=item#>>'{categoryId,key}';SELECT c INTO choice FROM jsonb_array_elements(preview->'categoryChoices')c WHERE c->>'key'=proposal_key;
   IF NOT FOUND OR categories ? proposal_key OR item->'expectedRevisionId'<>'null'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
   SELECT id INTO new_id FROM public.create_category(p_space_id,private.planning_child_request(p_request_id,'category:'||proposal_key),'expense',choice->>'nameEn',choice->>'nameAr');
   categories:=categories||jsonb_build_object(proposal_key,new_id);
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.categories c WHERE c.id=(item#>>'{categoryId,id}')::uuid AND c.space_id=p_space_id AND c.kind='expense' AND c.parent_category_id IS NULL AND c.archived_at IS NULL) THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
  END IF;
 END LOOP;
 FOREACH collection IN ARRAY ARRAY['groups','rootMappings','rootTargets','goalTargets','goalDefaultChanges'] LOOP
  lines:='[]';FOR item IN SELECT value FROM jsonb_array_elements(draft->collection) LOOP
   IF collection='groups' THEN item:=item||jsonb_build_object('id',private.resolve_default_plan_reference(item->'id',groups)); END IF;
   IF collection IN ('rootMappings','rootTargets') THEN item:=item||jsonb_build_object('categoryId',private.resolve_default_plan_reference(item->'categoryId',categories)); END IF;
   IF collection IN ('rootMappings','goalTargets','goalDefaultChanges') THEN item:=item||jsonb_build_object('groupId',private.resolve_default_plan_reference(item->'groupId',groups,collection<>'rootMappings')); END IF;
   lines:=lines||jsonb_build_array(item);
  END LOOP;draft:=jsonb_set(draft,ARRAY[collection],lines);
 END LOOP;
 draft:=jsonb_set(draft,'{loanGroupId}',private.resolve_default_plan_reference(draft->'loanGroupId',groups,true));
 IF draft->'roleChange'<>'null'::jsonb THEN
  FOREACH field IN ARRAY ARRAY['goalsGroupId','debtGroupId'] LOOP draft:=jsonb_set(draft,ARRAY['roleChange',field],private.resolve_default_plan_reference(draft#>ARRAY['roleChange',field],groups)); END LOOP;
 END IF;
 result:=public.save_period_plan(p_space_id,private.planning_child_request(p_request_id,'save'),p_period_key,p_currency,draft);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'initialize_period_plan',fingerprint,actor,result);
 RETURN result;
END $$;
