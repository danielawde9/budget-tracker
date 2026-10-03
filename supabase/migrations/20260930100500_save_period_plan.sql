-- One complete draft, one accepted snapshot. Public compatibility commands
-- retain their original signatures and strict rules through private shared bodies.
ALTER TABLE public.allocation_month_snapshots DROP CONSTRAINT allocation_month_snapshots_goal_line_count_check;
ALTER TABLE public.allocation_month_snapshots ADD CONSTRAINT allocation_month_snapshots_goal_line_count_check CHECK(goal_line_count BETWEEN 0 AND 10000);
ALTER TABLE public.allocation_month_snapshots DROP CONSTRAINT allocation_month_snapshots_root_count_check;
ALTER TABLE public.allocation_month_snapshots ADD CONSTRAINT allocation_month_snapshots_root_count_check CHECK(root_count BETWEEN 0 AND 10000);
ALTER TABLE public.allocation_template_revisions DROP CONSTRAINT allocation_template_revisions_root_count_check;
ALTER TABLE public.allocation_template_revisions ADD CONSTRAINT allocation_template_revisions_root_count_check CHECK(root_count BETWEEN 0 AND 10000);

CREATE TABLE private.period_plan_save_evidence (
 snapshot_id bigint PRIMARY KEY REFERENCES public.allocation_month_snapshots(id),
 space_id uuid NOT NULL REFERENCES public.spaces(id),
 request_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
 excess_minor numeric NOT NULL CHECK(excess_minor>=0),
 accepted boolean NOT NULL, UNIQUE(space_id,request_id),
 CHECK(excess_minor=0 OR accepted)
);
ALTER TABLE private.period_plan_save_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.period_plan_save_evidence FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_plan_save_evidence_owner_write BEFORE INSERT ON private.period_plan_save_evidence FOR EACH STATEMENT EXECUTE FUNCTION private.require_table_owner_write();
CREATE TRIGGER period_plan_save_evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.period_plan_save_evidence FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();

CREATE FUNCTION private.period_plan_assignment_totals(p_income text,p_groups jsonb,p_roots jsonb,p_mappings jsonb,p_goals jsonb,p_loans jsonb,p_loan_group uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH allocations AS (SELECT * FROM private.allocate_planning_income(p_income,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g->'id','order',g->'order','basisPoints',g->'basisPoints')),'[]') FROM jsonb_array_elements(p_groups)g))),
 assignments AS (
 SELECT (m->>'groupId')::uuid group_id,(r->>'amountMinor')::numeric amount FROM jsonb_array_elements(p_roots)r LEFT JOIN jsonb_array_elements(p_mappings)m ON m->>'categoryId'=r->>'categoryId'
 UNION ALL SELECT (g->>'groupId')::uuid,(g->>'amountMinor')::numeric FROM jsonb_array_elements(p_goals)g
 UNION ALL SELECT p_loan_group,coalesce(sum((l->>'amountMinor')::numeric),0) FROM jsonb_array_elements(p_loans)l
 ), sums AS (SELECT group_id,sum(amount) amount FROM assignments GROUP BY group_id)
 SELECT jsonb_build_object('leftToAssignMinor',(p_income::numeric-coalesce((SELECT sum(target_minor) FROM allocations WHERE NOT is_residual),0))::text,
 'overcommittedMinor',(coalesce((SELECT sum(greatest(coalesce(s.amount,0)-a.target_minor,0)) FROM allocations a LEFT JOIN sums s ON s.group_id=a.group_id WHERE NOT a.is_residual),0)+coalesce((SELECT sum(amount) FROM sums WHERE group_id IS NULL),0))::text);
$$;
REVOKE ALL ON FUNCTION private.period_plan_assignment_totals(text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.period_plan_read(p_space_id uuid,p_period_key date,p_currency public.currency_code,p_review boolean)
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
 RETURN jsonb_build_object('lineCounts',jsonb_build_object('goalDefaults',jsonb_array_length(defaults),'goalDefaultHeads',jsonb_array_length(default_heads),'groups',jsonb_array_length(groups),'rootMappings',jsonb_array_length(mappings),'rootTargets',jsonb_array_length(roots),'goalTargets',jsonb_array_length(goals),'loanTargets',jsonb_array_length(loans),'categories',jsonb_array_length(categories),'archivedReferences',jsonb_array_length(archived)),'context',context,'currency',p_currency,'snapshotId',s.id::text,
 'roleDefaults',jsonb_build_object('goalsGroupId',role_head.goals_group_id,'debtGroupId',role_head.debt_group_id,'revisionId',role_head.id::text),'goalDefaults',defaults,
 'draft',jsonb_build_object('expectedRoleRevisionId',role_head.id::text,'expectedGoalDefaultRevisionIds',default_heads,'roleChange',null,'expectedSnapshotId',s.id::text,'expectedTemplateRevisionId',template_head::text,'expectedIncomeRevisionId',income_head::text,'incomeMinor',income_amount::text,'groups',groups,'rootMappings',mappings,'rootTargets',roots,'goalTargets',goals,'loanTargets',loans,'loanGroupId',loan_group,'acceptOverallocated',false,'goalDefaultChanges','[]'::jsonb),
 'categories',categories,'needsLegacyReview',review,'archivedReferences',archived,'leftToAssignMinor',left_minor::text,'overcommittedMinor',excess::text);
END; $$;
REVOKE ALL ON FUNCTION private.period_plan_read(uuid,date,public.currency_code,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.period_plan_page(p_space_id uuid,p_period_key date,p_currency public.currency_code)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.period_plan_read(p_space_id,p_period_key,p_currency,false);
$$;
CREATE FUNCTION public.period_plan_legacy_review(p_space_id uuid,p_period_key date,p_currency public.currency_code)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proposal jsonb; aggregate_evidence jsonb;
BEGIN
 proposal:=private.period_plan_read(p_space_id,p_period_key,p_currency,true);
 SELECT jsonb_build_object('snapshotId',s.id::text,'loanGroupId',c.group_id,'observedActualMinor',c.observed_actual_minor::text,'observedRemainingMinor',c.observed_remaining_minor::text,
 'hasCompleteLoanAssignments',EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=s.id)) INTO aggregate_evidence
 FROM public.allocation_month_snapshots s LEFT JOIN public.allocation_month_commitments c ON c.snapshot_id=s.id WHERE s.id=(proposal->>'snapshotId')::bigint;
 RETURN jsonb_build_object('kind','current_loan_proposal','approvedEvidence',aggregate_evidence,'proposal',proposal);
END; $$;
REVOKE ALL ON FUNCTION public.period_plan_legacy_review(uuid,date,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.period_plan_legacy_review(uuid,date,public.currency_code) TO authenticated;
CREATE FUNCTION private.save_period_template(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb, p_source_snapshot bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_template_id bigint;
  v_template_id bigint;
  v_group_count integer;
  v_root_count integer;
  v_canonical_groups jsonb := '[]'::jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_entry jsonb;
  v_id uuid;
  v_name_en text;
  v_name_ar text;
  v_category_id uuid;
  v_group_id uuid;
  v_category_ids uuid[] := '{}';
  v_valid_category_count integer;
  v_existing_space uuid;
  v_existing_currency public.currency_code;
  v_existing_purpose text;
begin
  if p_space_id is null or p_request_id is null or p_currency is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) is distinct from 'array'
    or jsonb_array_length(p_groups) > 12 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_root_mappings is null or jsonb_typeof(p_root_mappings) is distinct from 'array'
    or jsonb_array_length(p_root_mappings) > 10000 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_group_count := jsonb_array_length(p_groups);
  v_root_count := jsonb_array_length(p_root_mappings);

  for v_entry in select value from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['id','purpose','nameEn','nameAr','order','basisPoints']) is not true
      or (v_entry - array['id','purpose','nameEn','nameAr','order','basisPoints']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'id') is distinct from 'string'
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'purpose') is distinct from 'string'
      or (v_entry->>'purpose') not in ('spending','future')
      or jsonb_typeof(v_entry->'order') is distinct from 'number'
      or jsonb_typeof(v_entry->'basisPoints') is distinct from 'number'
      or jsonb_typeof(v_entry->'nameEn') not in ('string','null')
      or jsonb_typeof(v_entry->'nameAr') not in ('string','null')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_id := (v_entry->>'id')::uuid;
    v_name_en := private.canonical_category_name(v_entry->>'nameEn');
    v_name_ar := private.canonical_category_name(v_entry->>'nameAr');
    if char_length(coalesce(v_name_en,'')) > 80 or char_length(coalesce(v_name_ar,'')) > 80
      or (v_name_en is null and v_name_ar is null) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_canonical_groups := v_canonical_groups || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'purpose', v_entry->>'purpose', 'nameEn', v_name_en, 'nameAr', v_name_ar,
      'order', (v_entry->>'order')::integer, 'basisPoints', (v_entry->>'basisPoints')::integer
    ));
  end loop;

  -- Reuse the apportionment helper purely to validate the {id,order,
  -- basisPoints} shape/bounds (12-group cap, duplicate id/order, bps<=10000
  -- total, reserved sentinel, order<=11) instead of re-deriving those rules
  -- a second time; the numeric income (0) is discarded.
  perform private.allocate_planning_income('0', (
    select coalesce(jsonb_agg(jsonb_build_object('id', g->>'id', 'order', g->'order', 'basisPoints', g->'basisPoints')), '[]'::jsonb)
    from jsonb_array_elements(v_canonical_groups) g
  ));

  for v_entry in select value from jsonb_array_elements(p_root_mappings) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','groupId']) is not true
      or (v_entry - array['categoryId','groupId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or jsonb_typeof(v_entry->'groupId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_group_id := (v_entry->>'groupId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    -- Each mapping must point to a spending group included in this same
    -- submission, not an arbitrary pre-existing group.
    if not exists (
      select 1 from jsonb_array_elements(v_canonical_groups) g
      where (g->>'id')::uuid = v_group_id and g->>'purpose' = 'spending'
    ) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'groupId', v_group_id
    ));
  end loop;

  -- Stable identity order: sort groups by id, roots by categoryId, so a
  -- semantically identical resubmission in a different array order still
  -- fingerprints and inserts the same way.
  v_canonical_groups := (select coalesce(jsonb_agg(g order by g->>'id'), '[]'::jsonb) from jsonb_array_elements(v_canonical_groups) g);
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  v_actor := private.lock_planning_actor(p_space_id);

  v_payload := jsonb_build_object(
    'currency', p_currency, 'expectedRevisionId', p_expected_revision_id,
    'groups', v_canonical_groups, 'rootMappings', v_canonical_roots
  );
  v_fingerprint := private.planning_fingerprint('save_allocation_template', v_actor, v_payload);
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'save_allocation_template', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_template_id from public.allocation_template_revisions
    where space_id = p_space_id and currency = p_currency order by id desc limit 1;
  if v_current_template_id is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if v_root_count > 0 then
    select count(*) into v_valid_category_count
    from public.categories category
    where category.id = any(v_category_ids) and category.space_id = p_space_id
      and category.kind = 'expense' and category.parent_category_id is null
      and (category.archived_at is null OR EXISTS(
       SELECT 1 FROM public.allocation_month_snapshots snap JOIN public.allocation_template_roots old ON old.template_id=snap.template_revision_id
       JOIN jsonb_array_elements(p_root_mappings)m ON (m->>'categoryId')::uuid=old.category_id AND (m->>'groupId')::uuid=old.group_id
       WHERE snap.id=p_source_snapshot AND snap.space_id=p_space_id AND snap.currency=p_currency AND old.category_id=category.id));
    if v_valid_category_count is distinct from array_length(v_category_ids, 1) then
      raise exception using errcode='P0001', message='every root mapping must reference an active root expense category in this space';
    end if;
    -- Lock the referenced category rows in a stable ascending order so two
    -- concurrent commands touching an overlapping category set cannot
    -- deadlock against each other.
    perform 1 from public.categories where id = any(v_category_ids) and space_id = p_space_id
      order by id for share;
  end if;

  for v_entry in select value from jsonb_array_elements(v_canonical_groups) loop
    v_id := (v_entry->>'id')::uuid;
    select space_id, currency, purpose into v_existing_space, v_existing_currency, v_existing_purpose
      from public.allocation_groups where id = v_id;
    if found then
      if v_existing_space is distinct from p_space_id or v_existing_currency is distinct from p_currency
        or v_existing_purpose is distinct from v_entry->>'purpose' then
        raise exception using errcode='P0001', message='a submitted group id already exists with a different space, currency, or purpose';
      end if;
    else
      insert into public.allocation_groups (id, space_id, currency, purpose, actor_id)
        values (v_id, p_space_id, p_currency, v_entry->>'purpose', v_actor);
    end if;
  end loop;

  insert into public.allocation_template_revisions
    (space_id, currency, expected_revision_id, group_count, root_count, request_id, actor_id)
    values (p_space_id, p_currency, p_expected_revision_id, v_group_count, v_root_count, p_request_id, v_actor)
    returning id into v_template_id;

  insert into public.allocation_template_lines (template_id, group_id, space_id, currency, name_en, name_ar, display_order, basis_points)
    select v_template_id, (g->>'id')::uuid, p_space_id, p_currency, g->>'nameEn', g->>'nameAr',
      (g->>'order')::integer, (g->>'basisPoints')::integer
    from jsonb_array_elements(v_canonical_groups) g;

  insert into public.allocation_template_roots (template_id, category_id, group_id, space_id, currency)
    select v_template_id, (r->>'categoryId')::uuid, (r->>'groupId')::uuid, p_space_id, p_currency
    from jsonb_array_elements(v_canonical_roots) r;

  v_result := jsonb_build_object('templateRevisionId', v_template_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'save_allocation_template', v_fingerprint, v_actor, v_result);

  return v_result;
end;
$_$;
REVOKE ALL ON FUNCTION private.save_period_template(uuid,uuid,public.currency_code,bigint,jsonb,jsonb,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.save_allocation_template(p_space_id uuid,p_request_id uuid,p_currency public.currency_code,p_expected_revision_id bigint,p_groups jsonb,p_root_mappings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_root_mappings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_root_mappings)>200 THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 RETURN private.save_period_template(p_space_id,p_request_id,p_currency,p_expected_revision_id,p_groups,p_root_mappings,null);
END; $$;
CREATE FUNCTION private.publish_period_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb, p_complete boolean, p_loan_sources jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_month date;
  v_income_minor bigint;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_snapshot_id bigint;
  v_template_space uuid;
  v_template_currency public.currency_code;
  v_template_groups jsonb;
  v_group_targets jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_canonical_goals jsonb := '[]'::jsonb;
  v_category_ids uuid[] := '{}';
  v_goal_ids uuid[] := '{}';
  v_entry jsonb;
  v_category_id uuid;
  v_goal_id uuid;
  v_amount_minor bigint;
  v_expected_revision_id bigint;
  v_required_missing integer;
  v_required_missing_goals integer;
  v_over_target_groups integer;
  v_over_target_goal_groups integer;
  v_loan_group_purpose text;
  v_loan_group_target bigint;
  v_loan_actual bigint;
  v_loan_remaining bigint;
  v_income_child_request uuid;
  v_income_id bigint;
  v_income_month date;
  v_child_request uuid;
  v_root_revision_id bigint;
  v_goal_revision_id bigint;
  v_snapshot_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_month is null or p_currency is null
    or p_template_revision_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;
  v_income_minor := private.planning_minor(p_income_minor);
  if p_root_targets is null or jsonb_typeof(p_root_targets) is distinct from 'array'
    or jsonb_array_length(p_root_targets) > (CASE WHEN p_complete THEN 10000 ELSE 200 END) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_goal_targets is null or jsonb_typeof(p_goal_targets) is distinct from 'array'
    or jsonb_array_length(p_goal_targets) > (CASE WHEN p_complete THEN 10000 ELSE 100 END) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  for v_entry in select value from jsonb_array_elements(p_root_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['categoryId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  for v_entry in select value from jsonb_array_elements(p_goal_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','groupId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['goalId','groupId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'groupId') not in ('string','null')
      or (jsonb_typeof(v_entry->'groupId') = 'string' and (v_entry->>'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_goal_id := (v_entry->>'goalId')::uuid;
    if v_goal_id = any(v_goal_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_goal_ids := array_append(v_goal_ids, v_goal_id);
    v_canonical_goals := v_canonical_goals || jsonb_build_array(jsonb_build_object(
      'goalId', v_goal_id, 'groupId', v_entry->'groupId', 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_goals := (select coalesce(jsonb_agg(g order by g->>'goalId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_goals) g);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('publish_allocation_month_v2', v_actor, jsonb_build_object(
    'month', v_month, 'currency', p_currency, 'expectedSnapshotId', p_expected_snapshot_id,
    'templateRevisionId', p_template_revision_id, 'expectedIncomeRevisionId', p_expected_income_revision_id,
    'incomeMinor', v_income_minor::text, 'rootTargets', v_canonical_roots, 'loanGroupId', p_loan_group_id,
    'goalTargets', v_canonical_goals
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'publish_allocation_month_v2', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  if v_current_snapshot_id is distinct from p_expected_snapshot_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select space_id, currency into v_template_space, v_template_currency
    from public.allocation_template_revisions where id = p_template_revision_id;
  if not found or v_template_space is distinct from p_space_id or v_template_currency is distinct from p_currency then
    raise exception using errcode='P0001', message='the selected template does not belong to this space and currency';
  end if;

  v_template_groups := (
    select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
    from public.allocation_template_lines line where line.template_id = p_template_revision_id
  );
  v_group_targets := (select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', g.group_id, 'targetMinor', g.target_minor, 'isResidual', g.is_residual
    )), '[]'::jsonb) from private.allocate_planning_income(v_income_minor::text, v_template_groups) g);

  select count(*) into v_required_missing
  from (
    select template_root.category_id from public.allocation_template_roots template_root
    where template_root.template_id = p_template_revision_id
    union
    select revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
      and revision.plan_kind = 'expense_category'
  ) required
  left join public.monthly_budget_plan_revisions latest_target
    on latest_target.space_id = p_space_id and latest_target.currency = p_currency
    and latest_target.month_start = v_month and latest_target.plan_kind = 'expense_category'
    and latest_target.category_id = required.category_id
  where (latest_target.amount_minor is null or latest_target.amount_minor > 0)
    and not (required.category_id = any(v_category_ids));
  if v_required_missing <> 0 then
    raise exception using errcode='P0001', message='every template-mapped root and existing positive target must be included in a complete-set publication';
  end if;

  -- Complete-set rule for goals: every goal with a currently positive
  -- monthly target this month/currency must appear (zero explicitly clears
  -- it; omission rejects). Goals have no template mapping to union in.
  select count(*) into v_required_missing_goals
  from (
    select distinct revision.goal_id from public.goal_monthly_target_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
  ) required
  cross join lateral (
    select latest.amount_minor from public.goal_monthly_target_revisions latest
    where latest.goal_id = required.goal_id and latest.space_id = p_space_id
      and latest.currency = p_currency and latest.month_start = v_month
    order by latest.id desc limit 1
  ) latest_target
  where latest_target.amount_minor > 0 and not (required.goal_id = any(v_goal_ids));
  if v_required_missing_goals <> 0 then
    raise exception using errcode='P0001', message='every existing positive goal target must be included in a complete-set publication';
  end if;

  select count(*) into v_over_target_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select tr.group_id, sum((rt->>'amountMinor')::bigint) as root_total
    from jsonb_array_elements(v_canonical_roots) rt
    join public.allocation_template_roots tr
      on tr.template_id = p_template_revision_id and tr.category_id = (rt->>'categoryId')::uuid
    group by tr.group_id
  ) mapped on mapped.group_id = group_target.group_id
  where coalesce(mapped.root_total, 0) > group_target.target_minor;
  if NOT p_complete AND v_over_target_groups <> 0 then
    raise exception using errcode='P0001', message='the requested root targets exceed their spending group target';
  end if;

  select coalesce(summary.actual_repayment_minor, 0), coalesce(summary.remaining_reservation_minor, 0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);
  if p_loan_group_id is not null then
    select (g->>'targetMinor')::bigint into v_loan_group_target
      from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = p_loan_group_id;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = p_loan_group_id and space_id = p_space_id and currency = p_currency;
    if v_loan_group_target is null or v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='the loan pool group must be an included Future group';
    end if;
    if NOT p_complete AND v_loan_actual + v_loan_remaining > v_loan_group_target then
      raise exception using errcode='P0001', message='the observed loan commitment does not fit its linked Future group';
    end if;
  end if;

  -- Every goal target linked to a group must target an included Future
  -- group, and debt commitment plus goal targets together must not exceed
  -- that group's own target.
  for v_entry in select value from jsonb_array_elements(v_canonical_goals) loop
    if v_entry->>'groupId' is null then
      continue;
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_group_targets) g
      where (g->>'groupId')::uuid = (v_entry->>'groupId')::uuid and (g->>'isResidual')::boolean is not true
    ) then
      raise exception using errcode='P0001', message='a goal target must link to an included group';
    end if;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = (v_entry->>'groupId')::uuid and space_id = p_space_id and currency = p_currency;
    if v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='a goal target must link to a Future group';
    end if;
  end loop;

  select count(*) into v_over_target_goal_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select (gt->>'groupId')::uuid as group_id, sum((gt->>'amountMinor')::bigint) as goal_total
    from jsonb_array_elements(v_canonical_goals) gt where gt->>'groupId' is not null
    group by (gt->>'groupId')::uuid
  ) goal_sum on goal_sum.group_id = group_target.group_id
  where coalesce(goal_sum.goal_total, 0)
    + (case when group_target.group_id = p_loan_group_id then v_loan_actual + v_loan_remaining else 0 end)
    > group_target.target_minor;
  if NOT p_complete AND v_over_target_goal_groups <> 0 then
    raise exception using errcode='P0001', message='the requested goal targets and debt commitment exceed their Future group target';
  end if;

  v_income_child_request := private.planning_child_request(p_request_id, 'income:' || p_currency::text || ':' || v_month::text);
  select id, month_start into v_income_id, v_income_month
    from public.set_monthly_income_plan(p_space_id, v_income_child_request, v_month, p_currency, v_income_minor::text, p_expected_income_revision_id);

  perform private.ensure_space_period_definition(p_space_id,p_month);
  insert into public.allocation_month_snapshots (
    space_id, currency, month_start, template_revision_id, income_plan_revision_id, expected_snapshot_id,
    base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, goal_line_count, request_id, actor_id
  ) values (
    p_space_id, p_currency, v_month, p_template_revision_id, v_income_id, p_expected_snapshot_id,
    v_income_minor,
    (select coalesce((g->>'targetMinor')::bigint, 0) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is true),
    (select count(*) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true),
    jsonb_array_length(v_canonical_roots), 1, jsonb_array_length(v_canonical_goals), p_request_id, v_actor
  ) returning id into v_snapshot_id;

  insert into public.allocation_month_groups (snapshot_id, group_id, space_id, currency, name_en, name_ar, purpose, display_order, basis_points, target_minor)
  select v_snapshot_id, line.group_id, p_space_id, p_currency, line.name_en, line.name_ar, grp.purpose, line.display_order, line.basis_points,
    (select (g->>'targetMinor')::bigint from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = line.group_id)
  from public.allocation_template_lines line
  join public.allocation_groups grp on grp.id = line.group_id and grp.space_id = p_space_id
  where line.template_id = p_template_revision_id;

  for v_entry in select value from jsonb_array_elements(v_canonical_roots) loop
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'category:' || v_category_id::text || ':' || p_currency::text || ':' || v_month::text);
    v_root_revision_id := null;
    IF p_complete THEN
      SELECT target_revision_id INTO v_root_revision_id FROM public.allocation_month_roots
      WHERE snapshot_id=p_expected_snapshot_id AND category_id=v_category_id AND target_minor=(v_entry->>'amountMinor')::bigint;
    END IF;
    IF v_root_revision_id IS NULL THEN
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
    END IF;
    insert into public.allocation_month_roots (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
    values (
      v_snapshot_id, v_category_id,
      (select template_root.group_id from public.allocation_template_roots template_root
        where template_root.template_id = p_template_revision_id and template_root.category_id = v_category_id),
      p_space_id, p_currency, v_root_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  for v_entry in select value from jsonb_array_elements(v_canonical_goals) loop
    v_goal_id := (v_entry->>'goalId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'goal:' || v_goal_id::text || ':' || p_currency::text || ':' || v_month::text);
    v_goal_revision_id := null;
    IF p_complete THEN
      SELECT target_revision_id INTO v_goal_revision_id FROM public.allocation_month_goal_lines
      WHERE snapshot_id=p_expected_snapshot_id AND goal_id=v_goal_id AND amount_minor=(v_entry->>'amountMinor')::bigint;
    END IF;
    IF v_goal_revision_id IS NULL THEN
    v_goal_revision_id := (public.set_goal_monthly_target(
      p_space_id, v_child_request, v_goal_id, v_month, v_entry->>'amountMinor', v_expected_revision_id
    )->>'revisionId')::bigint;
    END IF;
    insert into public.allocation_month_goal_lines (snapshot_id, goal_id, space_id, currency, month_start, group_id, target_revision_id, amount_minor)
    values (
      v_snapshot_id, v_goal_id, p_space_id, p_currency, v_month,
      nullif(v_entry->>'groupId', '')::uuid, v_goal_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  insert into public.allocation_month_commitments (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
  values (v_snapshot_id, p_space_id, p_currency, p_loan_group_id, 'loan_pool', v_loan_actual, v_loan_remaining);

  v_result := jsonb_build_object('snapshotId', v_snapshot_id::text, 'incomeRevisionId', v_income_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'publish_allocation_month_v2', v_fingerprint, v_actor, v_result);

  IF p_complete THEN
    INSERT INTO public.period_plan_loan_sets(snapshot_id,space_id,currency,line_count) VALUES(v_snapshot_id,p_space_id,p_currency,jsonb_array_length(p_loan_sources));
    INSERT INTO public.period_plan_loan_lines(snapshot_id,space_id,loan_id,target_revision_id,amount_minor)
    SELECT v_snapshot_id,p_space_id,(r->>'loanId')::uuid,(r->>'revisionId')::uuid,(r->>'amountMinor')::bigint FROM jsonb_array_elements(p_loan_sources)r;
  ELSE
    perform private.freeze_period_plan_loans(v_snapshot_id);
  END IF;
  return v_result;
end;
$_$;
REVOKE ALL ON FUNCTION private.publish_period_plan(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.publish_allocation_month_v2(p_space_id uuid,p_request_id uuid,p_month date,p_currency public.currency_code,p_expected_snapshot_id bigint,p_template_revision_id bigint,p_expected_income_revision_id bigint,p_income_minor text,p_root_targets jsonb,p_loan_group_id uuid,p_goal_targets jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.publish_period_plan(p_space_id,p_request_id,p_month,p_currency,p_expected_snapshot_id,p_template_revision_id,p_expected_income_revision_id,p_income_minor,p_root_targets,p_loan_group_id,p_goal_targets,false,null);
$$;

-- Small strict validators are shared by every complete-set line, and do not write.
CREATE FUNCTION private.period_plan_object(p_value jsonb,p_keys text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR NOT p_value ?& p_keys OR (p_value-p_keys)<>'{}'::jsonb THEN
 RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
END; $$;
CREATE FUNCTION private.period_plan_id(p_value jsonb,p_uuid boolean,p_nullable boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ BEGIN
 IF p_nullable AND p_value='null'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR
 (p_uuid AND p_value#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR
 (NOT p_uuid AND (p_value#>>'{}' !~ '^[1-9][0-9]{0,18}$' OR (p_value#>>'{}')::numeric>9223372036854775807)) THEN
 RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
END; $$;
REVOKE ALL ON FUNCTION private.period_plan_object(jsonb,text[]),private.period_plan_id(jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_period_plan(p_space_id uuid,p_request_id uuid,p_period_key date,p_currency public.currency_code,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE
 actor uuid; fingerprint bytea; result jsonb; current_draft jsonb; line jsonb; current_line jsonb;
 collection text; identity_key text; field text; expected bigint; source_snapshot bigint;
 template_id bigint; sources jsonb:='[]'; source_revision uuid; found_source boolean;
 totals jsonb; excess numeric; accepted boolean; sid bigint;
BEGIN
 IF p_space_id IS NULL OR p_request_id IS NULL OR p_period_key IS NULL OR NOT isfinite(p_period_key) OR p_period_key<>date_trunc('month',p_period_key)::date OR p_currency IS NULL THEN
 RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 actor:=private.lock_planning_actor(p_space_id);
 PERFORM private.period_plan_object(p_draft,ARRAY['expectedRoleRevisionId','expectedGoalDefaultRevisionIds','roleChange','expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId','incomeMinor','groups','rootMappings','rootTargets','goalTargets','loanTargets','loanGroupId','acceptOverallocated','goalDefaultChanges']);
 fingerprint:=private.planning_fingerprint('save_period_plan',actor,jsonb_build_object('periodKey',p_period_key,'currency',p_currency,'draft',p_draft));
 result:=private.planning_replay(p_space_id,p_request_id,'save_period_plan',actor,fingerprint);
 IF result IS NOT NULL THEN RETURN result; END IF;
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
 INSERT INTO private.period_plan_save_evidence(snapshot_id,space_id,request_id,actor_id,excess_minor,accepted) VALUES(sid,p_space_id,p_request_id,actor,excess,accepted);
 result:=jsonb_build_object('snapshotId',sid::text,'templateRevisionId',template_id::text,'periodKey',p_period_key,'currency',p_currency);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'save_period_plan',fingerprint,actor,result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.save_period_plan(uuid,uuid,date,public.currency_code,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_period_plan(uuid,uuid,date,public.currency_code,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.check_allocation_month(p_snapshot_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_group_count integer;
  v_root_count integer;
  v_loan_line_count integer;
  v_goal_line_count integer;
  v_target_sum bigint;
  v_bps_sum integer;
  v_group_problems integer;
  v_root_problems integer;
  v_goal_problems integer;
  v_income public.monthly_budget_plan_revisions%rowtype;
  v_over_target_groups integer;
  v_bad_commitments integer;
  v_head_id bigint;
  v_exact_mismatches integer;
  v_complete boolean;
  v_evidence private.period_plan_save_evidence%rowtype;
  v_totals jsonb;
begin
  select * into v_snapshot from public.allocation_month_snapshots where id = p_snapshot_id for update;
  if not found then
    raise exception using errcode='23514', message='allocation_month_header_missing';
  end if;

  SELECT * INTO v_evidence FROM private.period_plan_save_evidence WHERE snapshot_id=p_snapshot_id;
  v_complete:=FOUND;
  IF v_complete THEN
   IF v_evidence.space_id<>v_snapshot.space_id OR v_evidence.actor_id<>v_snapshot.actor_id OR NOT EXISTS(
    SELECT 1 FROM public.planning_command_receipts r WHERE r.space_id=v_evidence.space_id AND r.request_id=v_evidence.request_id AND r.actor_id=v_evidence.actor_id AND r.command='save_period_plan' AND r.result->>'snapshotId'=p_snapshot_id::text
   ) OR NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=p_snapshot_id) THEN
    RAISE EXCEPTION USING errcode='23514',message='period_plan_save_evidence_invalid';
   END IF;
   v_totals:=private.period_plan_assignment_totals(v_snapshot.base_income_minor::text,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',group_id,'order',display_order,'basisPoints',basis_points)),'[]') FROM public.allocation_month_groups WHERE snapshot_id=p_snapshot_id),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'amountMinor',target_minor::text)),'[]') FROM public.allocation_month_roots WHERE snapshot_id=p_snapshot_id),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'groupId',group_id)),'[]') FROM public.allocation_month_roots WHERE snapshot_id=p_snapshot_id AND group_id IS NOT NULL),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('groupId',group_id,'amountMinor',amount_minor::text)),'[]') FROM public.allocation_month_goal_lines WHERE snapshot_id=p_snapshot_id),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('amountMinor',amount_minor::text)),'[]') FROM public.period_plan_loan_lines WHERE snapshot_id=p_snapshot_id),
    (SELECT group_id FROM public.allocation_month_commitments WHERE snapshot_id=p_snapshot_id));
   IF v_evidence.excess_minor<>(v_totals->>'overcommittedMinor')::numeric OR (v_evidence.excess_minor>0 AND NOT v_evidence.accepted) THEN
    RAISE EXCEPTION USING errcode='23514',message='period_plan_save_evidence_invalid';
   END IF;
  END IF;

  select count(*) into v_group_count from public.allocation_month_groups where snapshot_id = p_snapshot_id;
  if v_group_count is distinct from v_snapshot.group_count then
    raise exception using errcode='23514', message='allocation_month_group_count_mismatch';
  end if;
  select count(*) into v_root_count from public.allocation_month_roots where snapshot_id = p_snapshot_id;
  if v_root_count is distinct from v_snapshot.root_count then
    raise exception using errcode='23514', message='allocation_month_root_count_mismatch';
  end if;
  select count(*) into v_loan_line_count from public.allocation_month_commitments where snapshot_id = p_snapshot_id;
  if v_loan_line_count is distinct from v_snapshot.loan_line_count then
    raise exception using errcode='23514', message='allocation_month_loan_line_count_mismatch';
  end if;
  select count(*) into v_goal_line_count from public.allocation_month_goal_lines where snapshot_id = p_snapshot_id;
  if v_goal_line_count is distinct from v_snapshot.goal_line_count then
    raise exception using errcode='23514', message='allocation_month_goal_line_count_mismatch';
  end if;

  select count(*) into v_group_problems
  from public.allocation_month_groups month_group
  left join public.allocation_template_lines template_line
    on template_line.template_id = v_snapshot.template_revision_id
    and template_line.group_id = month_group.group_id
  left join public.allocation_groups grp
    on grp.id = month_group.group_id and grp.space_id = month_group.space_id
  where month_group.snapshot_id = p_snapshot_id
    and (
      template_line.template_id is null
      or month_group.name_en is distinct from template_line.name_en
      or month_group.name_ar is distinct from template_line.name_ar
      or month_group.display_order is distinct from template_line.display_order
      or month_group.basis_points is distinct from template_line.basis_points
      or month_group.purpose is distinct from grp.purpose
    );
  if v_group_problems <> 0 then
    raise exception using errcode='23514', message='allocation_month_group_copy_mismatch';
  end if;

  select coalesce(sum(target_minor),0), coalesce(sum(basis_points),0)
    into v_target_sum, v_bps_sum
    from public.allocation_month_groups where snapshot_id = p_snapshot_id;
  if v_bps_sum > 10000 or v_target_sum + v_snapshot.unallocated_minor <> v_snapshot.base_income_minor then
    raise exception using errcode='23514', message='allocation_month_apportionment_mismatch';
  end if;

  select count(*) into v_exact_mismatches
  from private.allocate_planning_income(
    v_snapshot.base_income_minor::text,
    (select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
     from public.allocation_template_lines line where line.template_id = v_snapshot.template_revision_id)
  ) computed
  left join public.allocation_month_groups month_group
    on month_group.snapshot_id = p_snapshot_id and month_group.group_id = computed.group_id
  where (computed.is_residual and computed.target_minor <> v_snapshot.unallocated_minor)
     or (not computed.is_residual and (month_group.group_id is null or month_group.target_minor <> computed.target_minor));
  if v_exact_mismatches <> 0 then
    raise exception using errcode='23514', message='allocation_month_apportionment_mismatch';
  end if;

  select * into v_income from public.monthly_budget_plan_revisions
    where id = v_snapshot.income_plan_revision_id and space_id = v_snapshot.space_id;
  if not found or v_income.plan_kind <> 'income' or v_income.month_start <> v_snapshot.month_start
    or v_income.currency <> v_snapshot.currency or v_income.amount_minor <> v_snapshot.base_income_minor then
    raise exception using errcode='23514', message='allocation_month_income_revision_invalid';
  end if;

  select count(*) into v_root_problems
  from public.allocation_month_roots root
  left join public.monthly_budget_plan_revisions revision
    on revision.id = root.target_revision_id and revision.space_id = root.space_id
  where root.snapshot_id = p_snapshot_id
    and (
      revision.id is null
      or revision.plan_kind <> 'expense_category'
      or revision.category_id <> root.category_id
      or revision.month_start <> v_snapshot.month_start
      or revision.currency <> root.currency
      or revision.amount_minor <> root.target_minor
      or (root.group_id is not null and not exists (
        select 1 from public.allocation_template_roots template_root
        where template_root.template_id = v_snapshot.template_revision_id
          and template_root.category_id = root.category_id
          and template_root.group_id = root.group_id
      ))
    );
  if v_root_problems <> 0 then
    raise exception using errcode='23514', message='allocation_month_root_revision_invalid';
  end if;

  select count(*) into v_goal_problems
  from public.allocation_month_goal_lines goal_line
  left join public.goal_monthly_target_revisions revision
    on revision.id = goal_line.target_revision_id and revision.goal_id = goal_line.goal_id
  left join public.allocation_month_groups target_group
    on target_group.snapshot_id = goal_line.snapshot_id and target_group.group_id = goal_line.group_id
  where goal_line.snapshot_id = p_snapshot_id
    and (
      revision.id is null
      or revision.space_id <> goal_line.space_id
      or revision.currency <> goal_line.currency
      or revision.month_start <> v_snapshot.month_start
      or revision.amount_minor <> goal_line.amount_minor
      or (goal_line.group_id is not null and target_group.purpose <> 'future')
    );
  if v_goal_problems <> 0 then
    raise exception using errcode='23514', message='allocation_month_goal_line_invalid';
  end if;

  select count(*) into v_over_target_groups
  from (
    select month_group.group_id, month_group.target_minor,
      coalesce(sum(root.target_minor),0) + coalesce((
        select sum(goal_line.amount_minor) from public.allocation_month_goal_lines goal_line
        where goal_line.snapshot_id = p_snapshot_id and goal_line.group_id = month_group.group_id
      ), 0) as root_total
    from public.allocation_month_groups month_group
    left join public.allocation_month_roots root
      on root.snapshot_id = month_group.snapshot_id and root.group_id = month_group.group_id
    where month_group.snapshot_id = p_snapshot_id
    group by month_group.group_id, month_group.target_minor
  ) totals
  where totals.root_total > totals.target_minor;
  if NOT v_complete AND v_over_target_groups <> 0 then
    raise exception using errcode='23514', message='allocation_month_group_overallocated';
  end if;

  select count(*) into v_bad_commitments
  from public.allocation_month_commitments commitment
  left join public.allocation_month_groups grp
    on grp.snapshot_id = commitment.snapshot_id and grp.group_id = commitment.group_id
  where commitment.snapshot_id = p_snapshot_id
    and commitment.group_id is not null
    and (grp.group_id is null or grp.purpose <> 'future'
      or (NOT v_complete AND commitment.observed_actual_minor + commitment.observed_remaining_minor > grp.target_minor));
  if v_bad_commitments <> 0 then
    raise exception using errcode='23514', message='allocation_month_commitment_invalid';
  end if;

  if v_snapshot.expected_snapshot_id is not null then
    if v_snapshot.expected_snapshot_id >= v_snapshot.id then
      raise exception using errcode='23514', message='allocation_month_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.allocation_month_snapshots
      where space_id = v_snapshot.space_id and currency = v_snapshot.currency
        and month_start = v_snapshot.month_start and id < v_snapshot.id;
    if v_head_id is distinct from v_snapshot.expected_snapshot_id then
      raise exception using errcode='23514', message='allocation_month_predecessor_not_head';
    end if;
  end if;
end;
$$;

CREATE FUNCTION private.approved_plan_identity(p_space_id uuid,p_period_key date,p_currency public.currency_code) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('snapshotId',s.id::text,'planningComplete',EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=s.id))
 FROM (SELECT 1) one LEFT JOIN LATERAL(SELECT id FROM public.allocation_month_snapshots WHERE space_id=p_space_id AND month_start=p_period_key AND currency=p_currency ORDER BY id DESC LIMIT 1)s ON true;
$$;
REVOKE ALL ON FUNCTION private.approved_plan_identity(uuid,date,public.currency_code) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.approved_category_budget_page(p_space_id uuid,p_period_key date,p_currency public.currency_code,p_after_category_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid bigint; result jsonb;
BEGIN
 IF NOT private.is_active_member(p_space_id) THEN RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized'; END IF;
 IF p_currency IS NULL OR p_period_key IS NULL OR p_period_key<>date_trunc('month',p_period_key)::date OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT id INTO sid FROM public.allocation_month_snapshots WHERE space_id=p_space_id AND month_start=p_period_key AND currency=p_currency ORDER BY id DESC LIMIT 1;
 WITH actual AS (SELECT root_id,sum(expense_minor) amount FROM private.planning_period_activity(p_space_id,p_period_key) WHERE currency=p_currency GROUP BY root_id),
 page AS (
 SELECT c.id,c.name_en,c.name_ar,c.archived_at,nullif(r.target_minor,0) limit_minor,r.target_revision_id,coalesce(a.amount,0) actual_minor
 FROM public.categories c LEFT JOIN public.allocation_month_roots r ON r.snapshot_id=sid AND r.category_id=c.id LEFT JOIN actual a ON a.root_id=c.id
 WHERE c.space_id=p_space_id AND c.kind='expense' AND c.parent_category_id IS NULL AND (c.archived_at IS NULL OR r.category_id IS NOT NULL OR coalesce(a.amount,0)<>0)
 AND (p_after_category_id IS NULL OR c.id>p_after_category_id) ORDER BY c.id LIMIT p_limit+1
 ), numbered AS (SELECT *,row_number() OVER(ORDER BY id)rn FROM page)
 SELECT jsonb_build_object('snapshotId',sid::text,'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',id,'nameEn',name_en,'nameAr',name_ar,'archivedAt',archived_at,'limitMinor',limit_minor::text,'actualSpentMinor',actual_minor::text,'remainingMinor',CASE WHEN limit_minor IS NULL THEN null ELSE greatest(limit_minor-actual_minor,0)::text END,'overspentMinor',CASE WHEN limit_minor IS NULL THEN '0' ELSE greatest(actual_minor-limit_minor,0)::text END,'targetRevisionId',target_revision_id::text) ORDER BY id),'[]') FROM numbered WHERE rn<=p_limit),
 'hasMore',EXISTS(SELECT 1 FROM numbered WHERE rn>p_limit),'nextCategoryId',CASE WHEN EXISTS(SELECT 1 FROM numbered WHERE rn>p_limit) THEN (SELECT id FROM numbered WHERE rn=p_limit) ELSE null END) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.approved_category_budget_page(uuid,date,public.currency_code,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approved_category_budget_page(uuid,date,public.currency_code,uuid,integer) TO authenticated;
CREATE FUNCTION private.approved_loan_plan(p_space_id uuid, p_month date, p_snapshot_id bigint DEFAULT NULL) RETURNS TABLE(loan_id uuid, currency public.currency_code, direction public.loan_direction, target_minor bigint, actual_repayment_minor bigint, remaining_reservation_minor bigint, due_amount_minor bigint, expected_collection_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;

  v_month date := date_trunc('month', p_month)::date;
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  with latest_target as (
    SELECT loan.id loan_id,CASE WHEN marker.snapshot_id IS NOT NULL THEN coalesce(line.amount_minor,0) ELSE null END target_minor
    FROM public.loans loan
    LEFT JOIN LATERAL(SELECT snap.id FROM public.allocation_month_snapshots snap WHERE snap.space_id=p_space_id AND snap.currency=loan.currency AND snap.month_start=v_month AND (p_snapshot_id IS NULL OR snap.id=p_snapshot_id) ORDER BY snap.id DESC LIMIT 1)s ON true
    LEFT JOIN public.period_plan_loan_sets marker ON marker.snapshot_id=s.id
    LEFT JOIN public.period_plan_loan_lines line ON line.snapshot_id=s.id AND line.loan_id=loan.id
    WHERE loan.space_id=p_space_id
  ),
  actual_repayments as (
    select
      posting.loan_id,
      coalesce(sum(posting.repayment_effect_minor), 0)::bigint as actual_repayment_minor
    from public.loan_postings as posting
    join public.financial_events as event on event.id = posting.event_id
    where posting.space_id = p_space_id
      and event.effective_date >= v_start
      and event.effective_date < v_end and event.effective_date <= v_asof
    group by posting.loan_id
  )
  select
    loan.id,
    loan.currency,
    loan.direction,
    target.target_minor::bigint,
    greatest(coalesce(actual.actual_repayment_minor, 0), 0)::bigint,
    CASE WHEN target.target_minor IS NULL THEN NULL ELSE least(
      greatest(
        coalesce(target.target_minor, 0) - greatest(coalesce(actual.actual_repayment_minor, 0), 0),
        0
      ),
      balance.outstanding_minor::bigint
    )::bigint END,
    case
      when loan.due_date >= v_start and loan.due_date < v_end then balance.outstanding_minor::bigint
      else 0
    end::bigint,
    case when loan.direction = 'they_owe_me' then balance.outstanding_minor::bigint else 0 end::bigint
  from public.loans as loan
  join public.loan_period_balances(p_space_id,date_trunc('month',p_month)::date) as balance on balance.loan_id = loan.id
  left join latest_target as target on target.loan_id = loan.id
  left join actual_repayments as actual on actual.loan_id = loan.id
  where loan.space_id = p_space_id;
end;
$$;
REVOKE ALL ON FUNCTION private.approved_loan_plan(uuid,date,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.approved_loan_monthly_plan(p_space_id uuid,p_month date)
RETURNS TABLE(loan_id uuid,currency public.currency_code,direction public.loan_direction,target_minor text,actual_repayment_minor text,remaining_reservation_minor text,due_amount_minor text,expected_collection_minor text,snapshot_id text,planning_complete boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p.loan_id,p.currency,p.direction,p.target_minor::text,p.actual_repayment_minor::text,p.remaining_reservation_minor::text,p.due_amount_minor::text,p.expected_collection_minor::text,
 identity->>'snapshotId',(identity->>'planningComplete')::boolean
 FROM private.approved_loan_plan(p_space_id,p_month)p CROSS JOIN LATERAL(SELECT private.approved_plan_identity(p_space_id,date_trunc('month',p_month)::date,p.currency) identity)i;
$$;
REVOKE ALL ON FUNCTION public.approved_loan_monthly_plan(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approved_loan_monthly_plan(uuid,date) TO authenticated;

CREATE FUNCTION public.approved_loan_monthly_currency_summary(p_space_id uuid,p_month date)
RETURNS TABLE(currency public.currency_code,owed_to_me_minor text,i_owe_minor text,planned_repayment_minor text,actual_repayment_minor text,remaining_reservation_minor text,due_amount_minor text,expected_collection_minor text,snapshot_id text,planning_complete boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT old.currency,old.owed_to_me_minor::text,old.i_owe_minor::text,
 CASE WHEN (i.identity->>'planningComplete')::boolean THEN coalesce((SELECT sum(target_minor) FROM private.approved_loan_plan(p_space_id,p_month) WHERE currency=old.currency AND direction='i_owe_them'),0)::text ELSE null END,
 old.actual_repayment_minor::text,
 CASE WHEN (i.identity->>'planningComplete')::boolean THEN coalesce((SELECT sum(remaining_reservation_minor) FROM private.approved_loan_plan(p_space_id,p_month) WHERE currency=old.currency AND direction='i_owe_them'),0)::text ELSE null END,
 old.due_amount_minor::text,old.expected_collection_minor::text,i.identity->>'snapshotId',(i.identity->>'planningComplete')::boolean
 FROM public.loan_monthly_currency_summary(p_space_id,p_month)old CROSS JOIN LATERAL(SELECT private.approved_plan_identity(p_space_id,date_trunc('month',p_month)::date,old.currency)identity)i;
$$;
REVOKE ALL ON FUNCTION public.approved_loan_monthly_currency_summary(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approved_loan_monthly_currency_summary(uuid,date) TO authenticated;
CREATE OR REPLACE FUNCTION private.planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS TABLE(group_id uuid, group_target_minor numeric, debt_commitment_minor numeric, goal_topups_minor numeric, saved_goal_targets_minor numeric, original_debt_commitment_minor numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month date := private.space_period_key_at_date(p_space_id,p_as_of);
  v_context jsonb := private.space_period_context(p_space_id,v_month);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_month_end date := v_end-1;
  v_snapshot_id bigint;
  v_has_snapshot boolean := false;
  v_commitment_group_id uuid;
  v_commitment_original numeric := 0;
  v_live_debt numeric := 0;
begin
  select id into v_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  v_has_snapshot := v_snapshot_id is not null;

  if v_has_snapshot then
    select commitment.group_id, coalesce((SELECT sum(amount_minor) FROM public.period_plan_loan_lines WHERE snapshot_id=v_snapshot_id),0)
      into v_commitment_group_id, v_commitment_original
      from public.allocation_month_commitments commitment where commitment.snapshot_id = v_snapshot_id;
  end if;

  select coalesce(sum(greatest(plan.remaining_reservation_minor, coalesce(sched.remaining_minor, 0))), 0)
    into v_live_debt
  from private.approved_loan_plan(p_space_id, v_month) plan
  left join (
    select so.loan_id, sum(greatest(so.expected_minor - stl.settled_minor, 0)) as remaining_minor
    from public.scheduled_occurrences so
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.space_id = p_space_id and so.currency = p_currency and so.loan_id is not null
      and so.due_date <= v_month_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
    group by so.loan_id
  ) sched on sched.loan_id = plan.loan_id
  where plan.currency = p_currency and plan.direction = 'i_owe_them';

  return query
  with buckets as (
    select month_group.group_id as bucket_id, month_group.target_minor::numeric as bucket_target
    from public.allocation_month_groups month_group
    where v_has_snapshot and month_group.snapshot_id = v_snapshot_id and month_group.purpose = 'future'
    union all
    select null::uuid, null::numeric
  ), goal_rows as (
    select relevant.goal_id,
      saved.group_id as bucket_id,
      coalesce(saved.amount_minor, 0)::numeric as saved_target,
      greatest(coalesce(saved.amount_minor, 0) - coalesce((
        select sum(el.amount_minor) from public.goal_earmark_lines el
        join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = relevant.goal_id and ge.effective_date >= v_start and ge.effective_date < v_end and ge.effective_date <= p_as_of
      ), 0), 0) as u_minor
    from private.goal_coverage_set(p_space_id, p_currency, p_as_of) relevant
    left join public.allocation_month_goal_lines saved
      on v_has_snapshot and saved.snapshot_id = v_snapshot_id and saved.goal_id = relevant.goal_id
  )
  -- Debt attaches to whichever bucket the snapshot's loan pool names
  -- (v_commitment_group_id, defaulting to null/standalone when no snapshot
  -- exists at all) -- never gated on v_has_snapshot itself, so a live debt
  -- fact still surfaces via the standalone bucket even before any month is
  -- ever published.
  select buckets.bucket_id, buckets.bucket_target,
    case when buckets.bucket_id is not distinct from v_commitment_group_id then v_live_debt else 0 end,
    coalesce((select sum(goal_rows.u_minor) from goal_rows where goal_rows.bucket_id is not distinct from buckets.bucket_id), 0),
    coalesce((select sum(goal_rows.saved_target) from goal_rows where goal_rows.bucket_id is not distinct from buckets.bucket_id), 0),
    case when buckets.bucket_id is not distinct from v_commitment_group_id then coalesce(v_commitment_original, 0) else 0 end
  from buckets;
end;
$$;
CREATE OR REPLACE FUNCTION public.available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_today date := private.space_today(p_space_id);
  v_month date;
  v_month_end date;
  v_horizon_end date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_has_snapshot boolean := false;
  v_missing_count integer := 0;
  v_backlog_count integer := 0;
  v_unmaterialized_count integer := 0;
  v_state text;
  v_needs_review boolean := false;
  v_cash numeric := 0;
  v_claims numeric := 0;
  v_received_income numeric := 0;
  v_ordinary_spending numeric := 0;
  v_uncategorized numeric := 0;
  v_days_remaining integer;
  v_expense_commitments numeric;
  v_debt_commitments numeric;
  v_goal_topups numeric;
  v_future_headroom numeric;
  v_available numeric;
  v_deficit numeric;
  v_spendable numeric;
  v_daily_guide numeric;
  v_groups jsonb := '[]'::jsonb;
  v_current_income_id bigint;
begin
  if p_space_id is null or p_currency is null or p_as_of_date is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_as_of_date <> v_today then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_month := private.space_period_key_at_date(p_space_id,v_today);
  v_month_end := (private.space_period_context(p_space_id,v_month)->>'endExclusive')::date-1;
  v_horizon_end := v_today + 89;
  v_days_remaining := (v_month_end - v_today) + 1;

  v_cash := private.goal_cash_pool(p_space_id, p_currency, v_today);
  v_claims := private.goal_space_earmarked_total(p_space_id, p_currency, v_today);

  select coalesce(sum(activity.income_minor), 0), coalesce(sum(activity.expense_minor), 0),
    coalesce(sum(activity.expense_minor) filter (where activity.root_id is null), 0)
    into v_received_income, v_ordinary_spending, v_uncategorized
    from private.planning_ordinary_activity(p_space_id, (private.space_period_context(p_space_id,v_month)->>'start')::date, v_today + 1) activity
    where activity.currency = p_currency;

  select * into v_snapshot from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  v_has_snapshot := found;

  IF v_has_snapshot THEN
    v_needs_review:=NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=v_snapshot.id)
    OR EXISTS(SELECT 1 FROM public.loans l LEFT JOIN public.period_plan_loan_lines saved ON saved.snapshot_id=v_snapshot.id AND saved.loan_id=l.id
      LEFT JOIN private.current_loan_period_targets(p_space_id,v_month)h ON h.loan_id=l.id
      WHERE l.space_id=p_space_id AND l.currency=p_currency AND l.direction='i_owe_them' AND h.id IS DISTINCT FROM saved.target_revision_id);
  END IF;
  if v_has_snapshot then
    v_missing_count := private.planning_materialization_gap(p_space_id, p_currency, v_today, v_horizon_end);
    if v_missing_count = 0 then
      v_backlog_count := private.planning_unpaid_backlog_count(p_space_id, p_currency, v_today, v_horizon_end);
    end if;
  end if;

  if not v_has_snapshot then
    v_state := 'unplanned';
  elsif NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=v_snapshot.id) OR v_missing_count > 0 or v_backlog_count > 500 then
    v_state := 'incomplete';
  else
    v_state := 'ready';
  end if;

  -- unmaterializedCount reports "how many things need materializing before
  -- this number can be trusted," never the ordinary unpaid-bill count of a
  -- healthy plan. v_backlog_count is computed (and only computed) once
  -- v_missing_count is already known to be zero, so it is meaningful only
  -- as the specific >500 trigger the brief names, never as a generic bill
  -- count: report it only when it actually exceeded that cap.
  if v_missing_count > 0 then
    v_unmaterialized_count := v_missing_count;
  elsif v_backlog_count > 500 then
    v_unmaterialized_count := v_backlog_count;
  end if;

  if v_state = 'ready' then
    select id into v_current_income_id from public.monthly_budget_plan_revisions
      where space_id = p_space_id and currency = p_currency and month_start = v_month and plan_kind = 'income'
      order by id desc limit 1;
    if v_current_income_id is distinct from v_snapshot.income_plan_revision_id then
      v_needs_review := true;
    end if;
    if not v_needs_review and exists (
      select 1 from public.allocation_month_roots root
      left join lateral (
        select revision.id from public.monthly_budget_plan_revisions revision
        where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
          and revision.plan_kind = 'expense_category' and revision.category_id = root.category_id
        order by revision.id desc limit 1
      ) current_head on true
      where root.snapshot_id = v_snapshot.id and current_head.id is distinct from root.target_revision_id
    ) then
      v_needs_review := true;
    end if;
    if not v_needs_review and exists (
      select 1 from public.allocation_month_goal_lines goal_line
      left join lateral (
        select revision.id from public.goal_monthly_target_revisions revision
        where revision.goal_id = goal_line.goal_id and revision.space_id = p_space_id
          and revision.currency = p_currency and revision.month_start = v_month
        order by revision.id desc limit 1
      ) current_head on true
      where goal_line.snapshot_id = v_snapshot.id and current_head.id is distinct from goal_line.target_revision_id
    ) then
      v_needs_review := true;
    end if;

    select coalesce(sum(bucket.commitment_minor), 0) into v_expense_commitments
      from private.planning_expense_buckets(p_space_id, p_currency, v_today, v_month_end, v_horizon_end) bucket;

    select coalesce(sum(commitment.debt_commitment_minor), 0), coalesce(sum(commitment.goal_topups_minor), 0),
      coalesce(sum(greatest(
        commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor, 0
      )) filter (where commitment.group_target_minor is not null), 0)
      into v_debt_commitments, v_goal_topups, v_future_headroom
      from private.planning_cash_commitments(p_space_id, p_currency, v_today) commitment;

    v_available := v_cash - v_claims - v_expense_commitments - v_debt_commitments - v_goal_topups - v_future_headroom;
    v_deficit := greatest(-v_available, 0);
    v_spendable := greatest(v_available, 0);
    v_daily_guide := floor(v_spendable / v_days_remaining);

    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', month_group.group_id, 'nameEn', month_group.name_en, 'nameAr', month_group.name_ar,
        'budgetRemainingMinor',
          (case when month_group.purpose = 'future'
            then commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor
            else bucket.budget_remaining_minor end)::text,
        'unpaidBillsMinor', (case when month_group.purpose = 'future' then null else bucket.unpaid_bills_minor::text end),
        'goalOverlapMinor', (case when month_group.purpose = 'future' then null else bucket.goal_overlap_minor::text end),
        'commitmentMinor',
          (case when month_group.purpose = 'future'
            then commitment.debt_commitment_minor + commitment.goal_topups_minor
              + greatest(commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor, 0)
            else coalesce(bucket.commitment_minor, 0) end)::text
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join private.planning_expense_buckets(p_space_id, p_currency, v_today, v_month_end, v_horizon_end) bucket
        on bucket.group_id = month_group.group_id
      left join private.planning_cash_commitments(p_space_id, p_currency, v_today) commitment
        on commitment.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );
  end if;

  return jsonb_build_object(
    'currency', p_currency, 'asOf', p_as_of_date, 'state', v_state, 'needsReview', v_needs_review,
    'snapshotId', case when v_has_snapshot then v_snapshot.id::text else null end,
    'cashMinor', v_cash::text, 'goalClaimsMinor', v_claims::text,
    'expenseCommitmentsMinor', case when v_state = 'ready' then v_expense_commitments::text else null end,
    'debtCommitmentsMinor', case when v_state = 'ready' then v_debt_commitments::text else null end,
    'goalTopupsMinor', case when v_state = 'ready' then v_goal_topups::text else null end,
    'futureHeadroomMinor', case when v_state = 'ready' then v_future_headroom::text else null end,
    'availableMinor', case when v_state = 'ready' then v_available::text else null end,
    'deficitMinor', case when v_state = 'ready' then v_deficit::text else null end,
    'spendableMinor', case when v_state = 'ready' then v_spendable::text else null end,
    'dailyExtraGuideMinor', case when v_state = 'ready' then v_daily_guide::text else null end,
    'daysRemaining', v_days_remaining,
    'receivedIncomeMinor', v_received_income::text, 'ordinarySpendingMinor', v_ordinary_spending::text,
    'incomeMinusSpendingMinor', (v_received_income - v_ordinary_spending)::text,
    'uncategorizedMinor', v_uncategorized::text,
    'unmaterializedCount', v_unmaterialized_count,
    'groups', v_groups
  );
end;
$$;
CREATE OR REPLACE FUNCTION private.goal_monthly_extras(p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date, p_covered_minor numeric, p_fulfilled_minor numeric, p_month date) RETURNS TABLE(monthly_target_minor bigint, monthly_net_contribution_minor numeric, suggested_monthly_minor bigint, forecast_month date, forecast_state text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_space uuid := (select space_id from public.goals where id=p_goal_id);
  v_context jsonb := private.space_period_context(v_space,p_month);
  v_today date := (v_context->>'asOf')::date;
  v_this_month date := p_month;
  v_monthly_target bigint;
  v_net_contribution numeric;
  v_progress numeric;
  v_remaining numeric;
  v_months integer;
  v_suggested bigint;
  v_goal_created date;
  v_history_start date;
  v_mean numeric;
  v_periods numeric;
  v_forecast_month date;
  v_forecast_state text;
begin
  SELECT coalesce(line.amount_minor,0) INTO v_monthly_target
  FROM public.goals goal JOIN LATERAL(SELECT id FROM public.allocation_month_snapshots WHERE space_id=goal.space_id AND currency=goal.currency AND month_start=p_month ORDER BY id DESC LIMIT 1)s ON true
  LEFT JOIN public.allocation_month_goal_lines line ON line.snapshot_id=s.id AND line.goal_id=goal.id WHERE goal.id=p_goal_id;

  select coalesce(sum(el.amount_minor), 0) into v_net_contribution
  from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
  where el.goal_id = p_goal_id and ge.effective_date >= (v_context->>'start')::date and ge.effective_date <= v_today;

  v_progress := p_covered_minor + case when p_kind = 'purchase' then p_fulfilled_minor else 0 end;
  v_remaining := greatest(p_target_minor - v_progress, 0);

  if p_deadline is null then
    v_suggested := null;
  else
    v_months := 12 * (extract(year from private.space_period_key_at_date(v_space,p_deadline))::integer - extract(year from v_this_month)::integer)
      + (extract(month from private.space_period_key_at_date(v_space,p_deadline))::integer - extract(month from v_this_month)::integer) + 1;
    if v_months <= 0 then
      v_suggested := case when v_remaining > 0 then null else 0 end;
    else
      v_suggested := ceil(v_remaining / v_months::numeric)::bigint;
    end if;
  end if;

  select private.space_date(v_space,g.created_at) into v_goal_created from public.goals g where g.id = p_goal_id;
  v_history_start := (v_this_month - interval '3 months')::date;
  if v_goal_created > (private.space_period_context(v_space,v_history_start)->>'start')::date then
    v_forecast_month := null;
    v_forecast_state := 'insufficient_history';
  else
    select avg(month_sum) into v_mean
    from (
      select coalesce((
        select sum(el.amount_minor) from public.goal_earmark_lines el
        join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = p_goal_id and ge.effective_date >= (private.space_period_context(v_space,months.month_start)->>'start')::date and ge.effective_date <= (private.space_period_context(v_space,months.month_start)->>'asOf')::date
      ), 0) as month_sum
      from (
        select (v_history_start + (n * interval '1 month'))::date as month_start
        from generate_series(0, 2) as n
      ) months
    ) samples;
    if v_mean is null or v_mean <= 0 then
      v_forecast_month := null;
      v_forecast_state := 'no_positive_pace';
    else
      v_periods := ceil(v_remaining / v_mean);
      if v_periods > 120 then
        v_forecast_month := null;
        v_forecast_state := 'beyond_horizon';
      else
        v_forecast_month := (v_this_month + (v_periods::integer * interval '1 month'))::date;
        v_forecast_state := 'estimate';
      end if;
    end if;
  end if;

  return query select v_monthly_target, v_net_contribution, v_suggested, v_forecast_month, v_forecast_state;
end;
$$;
CREATE OR REPLACE FUNCTION public.allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare v_context jsonb := private.space_period_context(p_space_id,date_trunc('month',p_month)::date);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
  v_asof date := (v_context->>'asOf')::date;
  
  v_month date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_has_plan boolean := false;
  v_actual_income numeric := 0;
  v_expense numeric := 0;
  v_loan_actual bigint := 0;
  v_loan_remaining bigint := 0;
  v_income_after_spending numeric;
  v_current_income_id bigint;
  v_child_plan_changed boolean := false;
  v_standalone_root_targets numeric := 0;
  v_standalone_goal_targets numeric := 0;
  v_standalone_debt numeric := 0;
  v_future_excess numeric := 0;
  v_left_to_allocate numeric := 0;
  v_groups jsonb := '[]'::jsonb;
  v_unmapped_actual numeric := 0;
  v_unmapped_target numeric := 0;
  v_unmapped_carry numeric := 0;
  v_uncategorized_actual numeric := 0;
  v_carry_total numeric := 0;
  v_carry_source_close_id bigint;
  v_carry_needs_review boolean := false;
  v_result jsonb;
begin
  if p_space_id is null or p_month is null or p_currency is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_month := p_month;

  if p_snapshot_id is not null then
    select * into v_snapshot from public.allocation_month_snapshots
      where id = p_snapshot_id and space_id = p_space_id and currency = p_currency and month_start = v_month;
    if not found then
      raise exception using errcode='P0001', message='the requested snapshot does not belong to this space, currency, and month';
    end if;
    v_has_plan := true;
  else
    select * into v_snapshot from public.allocation_month_snapshots
      where space_id = p_space_id and currency = p_currency and month_start = v_month
      order by id desc limit 1;
    v_has_plan := found;
  end if;

  select coalesce(sum(activity.income_minor), 0), coalesce(sum(activity.expense_minor), 0)
    into v_actual_income, v_expense
    from private.planning_period_activity(p_space_id,p_month) activity
    where activity.currency = p_currency;
  v_income_after_spending := v_actual_income - v_expense;

  select coalesce(summary.actual_repayment_minor,0), coalesce(summary.remaining_reservation_minor,0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);

  select id into v_current_income_id from public.monthly_budget_plan_revisions
    where space_id = p_space_id and currency = p_currency and month_start = v_month and plan_kind = 'income'
    order by id desc limit 1;

  if v_has_plan then
    if v_current_income_id is distinct from v_snapshot.income_plan_revision_id then
      v_child_plan_changed := true;
    end if;
    if exists (
      select 1 from public.allocation_month_roots root
      left join lateral (
        select revision.id from public.monthly_budget_plan_revisions revision
        where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
          and revision.plan_kind = 'expense_category' and revision.category_id = root.category_id
        order by revision.id desc limit 1
      ) current_head on true
      where root.snapshot_id = v_snapshot.id and current_head.id is distinct from root.target_revision_id
    ) then
      v_child_plan_changed := true;
    end if;

    select coalesce(sum(carry.carry_minor), 0), max(carry.source_close_id),
      coalesce(sum(carry.carry_minor) filter (where carry.group_id is null), 0)
      into v_carry_total, v_carry_source_close_id, v_unmapped_carry
      from private.allocation_snapshot_carry(v_snapshot.id) carry;
    v_carry_needs_review := private.allocation_snapshot_carry_needs_review(v_snapshot.id);

    select coalesce(sum(root.target_minor),0) into v_standalone_root_targets
      from public.allocation_month_roots root where root.snapshot_id = v_snapshot.id and root.group_id is null;
    select coalesce(sum(goal_line.amount_minor),0) into v_standalone_goal_targets
      from public.allocation_month_goal_lines goal_line where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is null;

    select case when commitment.group_id is null then coalesce(commitment.observed_actual_minor,0) + coalesce(commitment.observed_remaining_minor,0) else 0 end
      into v_standalone_debt
      from public.allocation_month_commitments commitment
      where commitment.snapshot_id = v_snapshot.id;

    select coalesce(sum(greatest(
        coalesce(commitment_for_group.debt_committed,0) + coalesce(goal_for_group.goal_committed,0) - month_group.target_minor, 0
      )),0) into v_future_excess
      from public.allocation_month_groups month_group
      left join (
        select commitment.group_id, commitment.observed_actual_minor + commitment.observed_remaining_minor as debt_committed
        from public.allocation_month_commitments commitment
        where commitment.snapshot_id = v_snapshot.id and commitment.group_id is not null
      ) commitment_for_group on commitment_for_group.group_id = month_group.group_id
      left join (
        select goal_line.group_id, sum(goal_line.amount_minor) as goal_committed
        from public.allocation_month_goal_lines goal_line
        where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is not null
        group by goal_line.group_id
      ) goal_for_group on goal_for_group.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id and month_group.purpose = 'future';

    -- Carry is a distinct adjustment, never salary: left-to-allocate is
    -- still measured against base expected income only.
    v_left_to_allocate := v_snapshot.unallocated_minor - v_standalone_root_targets - v_standalone_goal_targets - v_standalone_debt - v_future_excess;

    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'groupId', month_group.group_id, 'rowKind', month_group.purpose,
        'nameEn', month_group.name_en, 'nameAr', month_group.name_ar, 'order', month_group.display_order,
        'targetMinor', month_group.target_minor::text,
        'carryMinor', coalesce(group_carry.carry_minor, 0)::text,
        'effectiveTargetMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0))::text,
        'actualMinor', (case when month_group.purpose = 'future' then case when commitment_actual.group_id is not null then v_loan_actual else 0 end + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end)::text,
        'varianceMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0)
          - (case when month_group.purpose = 'future' then case when commitment_actual.group_id is not null then v_loan_actual else 0 end + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end))::text,
        'basisPoints', month_group.basis_points,
        'actualShareOfIncomeBps', case when v_actual_income > 0 then
          floor((case when month_group.purpose = 'future' then case when commitment_actual.group_id is not null then v_loan_actual else 0 end + coalesce(goal_actual.actual, 0) else coalesce(group_actual.actual, 0) end) * 10000 / v_actual_income)::text
          else null end,
        'hasPlan', true
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join public.allocation_month_commitments commitment_actual
        on commitment_actual.snapshot_id = month_group.snapshot_id and commitment_actual.group_id = month_group.group_id
      left join (
        select root.group_id, sum(activity.expense_minor) as actual
        from public.allocation_month_roots root
        join private.planning_period_activity(p_space_id,p_month) activity
          on activity.root_id = root.category_id and activity.currency = p_currency
        where root.snapshot_id = v_snapshot.id and root.group_id is not null
        group by root.group_id
      ) group_actual on group_actual.group_id = month_group.group_id
      left join (
        select goal_line.group_id, sum(monthly.net) as actual
        from public.allocation_month_goal_lines goal_line
        cross join lateral (
          select coalesce(sum(el.amount_minor),0) as net
          from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
          where el.goal_id = goal_line.goal_id and ge.effective_date >= v_start and ge.effective_date < v_end and ge.effective_date <= v_asof
        ) monthly
        where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is not null
        group by goal_line.group_id
      ) goal_actual on goal_actual.group_id = month_group.group_id
      left join (
        select carry.group_id, sum(carry.carry_minor) as carry_minor
        from private.allocation_snapshot_carry(v_snapshot.id) carry
        where carry.group_id is not null
        group by carry.group_id
      ) group_carry on group_carry.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );

    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_period_activity(p_space_id,p_month) activity
      where activity.currency = p_currency and activity.root_id is not null
        and not exists (
          select 1 from public.allocation_month_roots root
          where root.snapshot_id = v_snapshot.id and root.category_id = activity.root_id and root.group_id is not null
        );
    v_unmapped_target := v_standalone_root_targets;
  else
    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_period_activity(p_space_id,p_month) activity
      where activity.currency = p_currency and activity.root_id is not null;
  end if;

  select coalesce(sum(activity.expense_minor), 0) into v_uncategorized_actual
    from private.planning_period_activity(p_space_id,p_month) activity
    where activity.currency = p_currency and activity.root_id is null;

  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'unmapped', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', v_unmapped_target::text,
    'carryMinor', v_unmapped_carry::text,
    'effectiveTargetMinor', (v_unmapped_target + v_unmapped_carry)::text,
    'actualMinor', v_unmapped_actual::text,
    'varianceMinor', (v_unmapped_target + v_unmapped_carry - v_unmapped_actual)::text, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_unmapped_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', v_unmapped_target <> 0
  ));
  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'uncategorized', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', null, 'carryMinor', null, 'effectiveTargetMinor', null,
    'actualMinor', v_uncategorized_actual::text, 'varianceMinor', null, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_uncategorized_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', false
  ));

  v_result := jsonb_build_object(
    'snapshotId', v_snapshot.id::text, 'templateRevisionId', v_snapshot.template_revision_id::text,
    'incomeRevisionId', v_snapshot.income_plan_revision_id::text, 'hasPlan', v_has_plan,
    'plannedIncomeMinor', case when v_has_plan then v_snapshot.base_income_minor::text else null end,
    'actualIncomeMinor', v_actual_income::text, 'expenseMinor', v_expense::text,
    'incomeAfterSpendingMinor', v_income_after_spending::text,
    'ownDebtPaidMinor', v_loan_actual::text, 'remainingDebtMinor', CASE WHEN EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=v_snapshot.id) THEN (SELECT coalesce(sum(remaining_reservation_minor),0)::text FROM private.approved_loan_plan(p_space_id,p_month,v_snapshot.id) WHERE currency=p_currency AND direction='i_owe_them') ELSE null END,
    'leftToAllocateMinor', case when v_has_plan then v_left_to_allocate::text else null end,
    'childPlanChanged', v_child_plan_changed,
    'carryMinor', v_carry_total::text, 'carrySourceCloseId', v_carry_source_close_id::text,
    'carryNeedsReview', v_carry_needs_review,
    'asOf', now(), 'groups', v_groups
  );
  v_result:=v_result || jsonb_build_object('planningComplete',EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=v_snapshot.id));
  IF v_has_plan THEN
    v_result:=v_result||jsonb_build_object('leftToAssignMinor',v_snapshot.unallocated_minor::text,'leftToAllocateMinor',v_snapshot.unallocated_minor::text,
      'overcommittedMinor',CASE WHEN EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=v_snapshot.id) THEN private.approved_snapshot_totals(v_snapshot.id)->>'overcommittedMinor' ELSE null END);
  ELSE
    v_result:=v_result||jsonb_build_object('leftToAssignMinor',null,'overcommittedMinor',null);
  END IF;
  return v_result;
end;
$$;

CREATE FUNCTION private.approved_snapshot_totals(p_snapshot_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.period_plan_assignment_totals(s.base_income_minor::text,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',group_id,'order',display_order,'basisPoints',basis_points)),'[]') FROM public.allocation_month_groups WHERE snapshot_id=s.id),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'amountMinor',target_minor::text)),'[]') FROM public.allocation_month_roots WHERE snapshot_id=s.id),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'groupId',group_id)),'[]') FROM public.allocation_month_roots WHERE snapshot_id=s.id AND group_id IS NOT NULL),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('groupId',group_id,'amountMinor',amount_minor::text)),'[]') FROM public.allocation_month_goal_lines WHERE snapshot_id=s.id),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('amountMinor',amount_minor::text)),'[]') FROM public.period_plan_loan_lines WHERE snapshot_id=s.id),
 (SELECT group_id FROM public.allocation_month_commitments WHERE snapshot_id=s.id))
 FROM public.allocation_month_snapshots s WHERE s.id=p_snapshot_id;
$$;
REVOKE ALL ON FUNCTION private.approved_snapshot_totals(bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.approved_budget_summary(p_space_id uuid,p_period_key date,p_currency public.currency_code)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.allocation_month_snapshots%rowtype; complete boolean; totals jsonb; actual_income numeric; categorized numeric; uncategorized numeric; overspent numeric; debt_actual numeric; debt_remaining numeric;
BEGIN
 IF NOT private.is_active_member(p_space_id) THEN RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized'; END IF;
 IF p_currency IS NULL OR p_period_key IS NULL OR p_period_key<>date_trunc('month',p_period_key)::date THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 SELECT * INTO s FROM public.allocation_month_snapshots WHERE space_id=p_space_id AND currency=p_currency AND month_start=p_period_key ORDER BY id DESC LIMIT 1;
 complete:=EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=s.id);
 totals:=private.approved_snapshot_totals(s.id);
 SELECT coalesce(sum(income_minor),0),coalesce(sum(expense_minor)FILTER(WHERE root_id IS NOT NULL),0),coalesce(sum(expense_minor)FILTER(WHERE root_id IS NULL),0) INTO actual_income,categorized,uncategorized FROM private.planning_period_activity(p_space_id,p_period_key) WHERE currency=p_currency;
 SELECT coalesce(sum(greatest(coalesce(a.spent,0)-r.target_minor,0)),0) INTO overspent FROM public.allocation_month_roots r LEFT JOIN (SELECT root_id,sum(expense_minor)spent FROM private.planning_period_activity(p_space_id,p_period_key) WHERE currency=p_currency GROUP BY root_id)a ON a.root_id=r.category_id WHERE r.snapshot_id=s.id AND r.target_minor>0;
 SELECT coalesce(sum(actual_repayment_minor),0),coalesce(sum(remaining_reservation_minor),0) INTO debt_actual,debt_remaining FROM private.approved_loan_plan(p_space_id,p_period_key) WHERE currency=p_currency AND direction='i_owe_them';
 RETURN jsonb_build_object('snapshotId',s.id::text,'planningComplete',complete,'currency',p_currency,'plannedIncomeMinor',coalesce(s.base_income_minor,0)::text,'actualIncomeMinor',actual_income::text,
 'categoryTargetTotalMinor',(SELECT coalesce(sum(target_minor),0)::text FROM public.allocation_month_roots WHERE snapshot_id=s.id),'categoryActualSpentMinor',categorized::text,'uncategorizedSpentMinor',uncategorized::text,'categoryOverspentMinor',overspent::text,
 'actualLoanRepaymentMinor',debt_actual::text,'remainingLoanReservationMinor',CASE WHEN complete THEN debt_remaining::text ELSE null END,'loanCommitmentMinor',CASE WHEN complete THEN (debt_actual+debt_remaining)::text ELSE null END,
 'leftToAssignMinor',coalesce(totals->>'leftToAssignMinor','0'),'overcommittedMinor',CASE WHEN complete THEN totals->>'overcommittedMinor' ELSE null END,'incomePlanRevisionId',s.income_plan_revision_id::text,
 'approvedDebtEvidence',(SELECT jsonb_build_object('observedActualMinor',observed_actual_minor::text,'observedRemainingMinor',observed_remaining_minor::text,'loanGroupId',group_id) FROM public.allocation_month_commitments WHERE snapshot_id=s.id));
END; $$;
REVOKE ALL ON FUNCTION public.approved_budget_summary(uuid,date,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approved_budget_summary(uuid,date,public.currency_code) TO authenticated;
CREATE FUNCTION private.validate_period_plan_save_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM private.check_allocation_month(NEW.snapshot_id); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION private.validate_period_plan_save_evidence() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER period_plan_save_evidence_valid AFTER INSERT ON private.period_plan_save_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_period_plan_save_evidence();
CREATE OR REPLACE FUNCTION public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := (private.space_period_context(p_space_id,p_month)->>'asOf')::date;
  v_goal public.goals%rowtype;
  v_row record;
  v_extras record;
  v_milestones jsonb;
  v_summary jsonb;
begin
  if p_space_id is null or p_goal_id is null or p_month is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;

  select * into v_row from private.goal_coverage_set(p_space_id, v_goal.currency, v_as_of) coverage
    where coverage.goal_id = p_goal_id;
  if not found then
    raise exception using errcode='P0001', message='the goal is not currently relevant';
  end if;

  select * into v_extras from private.goal_monthly_extras(
    v_row.goal_id, v_row.kind, v_row.target_minor, v_row.deadline, v_row.covered_minor, v_row.fulfilled_minor, p_month
  );

  v_milestones := (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', grm.milestone_id::text, 'kind', grm.kind, 'labelEn', grm.label_en, 'labelAr', grm.label_ar,
      'thresholdMinor', grm.threshold_minor::text, 'dueDate', grm.due_date, 'ordinal', grm.ordinal,
      'currentState', case
        when grm.kind = 'amount' then
          case when (v_row.covered_minor + case when v_row.kind = 'purchase' then v_row.fulfilled_minor else 0 end) >= grm.threshold_minor
            then 'complete' else 'incomplete' end
        else case when (
          select event.action from public.goal_milestone_events event
          where event.milestone_id = grm.milestone_id order by event.id desc limit 1
        ) = 'complete' then 'complete' else 'incomplete' end
      end
    ) order by grm.ordinal), '[]'::jsonb)
    from public.goal_revision_milestones grm where grm.revision_id = v_row.revision_id
  );

  v_summary := jsonb_build_object(
    'id', v_row.goal_id::text, 'revisionId', v_row.revision_id::text, 'currency', v_goal.currency,
    'kind', v_row.kind, 'state', v_row.state, 'nameEn', v_row.name_en, 'nameAr', v_row.name_ar,
    'targetMinor', v_row.target_minor::text, 'earmarkedMinor', v_row.earmarked_minor::text,
    'coveredMinor', v_row.covered_minor::text, 'fulfilledMinor', v_row.fulfilled_minor::text,
    'shortageMinor', (v_row.earmarked_minor - v_row.covered_minor)::text,
    'snapshotId',private.approved_plan_identity(p_space_id,p_month,v_goal.currency)->>'snapshotId',
    'monthlyTargetMinor', v_extras.monthly_target_minor::text,
    'monthlyNetContributionMinor', v_extras.monthly_net_contribution_minor::text,
    'dueDate', v_row.deadline,
    'horizon', case when v_row.deadline is null then 'open'
      when v_row.deadline <= (v_row.created_at::date + interval '12 months')::date then 'short' else 'long' end,
    'needsReview', v_row.state = 'closed' and v_row.earmarked_minor <> 0,
    'suggestedMonthlyMinor', v_extras.suggested_monthly_minor::text,
    'forecastMonth', v_extras.forecast_month, 'forecastState', v_extras.forecast_state, 'asOf', v_as_of
  );

  return jsonb_build_object(
    'summary', v_summary, 'milestones', v_milestones,
    'earmarkHead', v_row.head, 'definitionHead', v_row.revision_id::text, 'asOf', v_as_of
  );
end;
$$;
CREATE OR REPLACE FUNCTION public.goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := private.space_today(p_space_id);
  v_this_month date := private.space_period_key_at_date(p_space_id,v_as_of);
  v_rows jsonb;
  v_has_more boolean;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if p_space_id is null or p_currency is null or p_state_filter is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_state_filter not in ('active','paused','closed','all','needs_review') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if (p_after_created_at is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with coverage as (
    select * from private.goal_coverage_set(p_space_id, p_currency, v_as_of)
  ), filtered as (
    select * from coverage
    where (p_state_filter = 'all')
      or (p_state_filter = 'needs_review' and state = 'closed')
      or (p_state_filter <> 'all' and p_state_filter <> 'needs_review' and state = p_state_filter)
  ), page as (
    select * from filtered
    where p_after_created_at is null
      or (created_at, goal_id) > (p_after_created_at, p_after_id)
    order by created_at, goal_id
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by created_at, goal_id) as rn from page
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', numbered.goal_id::text, 'revisionId', numbered.revision_id::text, 'currency', p_currency,
      'kind', numbered.kind, 'state', numbered.state, 'nameEn', numbered.name_en, 'nameAr', numbered.name_ar,
      'targetMinor', numbered.target_minor::text, 'earmarkedMinor', numbered.earmarked_minor::text,
      'coveredMinor', numbered.covered_minor::text, 'fulfilledMinor', numbered.fulfilled_minor::text,
      'shortageMinor', (numbered.earmarked_minor - numbered.covered_minor)::text,
    'snapshotId',private.approved_plan_identity(p_space_id,v_this_month,p_currency)->>'snapshotId',
      'monthlyTargetMinor', extras.monthly_target_minor::text,
      'monthlyNetContributionMinor', extras.monthly_net_contribution_minor::text,
      'dueDate', numbered.deadline,
      'horizon', case when numbered.deadline is null then 'open'
        when numbered.deadline <= (numbered.created_at::date + interval '12 months')::date then 'short' else 'long' end,
      'needsReview', numbered.state = 'closed' and numbered.earmarked_minor <> 0,
      'suggestedMonthlyMinor', extras.suggested_monthly_minor::text,
      'forecastMonth', extras.forecast_month, 'forecastState', extras.forecast_state, 'asOf', v_as_of
    ) order by numbered.created_at, numbered.goal_id), '[]'::jsonb)
     from numbered
     cross join lateral private.goal_monthly_extras(
       numbered.goal_id, numbered.kind, numbered.target_minor, numbered.deadline,
       numbered.covered_minor, numbered.fulfilled_minor, v_this_month
     ) extras
     where numbered.rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select created_at from numbered where rn = p_limit),
    (select goal_id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_created_at, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('createdAt', v_next_created_at, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;
CREATE OR REPLACE FUNCTION public.report_category_actual_vs_budget(p_space_id uuid, p_month date) RETURNS TABLE(category_key text, category_name_en text, category_name_ar text, category_kind public.category_kind, currency public.currency_code, actual_net_minor bigint, budget_minor bigint, remaining_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_start date;
  v_end date;
begin
  if p_space_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then raise exception using errcode='42501', message='an active space membership and normalized month are required'; end if;
  select bounds.period_start, bounds.period_end into v_start, v_end
  from public.space_period_bounds(p_space_id, p_month) bounds;
  v_end:=least(v_end,(private.space_period_context(p_space_id,p_month)->>'asOf')::date+1);
  return query with current_targets as (
    SELECT r.category_id,r.currency,r.target_minor amount_minor FROM public.allocation_month_roots r
    JOIN (SELECT DISTINCT ON(snap.currency) snap.id FROM public.allocation_month_snapshots snap WHERE snap.space_id=p_space_id AND snap.month_start=p_month ORDER BY snap.currency,snap.id DESC)s ON s.id=r.snapshot_id
  ), actuals as (
    -- Roll a subcategory's spend into its root: association.category_id names
    -- the exact tagged category, but the target lives on the root, so group by
    -- coalesce(tagged.parent_category_id, tagged.id) instead of the tagged id.
    -- movement.amount_minor is already correctly signed for a reversal, so a
    -- single -sum(...) nets it, matching monthly_budget_currency_summary.
    select coalesce(root.id::text, 'uncategorized:expense') key, root.id as category_id, wallet.currency, (-sum(movement.amount_minor))::bigint amount
    from public.financial_events event join public.wallet_movements movement on movement.event_id=event.id and movement.space_id=p_space_id join public.wallets wallet on wallet.id=movement.wallet_id and wallet.space_id=p_space_id
    left join public.financial_event_categories category on category.event_id=event.id and category.space_id=p_space_id
    left join public.categories tagged on tagged.id=category.category_id and tagged.space_id=p_space_id
    left join public.categories root on root.id=coalesce(tagged.parent_category_id, tagged.id) and root.space_id=p_space_id
    left join public.financial_events original on original.id=event.reversal_of and original.space_id=p_space_id
    where event.space_id=p_space_id and event.effective_date >= v_start and event.effective_date < v_end and coalesce(original.kind,event.kind)='expense'
    group by coalesce(root.id::text, 'uncategorized:expense'), root.id, wallet.currency
  -- Bare "currency" here is ambiguous against the function's own OUT
  -- parameter of the same name; every reference must be CTE-qualified.
  ), keys as (select category_id, current_targets.currency from current_targets union select category_id, actuals.currency from actuals)
  select coalesce(category.id::text, 'uncategorized:expense'), category.name_en, category.name_ar, coalesce(category.kind, 'expense'::public.category_kind), keys.currency,
    coalesce(actuals.amount,0), nullif(current_targets.amount_minor,0), nullif(current_targets.amount_minor,0)-coalesce(actuals.amount,0)
  from keys left join public.categories category on category.id=keys.category_id and category.space_id=p_space_id left join current_targets on current_targets.category_id is not distinct from keys.category_id and current_targets.currency=keys.currency left join actuals on actuals.category_id is not distinct from keys.category_id and actuals.currency=keys.currency
  order by category.name_en nulls last, category.id, keys.currency;
end; $$;
