-- Explicit selected-period variants of the accepted cash buckets. Current-only public cash reads retain their contract.
CREATE FUNCTION private.daily_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_period_key date, p_as_of date) RETURNS TABLE(group_id uuid, group_target_minor numeric, debt_commitment_minor numeric, goal_topups_minor numeric, saved_goal_targets_minor numeric, original_debt_commitment_minor numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month date := p_period_key;
  v_context jsonb := private.space_period_context(p_space_id,v_month);
  v_start date := (v_context->>'start')::date;
  v_end date := (v_context->>'endExclusive')::date;
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
CREATE FUNCTION private.daily_expense_buckets(p_space_id uuid, p_currency public.currency_code, p_period_key date, p_as_of date, p_month_end date, p_horizon_end date) RETURNS TABLE(group_id uuid, root_id uuid, budget_remaining_minor numeric, unpaid_bills_minor numeric, goal_overlap_minor numeric, commitment_minor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  with snapshot as (
    select id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = p_period_key
    order by id desc limit 1
  ), root_targets as (
    select r.category_id as root_id, r.group_id,
      r.target_minor::numeric + coalesce(link.carry_minor, 0) as target_minor
    from public.allocation_month_roots r
    left join public.budget_month_carry_links link
      on link.target_snapshot_id = r.snapshot_id and link.root_id = r.category_id
    where r.snapshot_id = (select id from snapshot)
  ), group_targets as (
    select g.group_id,
      g.target_minor::numeric + coalesce((
        select sum(link.carry_minor)
        from public.budget_month_carry_links link
        join public.allocation_month_roots r on r.snapshot_id = link.target_snapshot_id and r.category_id = link.root_id
        where link.target_snapshot_id = g.snapshot_id and r.group_id = g.group_id
      ), 0) as target_minor
    from public.allocation_month_groups g
    where g.snapshot_id = (select id from snapshot) and g.purpose = 'spending'
  ), spent as (
    select act.root_id, sum(act.expense_minor) as spent_minor
    from private.planning_period_activity(p_space_id,p_period_key) act
    where act.currency = p_currency and act.root_id is not null
    group by act.root_id
  ), unpaid_bills as (
    select coalesce(cat.parent_category_id, cat.id) as root_id, so.id as occurrence_id,
      greatest(so.expected_minor - stl.settled_minor, 0) as remaining_minor
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind = 'expense'
    left join public.categories cat on cat.id = so.category_id and cat.space_id = p_space_id
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.space_id = p_space_id and so.currency = p_currency
      and so.due_date <= p_month_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
  ), coverage as (
    select * from private.planning_goal_bill_coverage(p_space_id, p_currency, p_as_of, p_horizon_end)
  ), bill_totals as (
    select unpaid_bills.root_id, sum(unpaid_bills.remaining_minor) as o_minor,
      coalesce(sum(coverage.applied_minor), 0) as g_minor
    from unpaid_bills
    left join coverage on coverage.occurrence_id = unpaid_bills.occurrence_id
    group by unpaid_bills.root_id
  ), mapped_group_totals as (
    select root_targets.group_id,
      coalesce(sum(spent.spent_minor), 0) as spent_minor,
      coalesce(sum(bill_totals.o_minor), 0) as o_minor,
      coalesce(sum(bill_totals.g_minor), 0) as g_minor
    from root_targets
    left join spent on spent.root_id = root_targets.root_id
    left join bill_totals on bill_totals.root_id = root_targets.root_id
    where root_targets.group_id is not null
    group by root_targets.group_id
  ), group_buckets as (
    select group_targets.group_id, null::uuid as root_id,
      greatest(group_targets.target_minor - coalesce(mapped_group_totals.spent_minor, 0), 0) as b_minor,
      coalesce(mapped_group_totals.o_minor, 0) as o_minor, coalesce(mapped_group_totals.g_minor, 0) as g_minor
    from group_targets
    left join mapped_group_totals on mapped_group_totals.group_id = group_targets.group_id
  ), unmapped_root_buckets as (
    select null::uuid as group_id, root_targets.root_id,
      greatest(root_targets.target_minor - coalesce(spent.spent_minor, 0), 0) as b_minor,
      coalesce(bill_totals.o_minor, 0) as o_minor, coalesce(bill_totals.g_minor, 0) as g_minor
    from root_targets
    left join spent on spent.root_id = root_targets.root_id
    left join bill_totals on bill_totals.root_id = root_targets.root_id
    where root_targets.group_id is null
  ), untargeted_bill_buckets as (
    select null::uuid as group_id, bill_totals.root_id,
      0::numeric as b_minor, bill_totals.o_minor, bill_totals.g_minor
    from bill_totals
    where not exists (
      select 1 from root_targets where root_targets.root_id is not distinct from bill_totals.root_id
    )
  ), buckets as (
    select * from group_buckets
    union all select * from unmapped_root_buckets
    union all select * from untargeted_bill_buckets
  )
  select buckets.group_id, buckets.root_id, buckets.b_minor, buckets.o_minor, buckets.g_minor,
    greatest(buckets.b_minor, buckets.o_minor) - least(buckets.g_minor, greatest(buckets.b_minor, buckets.o_minor))
  from buckets;
$$;


REVOKE ALL ON FUNCTION private.daily_cash_commitments(uuid,public.currency_code,date,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.daily_expense_buckets(uuid,public.currency_code,date,date,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.daily_control_summary(p_space_id uuid,p_period_key date,p_currency public.currency_code) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,extensions SET statement_timeout='10s' AS $$
DECLARE
 context jsonb; as_of date; period_end date; horizon_start date; horizon_end date;
 sid bigint; state text; missing integer:=0; backlog integer:=0;
 cash numeric; claims numeric; everyday numeric; fixed numeric; extra numeric; shortfall numeric;
 expenses numeric; debt numeric; topups numeric; headroom numeric; available numeric;
 unmapped numeric; uncategorized numeric;
BEGIN
 IF p_space_id IS NULL OR NOT private.is_active_member(p_space_id) THEN
  RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized';
 END IF;
 IF p_period_key IS NULL OR NOT isfinite(p_period_key) OR p_period_key<>date_trunc('month',p_period_key)::date OR p_currency IS NULL THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 context:=private.space_period_context(p_space_id,p_period_key);
 as_of:=(context->>'asOf')::date; period_end:=(context->>'endExclusive')::date-1;
 horizon_start:=greatest(as_of,(context->>'start')::date); horizon_end:=horizon_start+89;
 SELECT id INTO sid FROM public.allocation_month_snapshots WHERE space_id=p_space_id AND month_start=p_period_key AND currency=p_currency ORDER BY id DESC LIMIT 1;
 cash:=private.goal_cash_pool(p_space_id,p_currency,as_of);
 claims:=private.goal_space_earmarked_total(p_space_id,p_currency,as_of);
 SELECT coalesce(sum(a.expense_minor) FILTER(WHERE a.root_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.allocation_month_roots r WHERE r.snapshot_id=sid AND r.category_id=a.root_id AND r.group_id IS NOT NULL)),0),
  coalesce(sum(a.expense_minor) FILTER(WHERE a.root_id IS NULL),0)
 INTO unmapped,uncategorized FROM private.planning_period_activity(p_space_id,p_period_key) a WHERE a.currency=p_currency;
 IF sid IS NULL THEN state:='unplanned';
 ELSE
  -- Ordinary expense is counted once. Goal fulfillment/coverage is not an additional outflow.
  SELECT coalesce(sum(greatest(g.target_minor + coalesce((SELECT sum(l.carry_minor) FROM public.budget_month_carry_links l JOIN public.allocation_month_roots r ON r.snapshot_id=l.target_snapshot_id AND r.category_id=l.root_id WHERE l.target_snapshot_id=sid AND r.group_id=g.group_id),0)
    - coalesce((SELECT sum(a.expense_minor) FROM private.planning_period_activity(p_space_id,p_period_key) a JOIN public.allocation_month_roots r ON r.snapshot_id=sid AND r.category_id=a.root_id WHERE a.currency=p_currency AND r.group_id=g.group_id),0),0)),0)
  INTO everyday FROM public.allocation_month_groups g WHERE g.snapshot_id=sid AND g.purpose='spending';
  -- Include elapsed selected-period bills; an absent occurrence is not a settled bill.
  missing:=private.planning_materialization_gap(p_space_id,p_currency,(context->>'start')::date,horizon_end);
  IF missing=0 THEN backlog:=private.planning_unpaid_backlog_count(p_space_id,p_currency,as_of,horizon_end); END IF;
  IF missing>0 OR backlog>500 OR NOT EXISTS(SELECT 1 FROM public.period_plan_loan_sets WHERE snapshot_id=sid) THEN state:='incomplete';
  ELSE
   state:='ready';
   SELECT coalesce(sum(b.commitment_minor),0),coalesce(sum(b.unpaid_bills_minor),0) INTO expenses,fixed
    FROM private.daily_expense_buckets(p_space_id,p_currency,p_period_key,as_of,period_end,horizon_end) b;
   SELECT coalesce(sum(c.debt_commitment_minor),0),coalesce(sum(c.goal_topups_minor),0),
    coalesce(sum(greatest(c.group_target_minor-c.saved_goal_targets_minor-c.original_debt_commitment_minor,0)) FILTER(WHERE c.group_target_minor IS NOT NULL),0)
   INTO debt,topups,headroom FROM private.daily_cash_commitments(p_space_id,p_currency,p_period_key,as_of) c;
   fixed:=fixed+debt;
   available:=cash-claims-expenses-debt-topups-headroom;
   extra:=greatest(available,0); shortfall:=greatest(-available,0);
  END IF;
 END IF;
 RETURN jsonb_build_object('snapshotId',sid::text,'periodKey',p_period_key,'currency',p_currency,'asOf',as_of,'state',state,
  'unmaterializedCount',CASE WHEN missing>0 THEN missing WHEN backlog>500 THEN backlog ELSE 0 END,
  'actualCashMinor',cash::text,'everydayBudgetRemainingMinor',everyday::text,'unpaidFixedCommitmentsMinor',fixed::text,
  'goalClaimsMinor',claims::text,'extraUnassignedCashMinor',extra::text,'fundingShortfallMinor',shortfall::text,
  'unmappedSpentMinor',unmapped::text,'uncategorizedSpentMinor',uncategorized::text,'hasPlan',sid IS NOT NULL);
END; $$;
REVOKE ALL ON FUNCTION public.daily_control_summary(uuid,date,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.daily_control_summary(uuid,date,public.currency_code) TO authenticated;

-- Bounded, read-only obligation view. Settlement is evaluated at the selected
-- period's as-of; these rows are display data, never financial write authority.
CREATE FUNCTION public.daily_control_obligations(p_space_id uuid,p_period_key date,p_currency public.currency_code,p_limit integer DEFAULT 6) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE context jsonb; as_of date; period_end date; items jsonb;
BEGIN
 IF p_space_id IS NULL OR NOT private.is_active_member(p_space_id) THEN
  RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized';
 END IF;
 IF p_period_key IS NULL OR NOT isfinite(p_period_key) OR p_period_key<>date_trunc('month',p_period_key)::date
  OR p_currency IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>20 THEN
  RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input';
 END IF;
 context:=private.space_period_context(p_space_id,p_period_key);
 as_of:=(context->>'asOf')::date; period_end:=(context->>'endExclusive')::date;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'nameEn',q.name_en,'nameAr',q.name_ar,
   'dueDate',q.due_date,'remainingMinor',q.remaining_minor::text,'status',CASE WHEN q.due_date<as_of THEN 'overdue' ELSE 'upcoming' END)
   ORDER BY q.due_date,q.id),'[]'::jsonb) INTO items FROM (
  SELECT so.id,coalesce(sr.name_en,sr.name_ar) name_en,sr.name_ar,so.due_date,greatest(so.expected_minor-stl.settled_minor,0) remaining_minor
  FROM public.scheduled_occurrences so
  JOIN public.schedules s ON s.id=so.schedule_id AND s.kind IN ('expense','debt_payment')
  JOIN public.schedule_revisions sr ON sr.id=so.source_revision_id
  CROSS JOIN LATERAL private.schedule_occurrence_settlement(so.id,as_of) stl
  WHERE so.space_id=p_space_id AND so.currency=p_currency AND so.due_date<period_end
   AND NOT stl.skipped AND so.expected_minor>stl.settled_minor
  ORDER BY so.due_date,so.id LIMIT p_limit+1
 ) q;
 RETURN jsonb_build_object('periodKey',p_period_key,'currency',p_currency,'asOf',as_of,
  'hasMore',jsonb_array_length(items)>p_limit,'rows',CASE WHEN jsonb_array_length(items)>p_limit THEN items-p_limit ELSE items END);
END; $$;
REVOKE ALL ON FUNCTION public.daily_control_obligations(uuid,date,public.currency_code,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.daily_control_obligations(uuid,date,public.currency_code,integer) TO authenticated;
