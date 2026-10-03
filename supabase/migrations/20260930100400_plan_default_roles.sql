-- Currency roles and per-goal overrides are accepted-command history, never snapshot edits.
CREATE TABLE public.allocation_group_role_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 space_id uuid NOT NULL REFERENCES public.spaces(id), currency public.currency_code NOT NULL,
 goals_group_id uuid NOT NULL REFERENCES public.allocation_groups(id),
 debt_group_id uuid NOT NULL REFERENCES public.allocation_groups(id),
 expected_revision_id bigint REFERENCES public.allocation_group_role_revisions(id),
 request_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(space_id,request_id)
);
CREATE INDEX allocation_group_role_heads ON public.allocation_group_role_revisions(space_id,currency,id DESC);
CREATE TABLE public.goal_default_group_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 space_id uuid NOT NULL REFERENCES public.spaces(id), currency public.currency_code NOT NULL,
 goal_id uuid NOT NULL REFERENCES public.goals(id), group_id uuid REFERENCES public.allocation_groups(id),
 expected_revision_id bigint REFERENCES public.goal_default_group_revisions(id),
 request_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(space_id,request_id)
);
CREATE INDEX goal_default_group_heads ON public.goal_default_group_revisions(space_id,goal_id,id DESC);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['allocation_group_role_revisions','goal_default_group_revisions'] LOOP
  EXECUTE format('alter table public.%I enable row level security',tab);
  EXECUTE format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  EXECUTE format('revoke all on sequence public.%I from public,anon,authenticated,service_role',tab||'_id_seq');
  EXECUTE format('grant select on public.%I to authenticated',tab);
  EXECUTE format('create policy %I on public.%I for select to authenticated using(private.is_active_member(space_id))',tab||'_member_read',tab);
  EXECUTE format('create trigger %I before insert on public.%I for each statement execute function private.require_table_owner_write()',tab||'_owner_write',tab);
  EXECUTE format('create trigger %I before update or delete or truncate on public.%I for each statement execute function private.planning_reject_mutation()',tab||'_immutable',tab);
 END LOOP;
END; $$;
CREATE FUNCTION private.validate_plan_default_group(p_space_id uuid,p_currency public.currency_code,p_group_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.allocation_groups WHERE id=p_group_id AND space_id=p_space_id AND currency=p_currency AND purpose='future') THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_default_group';
 END IF;
END; $$;
CREATE FUNCTION public.save_allocation_group_roles(p_space_id uuid,p_request_id uuid,p_currency public.currency_code,p_expected_revision_id bigint,p_goals_group_id uuid,p_debt_group_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; fingerprint bytea; result jsonb; current_id bigint; revision_id bigint;
BEGIN
 IF p_space_id IS NULL OR p_request_id IS NULL OR p_currency IS NULL OR p_goals_group_id IS NULL OR p_debt_group_id IS NULL THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 actor:=private.lock_planning_actor(p_space_id);
 fingerprint:=private.planning_fingerprint('save_allocation_group_roles',actor,jsonb_build_object('currency',p_currency,'expectedRevisionId',p_expected_revision_id,'goalsGroupId',p_goals_group_id,'debtGroupId',p_debt_group_id));
 result:=private.planning_replay(p_space_id,p_request_id,'save_allocation_group_roles',actor,fingerprint);
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT id INTO current_id FROM public.allocation_group_role_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1;
 IF current_id IS DISTINCT FROM p_expected_revision_id THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 PERFORM private.validate_plan_default_group(p_space_id,p_currency,p_goals_group_id);
 PERFORM private.validate_plan_default_group(p_space_id,p_currency,p_debt_group_id);
 INSERT INTO public.allocation_group_role_revisions(space_id,currency,goals_group_id,debt_group_id,expected_revision_id,request_id,actor_id)
 VALUES(p_space_id,p_currency,p_goals_group_id,p_debt_group_id,p_expected_revision_id,p_request_id,actor) RETURNING id INTO revision_id;
 result:=jsonb_build_object('revisionId',revision_id::text);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'save_allocation_group_roles',fingerprint,actor,result);
 RETURN result;
END; $$;
CREATE FUNCTION public.set_goal_default_group(p_space_id uuid,p_request_id uuid,p_goal_id uuid,p_group_id uuid,p_expected_revision_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; fingerprint bytea; result jsonb; current_id bigint; revision_id bigint; goal_currency public.currency_code;
BEGIN
 IF p_space_id IS NULL OR p_request_id IS NULL OR p_goal_id IS NULL THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 actor:=private.lock_planning_actor(p_space_id);
 fingerprint:=private.planning_fingerprint('set_goal_default_group',actor,jsonb_build_object('goalId',p_goal_id,'groupId',p_group_id,'expectedRevisionId',p_expected_revision_id));
 result:=private.planning_replay(p_space_id,p_request_id,'set_goal_default_group',actor,fingerprint);
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT currency INTO goal_currency FROM public.goals WHERE id=p_goal_id AND space_id=p_space_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_goal'; END IF;
 SELECT id INTO current_id FROM public.goal_default_group_revisions WHERE space_id=p_space_id AND goal_id=p_goal_id ORDER BY id DESC LIMIT 1;
 IF current_id IS DISTINCT FROM p_expected_revision_id THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 PERFORM private.validate_plan_default_group(p_space_id,goal_currency,p_group_id);
 INSERT INTO public.goal_default_group_revisions(space_id,currency,goal_id,group_id,expected_revision_id,request_id,actor_id)
 VALUES(p_space_id,goal_currency,p_goal_id,p_group_id,p_expected_revision_id,p_request_id,actor) RETURNING id INTO revision_id;
 result:=jsonb_build_object('revisionId',revision_id::text);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'set_goal_default_group',fingerprint,actor,result);
 RETURN result;
END; $$;
CREATE FUNCTION private.resolve_goal_plan_group(p_space_id uuid,p_currency public.currency_code,p_goal_id uuid,p_period_override uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.goals WHERE id=p_goal_id AND space_id=p_space_id AND currency=p_currency) THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_goal'; END IF;
 resolved:=coalesce(p_period_override,(SELECT group_id FROM public.goal_default_group_revisions WHERE space_id=p_space_id AND goal_id=p_goal_id ORDER BY id DESC LIMIT 1),(SELECT goals_group_id FROM public.allocation_group_role_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1));
 PERFORM private.validate_plan_default_group(p_space_id,p_currency,resolved);
 RETURN resolved;
END; $$;
CREATE FUNCTION private.resolve_debt_plan_group(p_space_id uuid,p_currency public.currency_code,p_period_override uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved uuid;
BEGIN
 resolved:=coalesce(p_period_override,(SELECT debt_group_id FROM public.allocation_group_role_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1));
 PERFORM private.validate_plan_default_group(p_space_id,p_currency,resolved);
 RETURN resolved;
END; $$;
REVOKE ALL ON FUNCTION private.validate_plan_default_group(uuid,public.currency_code,uuid),private.resolve_goal_plan_group(uuid,public.currency_code,uuid,uuid),private.resolve_debt_plan_group(uuid,public.currency_code,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_allocation_group_roles(uuid,uuid,public.currency_code,bigint,uuid,uuid),public.set_goal_default_group(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_allocation_group_roles(uuid,uuid,public.currency_code,bigint,uuid,uuid),public.set_goal_default_group(uuid,uuid,uuid,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.period_plan_page(p_space_id uuid,p_period_key date,p_currency public.currency_code)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE
 s public.allocation_month_snapshots%rowtype;
 template_head bigint; income_head bigint; income_amount bigint;
 v_template_id bigint; groups jsonb; mappings jsonb; roots jsonb; goals jsonb;
 loans jsonb := '[]'; categories jsonb; archived jsonb;
 role_head public.allocation_group_role_revisions%rowtype; defaults jsonb; default_heads jsonb;
 loan_group uuid; review boolean := false; context jsonb;
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
 IF s.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=s.id) THEN
  RAISE EXCEPTION USING errcode='P0001',message='period_plan_legacy_debt_review_required';
 END IF;
 WITH lines AS (
  SELECT loan.id, CASE WHEN s.id IS NOT NULL THEN coalesce(saved.amount_minor,0) ELSE coalesce(h.target_minor,0) END amount,
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
 -- Category limits consume their group's budget, never income a second time.
 WITH allocations AS (SELECT * FROM private.allocate_planning_income(income_amount::text,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g->'id','order',g->'order','basisPoints',g->'basisPoints')),'[]') FROM jsonb_array_elements(groups)g))),
 commitments AS (
  SELECT (m->>'groupId')::uuid group_id,(r->>'amountMinor')::numeric amount FROM jsonb_array_elements(roots)r LEFT JOIN jsonb_array_elements(mappings)m ON m->>'categoryId'=r->>'categoryId'
  UNION ALL SELECT (g->>'groupId')::uuid,(g->>'amountMinor')::numeric FROM jsonb_array_elements(goals)g
  UNION ALL SELECT loan_group,coalesce(debt_minor,0)
 ), sums AS (SELECT group_id,sum(amount) amount FROM commitments GROUP BY group_id)
 SELECT income_amount-coalesce((SELECT sum(target_minor) FROM allocations WHERE NOT is_residual),0),
 coalesce((SELECT sum(greatest(coalesce(sums.amount,0)-a.target_minor,0)) FROM allocations a LEFT JOIN sums ON sums.group_id=a.group_id WHERE NOT a.is_residual),0)+coalesce((SELECT amount FROM sums WHERE group_id IS NULL),0)
 INTO left_minor,excess;
 RETURN jsonb_build_object('lineCounts',jsonb_build_object('goalDefaults',jsonb_array_length(defaults),'goalDefaultHeads',jsonb_array_length(default_heads),'groups',jsonb_array_length(groups),'rootMappings',jsonb_array_length(mappings),'rootTargets',jsonb_array_length(roots),'goalTargets',jsonb_array_length(goals),'loanTargets',jsonb_array_length(loans),'categories',jsonb_array_length(categories),'archivedReferences',jsonb_array_length(archived)),'context',context,'currency',p_currency,'snapshotId',s.id::text,
 'roleDefaults',jsonb_build_object('goalsGroupId',role_head.goals_group_id,'debtGroupId',role_head.debt_group_id,'revisionId',role_head.id::text),'goalDefaults',defaults,
 'draft',jsonb_build_object('expectedRoleRevisionId',role_head.id::text,'expectedGoalDefaultRevisionIds',default_heads,'roleChange',null,'expectedSnapshotId',s.id::text,'expectedTemplateRevisionId',template_head::text,'expectedIncomeRevisionId',income_head::text,'incomeMinor',income_amount::text,'groups',groups,'rootMappings',mappings,'rootTargets',roots,'goalTargets',goals,'loanTargets',loans,'loanGroupId',loan_group,'acceptOverallocated',false,'goalDefaultChanges','[]'::jsonb),
 'categories',categories,'needsLegacyReview',review,'archivedReferences',archived,'leftToAssignMinor',left_minor::text,'overcommittedMinor',excess::text);
END; $$;
REVOKE ALL ON FUNCTION public.period_plan_page(uuid,date,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.period_plan_page(uuid,date,public.currency_code) TO authenticated;

-- Additive enriched pager: the B2 OUT signature remains intact for older clients.
CREATE FUNCTION public.goal_period_target_defaults_page(p_space_id uuid,p_period_key date,p_currency public.currency_code,p_after_goal_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS TABLE("goalId" text,"amountMinor" text,"expectedRevisionId" text,"defaultGroupId" text,"defaultRevisionId" text,"roleRevisionId" text,"hasMore" boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p."goalId",p."amountMinor",p."expectedRevisionId",
 (SELECT l.group_id::text FROM public.allocation_template_lines l WHERE l.template_id=(SELECT id FROM public.allocation_template_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1)
 AND l.group_id=private.resolve_goal_plan_group(p_space_id,p_currency,p."goalId"::uuid,null)),
 (SELECT id::text FROM public.goal_default_group_revisions WHERE space_id=p_space_id AND goal_id=p."goalId"::uuid ORDER BY id DESC LIMIT 1),
 (SELECT id::text FROM public.allocation_group_role_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1),p."hasMore"
 FROM public.goal_period_target_page(p_space_id,p_period_key,p_currency,p_after_goal_id,p_limit)p;
$$;
REVOKE ALL ON FUNCTION public.goal_period_target_defaults_page(uuid,date,public.currency_code,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.goal_period_target_defaults_page(uuid,date,public.currency_code,uuid,integer) TO authenticated;
