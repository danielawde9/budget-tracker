-- Accepted-write order is assigned after the planning space lock. UUIDs remain
-- public revision identities; transaction-start timestamps remain audit data.
-- Existing revisions are intentionally NOT backfilled with invented order.
CREATE TABLE private.loan_target_acceptance_order (
 revision_id uuid PRIMARY KEY REFERENCES public.loan_monthly_target_revisions(id),
 acceptance_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL
);
ALTER TABLE private.loan_target_acceptance_order ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.loan_target_acceptance_order FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.loan_target_acceptance_order_acceptance_id_seq FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER loan_target_acceptance_order_owner_write BEFORE INSERT ON private.loan_target_acceptance_order FOR EACH STATEMENT EXECUTE FUNCTION private.require_table_owner_write();
CREATE TRIGGER loan_target_acceptance_order_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.loan_target_acceptance_order FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();

CREATE FUNCTION private.current_loan_period_targets(p_space_id uuid,p_period_key date)
RETURNS TABLE(loan_id uuid,id uuid,target_minor bigint,is_legacy boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 -- Ordered accepted commands always supersede legacy effective heads. For a
 -- target with no accepted-order metadata, preserve the old EFFECTIVE selector;
 -- this is compatibility evidence, not a claim about historical acceptance.
 SELECT DISTINCT ON (r.loan_id) r.loan_id,r.id,r.target_minor,a.acceptance_id IS NULL
 FROM public.loan_monthly_target_revisions r
 LEFT JOIN private.loan_target_acceptance_order a ON a.revision_id=r.id
 WHERE r.space_id=p_space_id AND r.target_month=p_period_key
 ORDER BY r.loan_id,a.acceptance_id DESC NULLS LAST,r.created_at DESC,r.id DESC;
$$;
REVOKE ALL ON FUNCTION private.current_loan_period_targets(uuid,date) FROM PUBLIC,anon,authenticated,service_role;

-- A row (including line_count=0) proves publication captured the entire target
-- set. Legacy snapshots intentionally have no marker and are not backfilled.
CREATE TABLE public.period_plan_loan_sets (
 snapshot_id bigint PRIMARY KEY,
 space_id uuid NOT NULL,
 currency public.currency_code NOT NULL,
 line_count integer NOT NULL CHECK(line_count BETWEEN 0 AND 10000),
 FOREIGN KEY(snapshot_id,space_id,currency) REFERENCES public.allocation_month_snapshots(id,space_id,currency)
);
CREATE TABLE public.period_plan_loan_lines (
 snapshot_id bigint NOT NULL REFERENCES public.period_plan_loan_sets(snapshot_id),
 space_id uuid NOT NULL,
 loan_id uuid NOT NULL,
 target_revision_id uuid REFERENCES public.loan_monthly_target_revisions(id),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 PRIMARY KEY(snapshot_id,loan_id),
 FOREIGN KEY(loan_id,space_id) REFERENCES public.loans(id,space_id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['period_plan_loan_sets','period_plan_loan_lines'] LOOP
  EXECUTE format('alter table public.%I enable row level security',tab);
  EXECUTE format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  EXECUTE format('grant select on public.%I to authenticated',tab);
  EXECUTE format('create policy %I on public.%I for select to authenticated using(private.is_active_member(space_id))',tab||'_member_read',tab);
  EXECUTE format('create trigger %I before insert on public.%I for each statement execute function private.require_table_owner_write()',tab||'_owner_write',tab);
  EXECUTE format('create trigger %I before update or delete or truncate on public.%I for each statement execute function private.planning_reject_mutation()',tab||'_immutable',tab);
 END LOOP;
END; $$;
CREATE FUNCTION private.validate_period_plan_loans() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid bigint:=NEW.snapshot_id; header public.period_plan_loan_sets%rowtype;
BEGIN
 SELECT * INTO header FROM public.period_plan_loan_sets WHERE snapshot_id=sid;
 IF header.line_count<>(SELECT count(*) FROM public.period_plan_loan_lines WHERE snapshot_id=sid)
 OR EXISTS(SELECT 1 FROM public.period_plan_loan_lines line
 JOIN public.loans loan ON loan.id=line.loan_id
 JOIN public.allocation_month_snapshots snap ON snap.id=line.snapshot_id
 LEFT JOIN public.loan_monthly_target_revisions r ON r.id=line.target_revision_id
 WHERE line.snapshot_id=sid AND (line.space_id<>header.space_id OR loan.currency<>header.currency OR loan.direction<>'i_owe_them'
 OR (line.target_revision_id IS NULL AND line.amount_minor<>0)
 OR (line.target_revision_id IS NOT NULL AND (r.loan_id<>line.loan_id OR r.space_id<>line.space_id OR r.target_month<>snap.month_start OR r.target_minor<>line.amount_minor)))) THEN
  RAISE EXCEPTION USING errcode='23514',message='period_plan_loan_set_invalid';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER period_plan_loan_sets_complete AFTER INSERT ON public.period_plan_loan_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_period_plan_loans();
CREATE CONSTRAINT TRIGGER period_plan_loan_lines_complete AFTER INSERT ON public.period_plan_loan_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_period_plan_loans();
CREATE FUNCTION private.freeze_period_plan_loans(p_snapshot_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap public.allocation_month_snapshots%rowtype; targets jsonb;
BEGIN
 SELECT * INTO STRICT snap FROM public.allocation_month_snapshots WHERE id=p_snapshot_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('loanId',loan.id,'revisionId',r.id,'amount',coalesce(r.target_minor,0))),'[]') INTO targets
 FROM public.loans loan LEFT JOIN private.current_loan_period_targets(snap.space_id,snap.month_start)r ON r.loan_id=loan.id
 WHERE loan.space_id=snap.space_id AND loan.currency=snap.currency AND loan.direction='i_owe_them';
 IF jsonb_array_length(targets)>10000 THEN RAISE EXCEPTION USING errcode='54000',message='period_plan_too_large'; END IF;
 INSERT INTO public.period_plan_loan_sets(snapshot_id,space_id,currency,line_count) VALUES(snap.id,snap.space_id,snap.currency,jsonb_array_length(targets));
 INSERT INTO public.period_plan_loan_lines(snapshot_id,space_id,loan_id,target_revision_id,amount_minor)
 SELECT snap.id,snap.space_id,(r->>'loanId')::uuid,(r->>'revisionId')::uuid,(r->>'amount')::bigint FROM jsonb_array_elements(targets)r;
END; $$;
REVOKE ALL ON FUNCTION private.freeze_period_plan_loans(bigint),private.validate_period_plan_loans() FROM PUBLIC,anon,authenticated,service_role;

-- Complete editable read. Snapshot values and mutable command heads are
-- deliberately selected separately in one PostgreSQL statement snapshot.
CREATE FUNCTION public.period_plan_page(p_space_id uuid,p_period_key date,p_currency public.currency_code)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE
 s public.allocation_month_snapshots%rowtype;
 template_head bigint; income_head bigint; income_amount bigint;
 v_template_id bigint; groups jsonb; mappings jsonb; roots jsonb; goals jsonb;
 loans jsonb := '[]'; categories jsonb; archived jsonb;
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
  SELECT g.id, saved.group_id,
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
 RETURN jsonb_build_object('lineCounts',jsonb_build_object('groups',jsonb_array_length(groups),'rootMappings',jsonb_array_length(mappings),'rootTargets',jsonb_array_length(roots),'goalTargets',jsonb_array_length(goals),'loanTargets',jsonb_array_length(loans),'categories',jsonb_array_length(categories),'archivedReferences',jsonb_array_length(archived)),'context',context,'currency',p_currency,'snapshotId',s.id::text,
 'draft',jsonb_build_object('expectedSnapshotId',s.id::text,'expectedTemplateRevisionId',template_head::text,'expectedIncomeRevisionId',income_head::text,'incomeMinor',income_amount::text,'groups',groups,'rootMappings',mappings,'rootTargets',roots,'goalTargets',goals,'loanTargets',loans,'loanGroupId',loan_group,'acceptOverallocated',false,'goalDefaultChanges','[]'::jsonb),
 'categories',categories,'needsLegacyReview',review,'archivedReferences',archived,'leftToAssignMinor',left_minor::text,'overcommittedMinor',excess::text);
END; $$;
REVOKE ALL ON FUNCTION public.period_plan_page(uuid,date,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.period_plan_page(uuid,date,public.currency_code) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid) RETURNS jsonb
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
  v_category_ids uuid[] := '{}';
  v_entry jsonb;
  v_category_id uuid;
  v_amount_minor bigint;
  v_expected_revision_id bigint;
  v_required_missing integer;
  v_existing_positive_goals integer;
  v_over_target_groups integer;
  v_loan_group_purpose text;
  v_loan_group_target bigint;
  v_loan_actual bigint;
  v_loan_remaining bigint;
  v_income_child_request uuid;
  v_income_id bigint;
  v_income_month date;
  v_child_request uuid;
  v_root_revision_id bigint;
  v_snapshot_id bigint;
  v_group_count integer;
  v_root_count integer;
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
    or jsonb_array_length(p_root_targets) > 200 then
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

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('publish_allocation_month', v_actor, jsonb_build_object(
    'month', v_month, 'currency', p_currency, 'expectedSnapshotId', p_expected_snapshot_id,
    'templateRevisionId', p_template_revision_id, 'expectedIncomeRevisionId', p_expected_income_revision_id,
    'incomeMinor', v_income_minor::text, 'rootTargets', v_canonical_roots, 'loanGroupId', p_loan_group_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'publish_allocation_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  if v_current_snapshot_id is distinct from p_expected_snapshot_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select count(*) into v_existing_positive_goals
  from (
    select revision.goal_id from public.goal_monthly_target_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
  ) required
  cross join lateral (
    select latest.amount_minor from public.goal_monthly_target_revisions latest
    where latest.goal_id = required.goal_id and latest.space_id = p_space_id
      and latest.currency = p_currency and latest.month_start = v_month
    order by latest.id desc limit 1
  ) latest_target
  where latest_target.amount_minor > 0;
  if v_existing_positive_goals <> 0 then
    raise exception using errcode='P0001', message='existing positive goal targets must be included via publish_allocation_month_v2';
  end if;

  -- The template need not be the latest revision -- the caller deliberately
  -- selected it -- but it must be a real revision belonging to this exact
  -- space and currency.
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

  -- Complete-set rule: every template-mapped root, plus every category that
  -- currently has a positive manual target this month/currency, must appear
  -- in this submission (a stopped target is submitted explicitly as zero).
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

  -- Fail fast on group overallocation (the deferred check re-verifies this
  -- exactly against the snapshot rows once they are actually inserted).
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
  if v_over_target_groups <> 0 then
    raise exception using errcode='P0001', message='the requested root targets exceed their spending group target';
  end if;

  -- Loan pool: a linked group must be an included Future group large enough
  -- for the observed commitment; a standalone loan pool has no group-fit
  -- constraint and may be saved even while overallocated.
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
    if v_loan_actual + v_loan_remaining > v_loan_group_target then
      raise exception using errcode='P0001', message='the observed loan commitment does not fit its linked Future group';
    end if;
  end if;

  -- Publish the income plan, then each root target, in category-UUID order,
  -- each under a request ID deterministically derived from this command's
  -- own request ID so a retry with the same parent request replays the same
  -- children instead of minting new revisions.
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
    jsonb_array_length(v_canonical_roots), 1, 0, p_request_id, v_actor
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
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
    insert into public.allocation_month_roots (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
    values (
      v_snapshot_id, v_category_id,
      (select template_root.group_id from public.allocation_template_roots template_root
        where template_root.template_id = p_template_revision_id and template_root.category_id = v_category_id),
      p_space_id, p_currency, v_root_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  insert into public.allocation_month_commitments (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
  values (v_snapshot_id, p_space_id, p_currency, p_loan_group_id, 'loan_pool', v_loan_actual, v_loan_remaining);

  v_result := jsonb_build_object('snapshotId', v_snapshot_id::text, 'incomeRevisionId', v_income_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'publish_allocation_month', v_fingerprint, v_actor, v_result);

  perform private.freeze_period_plan_loans(v_snapshot_id);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb) RETURNS jsonb
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
    or jsonb_array_length(p_root_targets) > 200 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_goal_targets is null or jsonb_typeof(p_goal_targets) is distinct from 'array'
    or jsonb_array_length(p_goal_targets) > 100 then
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
  if v_over_target_groups <> 0 then
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
    if v_loan_actual + v_loan_remaining > v_loan_group_target then
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
  if v_over_target_goal_groups <> 0 then
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
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
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
    v_goal_revision_id := (public.set_goal_monthly_target(
      p_space_id, v_child_request, v_goal_id, v_month, v_entry->>'amountMinor', v_expected_revision_id
    )->>'revisionId')::bigint;
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

  perform private.freeze_period_plan_loans(v_snapshot_id);
  return v_result;
end;
$_$;

-- Match publication lock ordering: space, request, loan.
CREATE OR REPLACE FUNCTION public.set_loan_monthly_target(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_month date, p_target_minor text) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_target_month date := date_trunc('month', p_month)::date;
  v_target_minor bigint;
  v_direction public.loan_direction;
  v_outstanding_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_planning_actor(p_space_id);
  v_target_minor := private.parse_nonnegative_minor_amount(p_target_minor);
  v_fingerprint := extensions.digest(
    'loan_monthly_target|' || p_loan_id::text || '|' || v_target_month::text || '|'
      || p_target_minor,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select revision.request_fingerprint, revision.id
  into v_existing_fingerprint, v_existing_id
  from public.loan_monthly_target_revisions as revision
  where revision.space_id = p_space_id
    and revision.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_id;
    return;
  end if;

  select loan.direction
  into v_direction
  from public.loans as loan
  where loan.id = p_loan_id
    and loan.space_id = p_space_id
  for update;

  if not found or v_direction <> 'i_owe_them' then
    raise exception using errcode = 'P0001', message = 'monthly repayment targets are available only for loans I owe';
  end if;

  select coalesce(sum(posting.principal_delta_minor), 0)
  into v_outstanding_minor
  from public.loan_postings as posting
  where posting.loan_id = p_loan_id;

  if v_target_minor > v_outstanding_minor then
    raise exception using errcode = 'P0001', message = 'the monthly target cannot exceed outstanding principal';
  end if;

  insert into public.loan_monthly_target_revisions (
    space_id, loan_id, request_id, request_fingerprint, target_month, target_minor, actor_id
  )
  values (
    p_space_id, p_loan_id, p_request_id, v_fingerprint, v_target_month, v_target_minor, v_actor_id
  )
  returning loan_monthly_target_revisions.id into v_existing_id;

  insert into private.loan_target_acceptance_order(revision_id) values(v_existing_id);
  return query select v_existing_id;
end;
$$;

-- Preserve the B2 period/stock graph, replacing only its target selector.
CREATE OR REPLACE FUNCTION public.loan_monthly_plan(p_space_id uuid, p_month date) RETURNS TABLE(loan_id uuid, currency public.currency_code, direction public.loan_direction, target_minor bigint, actual_repayment_minor bigint, remaining_reservation_minor bigint, due_amount_minor bigint, expected_collection_minor bigint)
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
    select target.loan_id,target.target_minor
    from private.current_loan_period_targets(p_space_id,v_month) target
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
    coalesce(target.target_minor, 0)::bigint,
    greatest(coalesce(actual.actual_repayment_minor, 0), 0)::bigint,
    least(
      greatest(
        coalesce(target.target_minor, 0) - greatest(coalesce(actual.actual_repayment_minor, 0), 0),
        0
      ),
      balance.outstanding_minor::bigint
    )::bigint,
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
