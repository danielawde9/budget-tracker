-- Effective-dated relationship corrections preserve the financial journal.
-- Nullable annotations preserve old rows; new relinks cannot rewrite earlier settlement/coverage.
ALTER TABLE public.occurrence_events ADD COLUMN settlement_effective_date date;
ALTER TABLE public.goal_purchase_links ADD COLUMN coverage_effective_date date;
ALTER TABLE public.goal_purchase_links ADD CONSTRAINT goal_purchase_links_id_space_id_key UNIQUE (id, space_id);
CREATE TABLE public.scheduled_payment_unlinks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES public.spaces(id),
  occurrence_id uuid NOT NULL,
  settlement_event_id bigint NOT NULL,
  effective_date date NOT NULL,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, request_id), UNIQUE(settlement_event_id),
  FOREIGN KEY(settlement_event_id, occurrence_id, space_id) REFERENCES public.occurrence_events(id, occurrence_id, space_id)
);
CREATE INDEX scheduled_payment_unlinks_occurrence_head_idx ON public.scheduled_payment_unlinks(occurrence_id,id DESC);
CREATE TABLE public.scheduled_payment_goal_links (
  space_id uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  settlement_event_id bigint NOT NULL,
  goal_purchase_link_id uuid NOT NULL,
  PRIMARY KEY(settlement_event_id, goal_purchase_link_id), UNIQUE(goal_purchase_link_id),
  FOREIGN KEY(settlement_event_id, occurrence_id, space_id) REFERENCES public.occurrence_events(id, occurrence_id, space_id),
  FOREIGN KEY(goal_purchase_link_id, space_id) REFERENCES public.goal_purchase_links(id, space_id)
);
CREATE TABLE public.goal_purchase_unlinks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id uuid NOT NULL,
  goal_purchase_link_id uuid NOT NULL,
  effective_date date NOT NULL,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, request_id), UNIQUE(goal_purchase_link_id),
  FOREIGN KEY(goal_purchase_link_id, space_id) REFERENCES public.goal_purchase_links(id, space_id)
);
CREATE FUNCTION private.active_goal_purchase_links(p_space_id uuid, p_as_of date)
RETURNS SETOF public.goal_purchase_links LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT link.* FROM public.goal_purchase_links link
  JOIN public.financial_events event ON event.id=link.expense_event_id AND event.space_id=link.space_id
  WHERE link.space_id=p_space_id AND coalesce(link.coverage_effective_date,event.effective_date)<=p_as_of
    AND NOT EXISTS(SELECT 1 FROM public.financial_events rev WHERE rev.reversal_of=event.id AND rev.effective_date<=p_as_of)
    AND NOT EXISTS(SELECT 1 FROM public.goal_purchase_unlinks unlink WHERE unlink.goal_purchase_link_id=link.id AND unlink.effective_date<=p_as_of);
$$;
CREATE FUNCTION private.goal_purchase_releases(p_space_id uuid)
RETURNS TABLE(link_id uuid, effective_date date) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT link.id, least(unlink.effective_date,rev.effective_date)
  FROM public.goal_purchase_links link
  LEFT JOIN public.goal_purchase_unlinks unlink ON unlink.goal_purchase_link_id=link.id
  LEFT JOIN public.financial_events rev ON rev.reversal_of=link.expense_event_id
  WHERE link.space_id=p_space_id AND (unlink.id IS NOT NULL OR rev.id IS NOT NULL);
$$;
CREATE FUNCTION private.occurrence_settlement_head(p_occurrence_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
  SELECT encode(extensions.digest(jsonb_build_array(
    (SELECT max(id) FROM public.occurrence_events WHERE occurrence_id=p_occurrence_id),
    (SELECT max(id) FROM public.scheduled_payment_unlinks WHERE occurrence_id=p_occurrence_id)
  )::text,'sha256'),'hex');
$$;


CREATE OR REPLACE FUNCTION private.schedule_occurrence_settlement(p_occurrence_id uuid,p_as_of date)
RETURNS TABLE(settled_minor numeric,skipped boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce((SELECT sum(oe.link_amount_minor) FROM public.occurrence_events oe
    JOIN public.financial_events fe ON fe.id=oe.linked_event_id
    WHERE oe.occurrence_id=p_occurrence_id AND oe.action IN ('link','confirm') AND coalesce(oe.settlement_effective_date,fe.effective_date)<=p_as_of
      AND NOT EXISTS(SELECT 1 FROM public.financial_events rev WHERE rev.reversal_of=fe.id AND rev.effective_date<=p_as_of)
      AND NOT EXISTS(SELECT 1 FROM public.scheduled_payment_unlinks u WHERE u.settlement_event_id=oe.id AND u.effective_date<=p_as_of)),0),
    coalesce((SELECT action='skip' FROM public.occurrence_events WHERE occurrence_id=p_occurrence_id ORDER BY id DESC LIMIT 1),false);
$$;
CREATE OR REPLACE FUNCTION private.goal_financing_state(p_goal_id uuid,p_as_of date)
RETURNS TABLE(earmarked_minor numeric,fulfilled_minor numeric,head text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
  WITH totals AS (
    SELECT coalesce((SELECT sum(el.amount_minor) FROM public.goal_earmark_lines el
      JOIN public.goal_earmark_events ge ON ge.id=el.event_id WHERE el.goal_id=p_goal_id AND ge.effective_date<=p_as_of),0) AS reserved,
      coalesce((SELECT sum(link.amount_minor) FROM public.goals g CROSS JOIN LATERAL private.active_goal_purchase_links(g.space_id,p_as_of) link
        WHERE g.id=p_goal_id AND link.goal_id=g.id),0) AS purchased
  ) SELECT reserved-purchased,purchased,encode(extensions.digest(jsonb_build_array(
    (SELECT max(id) FROM public.goal_revisions WHERE goal_id=p_goal_id),
    (SELECT max(event_id) FROM public.goal_earmark_lines WHERE goal_id=p_goal_id),
    (SELECT jsonb_build_array(created_at,id) FROM public.goal_purchase_links WHERE goal_id=p_goal_id ORDER BY created_at DESC,id DESC LIMIT 1),
    (SELECT max(u.id) FROM public.goal_purchase_unlinks u JOIN public.goal_purchase_links link ON link.id=u.goal_purchase_link_id WHERE link.goal_id=p_goal_id),
    (SELECT count(*) FROM public.goal_purchase_links link JOIN public.financial_events rev ON rev.reversal_of=link.expense_event_id WHERE link.goal_id=p_goal_id AND rev.effective_date<=p_as_of),
    (reserved-purchased)::text,purchased::text
  )::text,'sha256'),'hex') FROM totals;
$$;
CREATE OR REPLACE FUNCTION private.goal_space_earmarked_total(p_space_id uuid,p_currency public.currency_code,p_as_of date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce(sum(state.earmarked_minor),0) FROM public.goals g
  CROSS JOIN LATERAL private.goal_financing_state(g.id,p_as_of) state
  WHERE g.space_id=p_space_id AND g.currency=p_currency;
$$;


CREATE OR REPLACE FUNCTION public.link_goal_purchase(p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_expense public.financial_events%rowtype;
  v_link_effective_date date;
  v_currency_count integer;
  v_currency public.currency_code;
  v_expense_total numeric;
  v_existing_links numeric;
  v_entry jsonb;
  v_goal_ids uuid[] := '{}';
  v_new_total numeric := 0;
  v_goal_id uuid;
  v_goal public.goals%rowtype;
  v_head text;
  v_would_go_negative boolean;
  v_link_ids uuid[] := '{}';
  v_link_id uuid;
  v_canonical_lines jsonb;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_expense_event_id is null or p_lines is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','amountMinor','expectedHead']) is not true
      or (v_entry - array['goalId','amountMinor','expectedHead']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedHead') is distinct from 'string'
      or (v_entry->>'expectedHead') !~ '^[0-9a-f]{64}$'
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    if (v_entry->>'goalId')::uuid = any(v_goal_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_goal_ids := array_append(v_goal_ids, (v_entry->>'goalId')::uuid);
    v_new_total := v_new_total + private.planning_minor(v_entry->>'amountMinor', true);
  end loop;
  v_canonical_lines := (select coalesce(jsonb_agg(l order by l->>'goalId'), '[]'::jsonb) from jsonb_array_elements(p_lines) l);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('link_goal_purchase', v_actor, jsonb_build_object(
    'expenseEventId', p_expense_event_id, 'lines', v_canonical_lines
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'link_goal_purchase', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_expense from public.financial_events where id = p_expense_event_id and space_id = p_space_id for update;
  if not found or v_expense.kind <> 'expense' then
    raise exception using errcode='P0001', message='the referenced event must be an unreversed expense in this space';
  end if;
  if exists(select 1 from public.financial_events where reversal_of = p_expense_event_id) then
    raise exception using errcode='P0001', message='the referenced event must be an unreversed expense in this space';
  end if;
  if v_expense.effective_date > public.space_today(p_space_id) then
    raise exception using errcode='P0001', message='a purchase cannot be linked before its effective date has occurred';
  end if;
  if exists(select 1 from public.loan_postings where event_id = p_expense_event_id) then
    raise exception using errcode='P0001', message='a loan-linked event cannot be linked to a goal';
  end if;

  select count(distinct w.currency) into v_currency_count
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_expense_event_id;
  if v_currency_count <> 1 then
    raise exception using errcode='P0001', message='the referenced expense must be single-currency';
  end if;
  select w.currency into v_currency
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_expense_event_id limit 1;
  select coalesce(-sum(amount_minor), 0) into v_expense_total from public.wallet_movements where event_id = p_expense_event_id;

  select greatest(v_expense.effective_date,coalesce(max(unlink.effective_date),v_expense.effective_date)) into v_link_effective_date
  from public.goal_purchase_unlinks unlink join public.goal_purchase_links prior on prior.id=unlink.goal_purchase_link_id
  where prior.expense_event_id=p_expense_event_id;
  select coalesce(sum(amount_minor), 0) into v_existing_links from private.active_goal_purchase_links(p_space_id, public.space_today(p_space_id)) where expense_event_id = p_expense_event_id;
  if v_existing_links + v_new_total > v_expense_total then
    raise exception using errcode='P0001', message='total linked amounts cannot exceed the expense''s own total';
  end if;

  foreach v_goal_id in array (select array_agg(x order by x) from unnest(v_goal_ids) x) loop
    perform 1 from public.goals where id = v_goal_id and space_id = p_space_id for update;
    if not found then
      raise exception using errcode='P0001', message='every linked goal must belong to the requested space';
    end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_lines) loop
    v_goal_id := (v_entry->>'goalId')::uuid;
    select * into v_goal from public.goals where id = v_goal_id and space_id = p_space_id;
    if v_goal.currency is distinct from v_currency then
      raise exception using errcode='P0001', message='a linked goal must share the expense''s currency';
    end if;

    select head into v_head from private.goal_financing_state(v_goal_id, public.space_today(p_space_id));
    if v_head is distinct from (v_entry->>'expectedHead') then
      raise exception using errcode='40001', message='planning_stale_revision';
    end if;

    -- The link reduces the goal's earmark as of the EXPENSE's own date, not
    -- today; verify the running balance never goes negative at any
    -- checkpoint from that date through today, not just today's snapshot.
    select bool_or(running_sum < 0) into v_would_go_negative
    from (
      select sum(sum(delta)) over (order by event_date rows between unbounded preceding and current row) as running_sum, event_date
      from (
        select ge.effective_date as event_date, el.event_id::text as sort_key, el.amount_minor as delta
        from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = v_goal_id
        union all
        select coalesce(gpl.coverage_effective_date,fe.effective_date), 'link:' || gpl.id::text, -gpl.amount_minor
        from public.goal_purchase_links gpl join public.financial_events fe on fe.id = gpl.expense_event_id
        where gpl.goal_id = v_goal_id
        union all
        select release.effective_date, 'linkrelease:' || gpl.id::text, gpl.amount_minor
        from public.goal_purchase_links gpl
        join private.goal_purchase_releases(p_space_id) release on release.link_id = gpl.id
        where gpl.goal_id = v_goal_id
        union all
        select v_link_effective_date, 'newlink', -private.planning_minor(v_entry->>'amountMinor', true)
      ) events group by event_date
    ) timeline
    where event_date >= v_link_effective_date and event_date <= public.space_today(p_space_id);
    if v_would_go_negative then
      raise exception using errcode='P0001', message='linking this purchase would make an earlier or current goal balance negative';
    end if;

    v_link_id := extensions.gen_random_uuid();
    insert into public.goal_purchase_links (id, goal_id, space_id, currency, expense_event_id, amount_minor, request_id, actor_id, coverage_effective_date)
      values (v_link_id, v_goal_id, p_space_id, v_currency, p_expense_event_id, private.planning_minor(v_entry->>'amountMinor', true), p_request_id, v_actor, v_link_effective_date);
    v_link_ids := array_append(v_link_ids, v_link_id);
  end loop;

  v_result := jsonb_build_object('linkIds', to_jsonb(array(select id::text from unnest(v_link_ids) as id)));
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'link_goal_purchase', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION private.check_occurrence_event(p_event_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_event public.occurrence_events%rowtype;
  v_head_id bigint;
  v_prior_action text;
  v_settled numeric;
  v_skipped boolean;
  v_eligible numeric;
  v_total_allocated numeric;
begin
  select * into v_event from public.occurrence_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='occurrence_event_missing';
  end if;

  if v_event.expected_event_id is not null then
    if v_event.expected_event_id >= v_event.id then
      raise exception using errcode='23514', message='occurrence_event_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.occurrence_events
      where occurrence_id = v_event.occurrence_id and id < v_event.id;
    if v_head_id is distinct from v_event.expected_event_id then
      raise exception using errcode='23514', message='occurrence_event_predecessor_not_head';
    end if;
  end if;

  select action into v_prior_action from public.occurrence_events
    where occurrence_id = v_event.occurrence_id and id < v_event.id order by id desc limit 1;

  if v_event.action = 'skip' then
    if v_prior_action = 'skip' then
      raise exception using errcode='23514', message='occurrence_already_skipped';
    end if;
    select settled_minor, skipped into v_settled, v_skipped
      from private.schedule_occurrence_settlement(v_event.occurrence_id, private.space_today(v_event.space_id));
    if v_settled <> 0 then
      raise exception using errcode='23514', message='occurrence_settled_amount_nonzero_for_skip';
    end if;
  elsif v_event.action = 'reopen' then
    if v_prior_action is distinct from 'skip' then
      raise exception using errcode='23514', message='occurrence_not_skipped_for_reopen';
    end if;
  elsif v_event.action in ('link','confirm') then
    if v_prior_action = 'skip' then
      raise exception using errcode='23514', message='occurrence_skipped_rejects_settlement';
    end if;

    -- Recompute the same allocation-sum cap link_scheduled_payment/
    -- confirm_scheduled_occurrence already enforce at command time, purely
    -- from the linked financial event's own kind and postings -- defense in
    -- depth against a privileged direct insert bypassing the command,
    -- mirroring the skip-invariant recheck above.
    if v_event.linked_event_id is not null then
      select case fe.kind
        when 'expense' then coalesce((select -sum(m.amount_minor) from public.wallet_movements m where m.event_id = fe.id), 0)
        when 'income' then coalesce((select sum(m.amount_minor) from public.wallet_movements m where m.event_id = fe.id), 0)
        when 'loan_repay_borrowing' then coalesce((select abs(lp.principal_delta_minor) from public.loan_postings lp where lp.event_id = fe.id), 0)
        when 'loan_receive_repayment' then coalesce((select abs(lp.principal_delta_minor) from public.loan_postings lp where lp.event_id = fe.id), 0)
        else 0
      end into v_eligible
      from public.financial_events fe where fe.id = v_event.linked_event_id;

      select coalesce(sum(oe.link_amount_minor), 0) into v_total_allocated
        from public.occurrence_events oe
        where oe.linked_event_id = v_event.linked_event_id and oe.action in ('link','confirm')
          and not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id);

      if v_total_allocated > coalesce(v_eligible, 0) then
        raise exception using errcode='23514', message='occurrence_allocation_exceeds_eligible_amount';
      end if;
    end if;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION private.confirm_scheduled_occurrence_body(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_occurrence public.scheduled_occurrences%rowtype;
  v_schedule_kind text;
  v_current_event_id bigint;
  v_settled numeric; v_skipped boolean;
  v_today date := public.space_today(p_space_id);
  v_amount_minor bigint;
  v_wallet_currency public.currency_code;
  v_category_kind public.category_kind;
  v_goal public.goals%rowtype;
  v_goal_state text;
  v_movements jsonb;
  v_financial_event_id uuid;
  v_occurrence_event_id bigint;
  v_earmarked numeric; v_fulfilled numeric; v_head text;
  v_goal_alloc numeric;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_occurrence_id is null
    or p_actual_amount_minor is null or p_effective_date is null or p_wallet_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_effective_date > v_today then
    raise exception using errcode='P0001', message='a payment cannot be confirmed before its effective date has occurred';
  end if;
  v_amount_minor := private.planning_minor(p_actual_amount_minor, true);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('confirm_scheduled_occurrence', v_actor, jsonb_build_object(
    'occurrenceId', p_occurrence_id, 'expectedEventId', p_expected_event_id,
    'actualAmountMinor', v_amount_minor::text, 'effectiveDate', p_effective_date, 'walletId', p_wallet_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'confirm_scheduled_occurrence', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_occurrence from public.scheduled_occurrences where id = p_occurrence_id and space_id = p_space_id for update;
  if not found then
    raise exception using errcode='P0001', message='the occurrence does not belong to the requested space';
  end if;
  select kind into v_schedule_kind from public.schedules where id = v_occurrence.schedule_id;

  select max(id) into v_current_event_id from public.occurrence_events where occurrence_id = p_occurrence_id;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select settled_minor, skipped into v_settled, v_skipped
    from private.schedule_occurrence_settlement(p_occurrence_id, v_today);
  if v_skipped then
    raise exception using errcode='P0001', message='a skipped occurrence cannot be confirmed';
  end if;

  select currency into v_wallet_currency from public.wallets
    where id = p_wallet_id and space_id = p_space_id and archived_at is null;
  if not found or v_wallet_currency is distinct from v_occurrence.currency then
    raise exception using errcode='P0001', message='the payment wallet must be active and share the occurrence currency';
  end if;

  if v_occurrence.category_id is not null then
    select kind into v_category_kind from public.categories
      where id = v_occurrence.category_id and space_id = p_space_id and archived_at is null;
    if not found or v_category_kind::text is distinct from v_schedule_kind then
      raise exception using errcode='P0001', message='the referenced category is no longer active or eligible';
    end if;
  end if;

  if v_schedule_kind = 'debt_payment' then
    if v_occurrence.loan_id is null then
      raise exception using errcode='P0001', message='a debt payment occurrence requires a loan reference';
    end if;
    perform 1 from public.loans
      where id = v_occurrence.loan_id and space_id = p_space_id and currency = v_occurrence.currency and direction = 'i_owe_them';
    if not found then
      raise exception using errcode='P0001', message='the referenced loan is no longer eligible for this payment';
    end if;
    select event_id into v_financial_event_id from public.record_loan_repayment(
      p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:post'),
      v_occurrence.loan_id, p_wallet_id, v_amount_minor::text, p_effective_date
    );
  else
    v_movements := jsonb_build_array(jsonb_build_object(
      'walletId', p_wallet_id::text,
      'amountMinor', (case when v_schedule_kind = 'income' then v_amount_minor else -v_amount_minor end)::text
    ));
    if v_occurrence.category_id is not null then
      select id into v_financial_event_id from public.record_categorized_financial_event(
        p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:post'),
        v_schedule_kind::public.financial_event_kind, p_effective_date, v_movements, v_occurrence.category_id
      );
    else
      select id into v_financial_event_id from public.record_financial_event(
        p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:post'),
        v_schedule_kind::public.financial_event_kind, p_effective_date, v_movements
      );
    end if;
  end if;

  insert into public.occurrence_events (
    occurrence_id, space_id, expected_event_id, action, linked_event_id, link_amount_minor, request_id, actor_id, settlement_effective_date
  ) values (
    p_occurrence_id, p_space_id, p_expected_event_id, 'confirm', v_financial_event_id, v_amount_minor, p_request_id, v_actor, p_effective_date
  ) returning id into v_occurrence_event_id;

  if v_schedule_kind = 'expense' and v_occurrence.funding_goal_id is not null then
    select * into v_goal from public.goals where id = v_occurrence.funding_goal_id and space_id = p_space_id;
    if found and v_goal.currency = v_occurrence.currency then
      select state into v_goal_state from public.goal_revisions where goal_id = v_goal.id order by id desc limit 1;
      if v_goal_state = 'active' then
        select earmarked_minor, fulfilled_minor, head into v_earmarked, v_fulfilled, v_head
          from private.goal_financing_state(v_goal.id, v_today);
        v_goal_alloc := least(greatest(v_earmarked,0), v_amount_minor);
        if v_goal_alloc > 0 then
          perform public.link_goal_purchase(
            p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:goal'),
            v_financial_event_id, jsonb_build_array(jsonb_build_object(
              'goalId', v_goal.id::text, 'amountMinor', v_goal_alloc::text, 'expectedHead', v_head
            ))
          );
        end if;
      end if;
    end if;
  end if;

  insert into public.scheduled_payment_goal_links(space_id,occurrence_id,settlement_event_id,goal_purchase_link_id)
    select p_space_id,p_occurrence_id,v_occurrence_event_id,link.id
    from public.goal_purchase_links link
    join public.planning_command_receipts receipt on receipt.space_id=link.space_id and receipt.request_id=link.request_id
    where link.space_id=p_space_id and link.request_id=private.planning_child_request(p_request_id,'confirm_scheduled_occurrence:goal')
      and receipt.command='link_goal_purchase' and receipt.result->'linkIds' ? link.id::text;
  v_result := jsonb_build_object(
    'goalPurchaseLinkIds', coalesce((select jsonb_agg(goal_purchase_link_id::text order by goal_purchase_link_id) from public.scheduled_payment_goal_links where settlement_event_id=v_occurrence_event_id),'[]'::jsonb),
    'occurrenceId', p_occurrence_id::text, 'occurrenceEventId', v_occurrence_event_id::text,
    'financialEventId', v_financial_event_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'confirm_scheduled_occurrence', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION private.link_scheduled_payment_body(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_occurrence public.scheduled_occurrences%rowtype;
  v_schedule_kind text;
  v_current_event_id bigint;
  v_settled numeric; v_skipped boolean;
  v_today date := public.space_today(p_space_id);
  v_amount_minor bigint;
  v_event public.financial_events%rowtype;
  v_currency_count integer;
  v_event_currency public.currency_code;
  v_eligible numeric;
  v_loan_id uuid;
  v_principal_delta bigint;
  v_existing_allocations numeric;
  v_new_total numeric;
  v_occurrence_event_id bigint;
  v_goal public.goals%rowtype;
  v_goal_state text;
  v_earmarked numeric; v_fulfilled numeric; v_head text;
  v_existing_goal_links numeric;
  v_remaining_fundable numeric;
  v_goal_alloc numeric;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_occurrence_id is null or p_event_id is null
    or p_amount_minor is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_amount_minor := private.planning_minor(p_amount_minor, true);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('link_scheduled_payment', v_actor, jsonb_build_object(
    'occurrenceId', p_occurrence_id, 'eventId', p_event_id, 'amountMinor', v_amount_minor::text,
    'expectedEventId', p_expected_event_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'link_scheduled_payment', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_occurrence from public.scheduled_occurrences where id = p_occurrence_id and space_id = p_space_id for update;
  if not found then
    raise exception using errcode='P0001', message='the occurrence does not belong to the requested space';
  end if;
  select kind into v_schedule_kind from public.schedules where id = v_occurrence.schedule_id;

  select max(id) into v_current_event_id from public.occurrence_events where occurrence_id = p_occurrence_id;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select settled_minor, skipped into v_settled, v_skipped
    from private.schedule_occurrence_settlement(p_occurrence_id, v_today);
  if v_skipped then
    raise exception using errcode='P0001', message='a skipped occurrence cannot receive a payment link';
  end if;

  select * into v_event from public.financial_events where id = p_event_id and space_id = p_space_id for update;
  if not found or v_event.kind = 'reversal' then
    raise exception using errcode='P0001', message='the referenced event cannot be linked';
  end if;
  if exists(select 1 from public.financial_events where reversal_of = p_event_id) then
    raise exception using errcode='P0001', message='the referenced event already has a reversal';
  end if;
  if v_event.effective_date > v_today then
    raise exception using errcode='P0001', message='a payment cannot be linked before its effective date has occurred';
  end if;

  select count(distinct w.currency) into v_currency_count
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_event_id;
  select w.currency into v_event_currency
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_event_id limit 1;
  if v_currency_count <> 1 or v_event_currency is distinct from v_occurrence.currency then
    raise exception using errcode='P0001', message='the referenced event must be single-currency and share the occurrence currency';
  end if;

  if v_schedule_kind = 'debt_payment' then
    select posting.loan_id, posting.principal_delta_minor into v_loan_id, v_principal_delta
      from public.loan_postings posting where posting.event_id = p_event_id;
    if v_loan_id is distinct from v_occurrence.loan_id or v_event.kind not in ('loan_receive_repayment','loan_repay_borrowing') then
      raise exception using errcode='P0001', message='the referenced event must be a repayment on the occurrence''s own loan';
    end if;
    v_eligible := abs(v_principal_delta);
  elsif v_schedule_kind = 'expense' then
    if v_event.kind <> 'expense' then
      raise exception using errcode='P0001', message='the referenced event must be an expense';
    end if;
    select coalesce(-sum(amount_minor), 0) into v_eligible from public.wallet_movements where event_id = p_event_id;
  else
    if v_event.kind <> 'income' then
      raise exception using errcode='P0001', message='the referenced event must be income';
    end if;
    select coalesce(sum(amount_minor), 0) into v_eligible from public.wallet_movements where event_id = p_event_id;
  end if;

  select coalesce(sum(link_amount_minor), 0) into v_existing_allocations
    from public.occurrence_events oe where linked_event_id = p_event_id and action in ('link','confirm')
      and not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id);
  v_new_total := v_existing_allocations + v_amount_minor;
  if v_new_total > v_eligible then
    raise exception using errcode='P0001', message='the linked amount exceeds the referenced event''s remaining eligible amount';
  end if;

  insert into public.occurrence_events (
    occurrence_id, space_id, expected_event_id, action, linked_event_id, link_amount_minor, request_id, actor_id, settlement_effective_date
  ) values (
    p_occurrence_id, p_space_id, p_expected_event_id, 'link', p_event_id, v_amount_minor, p_request_id, v_actor, greatest(v_event.effective_date,coalesce((select max(u.effective_date) from public.scheduled_payment_unlinks u join public.occurrence_events prior on prior.id=u.settlement_event_id where prior.linked_event_id=p_event_id),v_event.effective_date))
  ) returning id into v_occurrence_event_id;

  if v_schedule_kind = 'expense' and v_occurrence.funding_goal_id is not null then
    select * into v_goal from public.goals where id = v_occurrence.funding_goal_id and space_id = p_space_id;
    if found and v_goal.currency = v_occurrence.currency then
      select state into v_goal_state from public.goal_revisions where goal_id = v_goal.id order by id desc limit 1;
      if v_goal_state = 'active' then
        select earmarked_minor, fulfilled_minor, head into v_earmarked, v_fulfilled, v_head
          from private.goal_financing_state(v_goal.id, v_today);
        select coalesce(sum(amount_minor), 0) into v_existing_goal_links
          from private.active_goal_purchase_links(p_space_id,v_today) where expense_event_id = p_event_id;
        v_remaining_fundable := greatest(v_eligible - v_existing_goal_links, 0);
        v_goal_alloc := least(greatest(v_earmarked,0), v_amount_minor, v_remaining_fundable);
        if v_goal_alloc > 0 then
          perform public.link_goal_purchase(
            p_space_id, private.planning_child_request(p_request_id, 'link_scheduled_payment:goal'),
            p_event_id, jsonb_build_array(jsonb_build_object(
              'goalId', v_goal.id::text, 'amountMinor', v_goal_alloc::text, 'expectedHead', v_head
            ))
          );
        end if;
      end if;
    end if;
  end if;

  insert into public.scheduled_payment_goal_links(space_id,occurrence_id,settlement_event_id,goal_purchase_link_id)
    select p_space_id,p_occurrence_id,v_occurrence_event_id,link.id
    from public.goal_purchase_links link
    join public.planning_command_receipts receipt on receipt.space_id=link.space_id and receipt.request_id=link.request_id
    where link.space_id=p_space_id and link.request_id=private.planning_child_request(p_request_id,'link_scheduled_payment:goal')
      and receipt.command='link_goal_purchase' and receipt.result->'linkIds' ? link.id::text;
  v_result := jsonb_build_object(
    'goalPurchaseLinkIds', coalesce((select jsonb_agg(goal_purchase_link_id::text order by goal_purchase_link_id) from public.scheduled_payment_goal_links where settlement_event_id=v_occurrence_event_id),'[]'::jsonb),
    'occurrenceId', p_occurrence_id::text, 'occurrenceEventId', v_occurrence_event_id::text,
    'financialEventId', p_event_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'link_scheduled_payment', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION private.set_occurrence_state_body(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_occurrence public.scheduled_occurrences%rowtype;
  v_current_event_id bigint;
  v_settled numeric; v_skipped boolean;
  v_today date := public.space_today(p_space_id);
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_occurrence_id is null or p_action is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_action not in ('skip','reopen') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('set_occurrence_state', v_actor, jsonb_build_object(
    'occurrenceId', p_occurrence_id, 'expectedEventId', p_expected_event_id, 'action', p_action
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'set_occurrence_state', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_occurrence from public.scheduled_occurrences where id = p_occurrence_id and space_id = p_space_id for update;
  if not found then
    raise exception using errcode='P0001', message='the occurrence does not belong to the requested space';
  end if;

  select max(id) into v_current_event_id from public.occurrence_events where occurrence_id = p_occurrence_id;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select settled_minor, skipped into v_settled, v_skipped
    from private.schedule_occurrence_settlement(p_occurrence_id, v_today);

  if p_action = 'skip' then
    if v_skipped then
      raise exception using errcode='P0001', message='the occurrence is already skipped';
    end if;
    if v_settled <> 0 then
      raise exception using errcode='P0001', message='a partially or fully paid occurrence cannot be skipped';
    end if;
  else
    if not v_skipped then
      raise exception using errcode='P0001', message='only a skipped occurrence can be reopened';
    end if;
  end if;

  insert into public.occurrence_events (occurrence_id, space_id, expected_event_id, action, request_id, actor_id)
    values (p_occurrence_id, p_space_id, p_expected_event_id, p_action, p_request_id, v_actor)
    returning id into v_event_id;

  v_result := jsonb_build_object('occurrenceId', p_occurrence_id::text, 'eventId', v_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'set_occurrence_state', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION public.confirm_scheduled_occurrence(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
begin
  perform private.lock_planning_actor(p_space_id);
  if exists(select 1 from public.scheduled_payment_unlinks where occurrence_id=p_occurrence_id) then
    raise exception using errcode='P0001',message='planning_settlement_head_required';
  end if;
  return private.confirm_scheduled_occurrence_body(p_space_id,p_request_id,p_occurrence_id,p_expected_event_id,p_actual_amount_minor,p_effective_date,p_wallet_id);
end; $$;


CREATE OR REPLACE FUNCTION public.link_scheduled_payment(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
begin
  perform private.lock_planning_actor(p_space_id);
  if exists(select 1 from public.scheduled_payment_unlinks where occurrence_id=p_occurrence_id) then
    raise exception using errcode='P0001',message='planning_settlement_head_required';
  end if;
  return private.link_scheduled_payment_body(p_space_id,p_request_id,p_occurrence_id,p_event_id,p_amount_minor,p_expected_event_id);
end; $$;


CREATE OR REPLACE FUNCTION public.set_occurrence_state(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
begin
  perform private.lock_planning_actor(p_space_id);
  if exists(select 1 from public.scheduled_payment_unlinks where occurrence_id=p_occurrence_id) then
    raise exception using errcode='P0001',message='planning_settlement_head_required';
  end if;
  return private.set_occurrence_state_body(p_space_id,p_request_id,p_occurrence_id,p_expected_event_id,p_action);
end; $$;


CREATE FUNCTION public.confirm_scheduled_occurrence_v2(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_head text, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
declare v_actor uuid; v_fingerprint bytea; v_result jsonb; v_numeric_head bigint; v_child uuid;
begin
  if p_request_id is null or p_occurrence_id is null or p_expected_head is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  v_actor:=private.lock_planning_actor(p_space_id);
  v_fingerprint:=private.planning_fingerprint('confirm_scheduled_occurrence_v2',v_actor,jsonb_build_object('occurrenceId',p_occurrence_id,'expectedHead',p_expected_head,'amountMinor',p_actual_amount_minor,'effectiveDate',p_effective_date,'walletId',p_wallet_id));
  v_result:=private.planning_replay(p_space_id,p_request_id,'confirm_scheduled_occurrence_v2',v_actor,v_fingerprint);
  if v_result is not null then return v_result; end if;
  perform 1 from public.scheduled_occurrences where id=p_occurrence_id and space_id=p_space_id for update;
  if not found then raise exception using errcode='P0001',message='the occurrence does not belong to the requested space'; end if;
  if private.occurrence_settlement_head(p_occurrence_id) is distinct from p_expected_head then
    raise exception using errcode='40001',message='planning_stale_revision';
  end if;
  select max(id) into v_numeric_head from public.occurrence_events where occurrence_id=p_occurrence_id;
  v_child:=private.planning_child_request(p_request_id,'confirm_scheduled_occurrence_v2:body');
  v_result:=private.confirm_scheduled_occurrence_body(p_space_id,v_child,p_occurrence_id,v_numeric_head,p_actual_amount_minor,p_effective_date,p_wallet_id);
  v_result:=v_result||jsonb_build_object('settlementHead',private.occurrence_settlement_head(p_occurrence_id));
  insert into public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result)
    values(p_space_id,p_request_id,'confirm_scheduled_occurrence_v2',v_fingerprint,v_actor,v_result);
  return v_result;
end; $$;


CREATE FUNCTION public.link_scheduled_payment_v2(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_head text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
declare v_actor uuid; v_fingerprint bytea; v_result jsonb; v_numeric_head bigint; v_child uuid;
begin
  if p_request_id is null or p_occurrence_id is null or p_expected_head is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  v_actor:=private.lock_planning_actor(p_space_id);
  v_fingerprint:=private.planning_fingerprint('link_scheduled_payment_v2',v_actor,jsonb_build_object('occurrenceId',p_occurrence_id,'expectedHead',p_expected_head,'eventId',p_event_id,'amountMinor',p_amount_minor));
  v_result:=private.planning_replay(p_space_id,p_request_id,'link_scheduled_payment_v2',v_actor,v_fingerprint);
  if v_result is not null then return v_result; end if;
  perform 1 from public.scheduled_occurrences where id=p_occurrence_id and space_id=p_space_id for update;
  if not found then raise exception using errcode='P0001',message='the occurrence does not belong to the requested space'; end if;
  if private.occurrence_settlement_head(p_occurrence_id) is distinct from p_expected_head then
    raise exception using errcode='40001',message='planning_stale_revision';
  end if;
  select max(id) into v_numeric_head from public.occurrence_events where occurrence_id=p_occurrence_id;
  v_child:=private.planning_child_request(p_request_id,'link_scheduled_payment_v2:body');
  v_result:=private.link_scheduled_payment_body(p_space_id,v_child,p_occurrence_id,p_event_id,p_amount_minor,v_numeric_head);
  v_result:=v_result||jsonb_build_object('settlementHead',private.occurrence_settlement_head(p_occurrence_id));
  insert into public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result)
    values(p_space_id,p_request_id,'link_scheduled_payment_v2',v_fingerprint,v_actor,v_result);
  return v_result;
end; $$;


CREATE FUNCTION public.set_occurrence_state_v2(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_head text, p_action text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
declare v_actor uuid; v_fingerprint bytea; v_result jsonb; v_numeric_head bigint; v_child uuid;
begin
  if p_request_id is null or p_occurrence_id is null or p_expected_head is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  v_actor:=private.lock_planning_actor(p_space_id);
  v_fingerprint:=private.planning_fingerprint('set_occurrence_state_v2',v_actor,jsonb_build_object('occurrenceId',p_occurrence_id,'expectedHead',p_expected_head,'action',p_action));
  v_result:=private.planning_replay(p_space_id,p_request_id,'set_occurrence_state_v2',v_actor,v_fingerprint);
  if v_result is not null then return v_result; end if;
  perform 1 from public.scheduled_occurrences where id=p_occurrence_id and space_id=p_space_id for update;
  if not found then raise exception using errcode='P0001',message='the occurrence does not belong to the requested space'; end if;
  if private.occurrence_settlement_head(p_occurrence_id) is distinct from p_expected_head then
    raise exception using errcode='40001',message='planning_stale_revision';
  end if;
  select max(id) into v_numeric_head from public.occurrence_events where occurrence_id=p_occurrence_id;
  v_child:=private.planning_child_request(p_request_id,'set_occurrence_state_v2:body');
  v_result:=private.set_occurrence_state_body(p_space_id,v_child,p_occurrence_id,v_numeric_head,p_action);
  v_result:=v_result||jsonb_build_object('settlementHead',private.occurrence_settlement_head(p_occurrence_id));
  insert into public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result)
    values(p_space_id,p_request_id,'set_occurrence_state_v2',v_fingerprint,v_actor,v_result);
  return v_result;
end; $$;


CREATE OR REPLACE FUNCTION public.scheduled_occurrence_page(p_space_id uuid, p_from_date date, p_to_date date, p_after_due_date date DEFAULT NULL::date, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := private.space_today(p_space_id);
  v_rows jsonb;
  v_has_more boolean;
  v_next_due_date date;
  v_next_id uuid;
begin
  if p_space_id is null or p_from_date is null or p_to_date is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_to_date < p_from_date or (p_to_date - p_from_date) > 90 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if (p_after_due_date is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with page as (
    select so.*, sch.kind as schedule_kind, rev.name_en, rev.name_ar
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = so.space_id
    join public.schedule_revisions rev on rev.id = so.source_revision_id
    where so.space_id = p_space_id and so.due_date between p_from_date and p_to_date
      and (p_after_due_date is null or (so.due_date, so.id) > (p_after_due_date, p_after_id))
    order by so.due_date, so.id
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by due_date, id) as rn from page
  ), settled as (
    select numbered.*, stl.settled_minor, stl.skipped
    from numbered
    cross join lateral private.schedule_occurrence_settlement(numbered.id, v_as_of) stl
    where numbered.rn <= p_limit
  ), funded as (
    select settled.*, coalesce((
      select sum(gpl.amount_minor) from private.active_goal_purchase_links(p_space_id,v_as_of) gpl
      where gpl.goal_id = settled.funding_goal_id
        and gpl.expense_event_id in (
          select oe.linked_event_id from public.occurrence_events oe
          where oe.occurrence_id = settled.id and oe.action in ('link','confirm') and not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id and u.effective_date<=v_as_of)
        )
    ), 0) as goal_funded_minor
    from settled
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', funded.id::text, 'scheduleId', funded.schedule_id::text,
       'sourceRevisionId', funded.source_revision_id::text,
       'settlementHead', private.occurrence_settlement_head(funded.id),
      'currentEventId', (select max(id)::text from public.occurrence_events where occurrence_id = funded.id),
       'linkedEventId', (select oe.linked_event_id::text
         from public.occurrence_events oe
         join public.financial_events fe on fe.id = oe.linked_event_id
         where oe.occurrence_id = funded.id and oe.action in ('link','confirm') and not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id and u.effective_date<=v_as_of)
           and fe.effective_date <= v_as_of
           and not exists (
             select 1 from public.financial_events rev
             where rev.reversal_of = oe.linked_event_id and rev.effective_date <= v_as_of
           )
         order by oe.id desc limit 1),
       'currency', funded.currency, 'kind', funded.schedule_kind,
       'nameEn', funded.name_en, 'nameAr', funded.name_ar, 'dueDate', funded.due_date,
       'expectedMinor', funded.expected_minor::text,
       'settledMinor', funded.settled_minor::text,
       'remainingMinor', greatest(funded.expected_minor - funded.settled_minor, 0)::text,
       'state', case when funded.skipped then 'skipped'
         when funded.settled_minor <= 0 then 'pending'
         when funded.settled_minor < funded.expected_minor then 'partial'
         else 'settled' end,
       'overdue', (funded.due_date < v_as_of and not funded.skipped and (funded.expected_minor - funded.settled_minor) > 0),
       'categoryId', funded.category_id::text, 'loanId', funded.loan_id::text,
       'fundingGoalId', funded.funding_goal_id::text, 'preferredWalletId', funded.preferred_wallet_id::text,
       'fundingShortfallMinor', case when funded.funding_goal_id is null then null
         else greatest(funded.settled_minor - funded.goal_funded_minor, 0)::text end,
       'asOf', v_as_of
     ) order by funded.due_date, funded.id), '[]'::jsonb)
     from funded),
    exists(select 1 from numbered where rn > p_limit),
    (select due_date from numbered where rn = p_limit),
    (select id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_due_date, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('dueDate', v_next_due_date, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.scheduled_overdue_page(p_space_id uuid, p_after_due_date date DEFAULT NULL::date, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := private.space_today(p_space_id);
  v_rows jsonb;
  v_has_more boolean;
  v_next_due_date date;
  v_next_id uuid;
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if (p_after_due_date is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with unpaid as (
    select so.*, sch.kind as schedule_kind, rev.name_en, rev.name_ar, stl.settled_minor, stl.skipped
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = so.space_id
    join public.schedule_revisions rev on rev.id = so.source_revision_id
    cross join lateral private.schedule_occurrence_settlement(so.id, v_as_of) stl
    where so.space_id = p_space_id and so.due_date < v_as_of
      and not stl.skipped and so.expected_minor - stl.settled_minor > 0
      and (p_after_due_date is null or (so.due_date, so.id) > (p_after_due_date, p_after_id))
    order by so.due_date, so.id
    limit p_limit + 1
  ), numbered as (
    select unpaid.*, row_number() over (order by due_date, id) as rn from unpaid
  ), settled as (
    select numbered.* from numbered where numbered.rn <= p_limit
  ), funded as (
    select settled.*, coalesce((
      select sum(gpl.amount_minor) from private.active_goal_purchase_links(p_space_id,v_as_of) gpl
      where gpl.goal_id = settled.funding_goal_id
        and gpl.expense_event_id in (
          select oe.linked_event_id from public.occurrence_events oe
          where oe.occurrence_id = settled.id and oe.action in ('link','confirm') and not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id and u.effective_date<=v_as_of)
        )
    ), 0) as goal_funded_minor
    from settled
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', funded.id::text, 'scheduleId', funded.schedule_id::text,
       'sourceRevisionId', funded.source_revision_id::text,
       'settlementHead', private.occurrence_settlement_head(funded.id),
      'currentEventId', (select max(id)::text from public.occurrence_events where occurrence_id = funded.id),
       'linkedEventId', (select oe.linked_event_id::text
         from public.occurrence_events oe
         join public.financial_events fe on fe.id = oe.linked_event_id
         where oe.occurrence_id = funded.id and oe.action in ('link','confirm') and not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id and u.effective_date<=v_as_of)
           and fe.effective_date <= v_as_of
           and not exists (
             select 1 from public.financial_events rev
             where rev.reversal_of = oe.linked_event_id and rev.effective_date <= v_as_of
           )
         order by oe.id desc limit 1),
       'currency', funded.currency, 'kind', funded.schedule_kind,
       'nameEn', funded.name_en, 'nameAr', funded.name_ar, 'dueDate', funded.due_date,
       'expectedMinor', funded.expected_minor::text,
       'settledMinor', funded.settled_minor::text,
       'remainingMinor', greatest(funded.expected_minor - funded.settled_minor, 0)::text,
       'state', case when funded.skipped then 'skipped'
         when funded.settled_minor <= 0 then 'pending'
         when funded.settled_minor < funded.expected_minor then 'partial'
         else 'settled' end,
       'overdue', (funded.due_date < v_as_of and not funded.skipped and (funded.expected_minor - funded.settled_minor) > 0),
       'categoryId', funded.category_id::text, 'loanId', funded.loan_id::text,
       'fundingGoalId', funded.funding_goal_id::text, 'preferredWalletId', funded.preferred_wallet_id::text,
       'fundingShortfallMinor', case when funded.funding_goal_id is null then null
         else greatest(funded.settled_minor - funded.goal_funded_minor, 0)::text end,
       'asOf', v_as_of
     ) order by funded.due_date, funded.id), '[]'::jsonb)
     from funded),
    exists(select 1 from numbered where rn > p_limit),
    (select due_date from numbered where rn = p_limit),
    (select id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_due_date, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('dueDate', v_next_due_date, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.goal_history_page(p_space_id uuid, p_goal_id uuid, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_source_kind text DEFAULT NULL::text, p_before_source_id text DEFAULT NULL::text, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_goal public.goals%rowtype;
  v_cursor_fields integer;
  v_rows jsonb;
  v_has_more boolean;
  v_next_created_at timestamptz;
  v_next_source_kind text;
  v_next_source_id text;
begin
  if p_space_id is null or p_goal_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_cursor_fields := (case when p_before_created_at is null then 0 else 1 end)
    + (case when p_before_source_kind is null then 0 else 1 end)
    + (case when p_before_source_id is null then 0 else 1 end);
  if v_cursor_fields not in (0, 3) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;

  with events as (
    select gr.created_at, 'definition'::text as source_kind, gr.id::text as source_id,
      jsonb_build_object(
        'revisionId', gr.id::text, 'nameEn', gr.name_en, 'nameAr', gr.name_ar,
        'targetMinor', gr.target_minor::text, 'deadline', gr.deadline,
        'contributionMode', gr.contribution_mode, 'monthlyMinor', gr.monthly_minor::text,
        'priority', gr.priority, 'state', gr.state,
        'milestones', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', grm.milestone_id::text, 'kind', grm.kind, 'labelEn', grm.label_en, 'labelAr', grm.label_ar,
            'thresholdMinor', grm.threshold_minor::text, 'dueDate', grm.due_date, 'ordinal', grm.ordinal
          ) order by grm.ordinal), '[]'::jsonb)
          from public.goal_revision_milestones grm where grm.revision_id = gr.id limit 20
        )
      ) as detail
    from public.goal_revisions gr where gr.goal_id = p_goal_id
    union all
    select ge.created_at, 'earmark', ge.id::text,
      jsonb_build_object(
        'operation', ge.operation, 'amountMinor', el.amount_minor::text, 'reversalOf', ge.reversal_of::text
      )
    from public.goal_earmark_events ge
    join public.goal_earmark_lines el on el.event_id = ge.id and el.goal_id = p_goal_id
    union all
    select gpl.created_at, 'purchase_link', gpl.id::text,
      jsonb_build_object('expenseEventId', gpl.expense_event_id::text, 'amountMinor', gpl.amount_minor::text)
    from public.goal_purchase_links gpl where gpl.goal_id = p_goal_id
    union all
    select u.created_at,'purchase_unlink',u.id::text,
      jsonb_build_object('purchaseLinkId',link.id::text,'expenseEventId',link.expense_event_id::text,'amountMinor',link.amount_minor::text,'effectiveDate',u.effective_date)
    from public.goal_purchase_unlinks u join public.goal_purchase_links link on link.id=u.goal_purchase_link_id
    where link.goal_id=p_goal_id
    union all
    select gme.created_at, 'checklist', gme.id::text,
      jsonb_build_object('milestoneId', gme.milestone_id::text, 'action', gme.action)
    from public.goal_milestone_events gme where gme.goal_id = p_goal_id
    union all
    select gmtr.created_at, 'monthly_target', gmtr.id::text,
      jsonb_build_object('monthStart', gmtr.month_start, 'amountMinor', gmtr.amount_minor::text)
    from public.goal_monthly_target_revisions gmtr where gmtr.goal_id = p_goal_id
    union all
    select rev.created_at, 'financial_reversal', rev.id::text,
      jsonb_build_object('originalExpenseEventId', rev.reversal_of::text, 'effectiveDate', rev.effective_date)
    from public.financial_events rev
    where rev.reversal_of in (select gpl.expense_event_id from public.goal_purchase_links gpl where gpl.goal_id = p_goal_id)
  ), page as (
    select * from events
    where p_before_created_at is null
      or (created_at, source_kind, source_id) < (p_before_created_at, p_before_source_kind, p_before_source_id)
    order by created_at desc, source_kind desc, source_id desc
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by created_at desc, source_kind desc, source_id desc) as rn from page
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'createdAt', numbered.created_at, 'sourceKind', numbered.source_kind, 'sourceId', numbered.source_id,
      'detail', numbered.detail
    ) order by numbered.created_at desc, numbered.source_kind desc, numbered.source_id desc), '[]'::jsonb)
     from numbered where rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select created_at from numbered where rn = p_limit),
    (select source_kind from numbered where rn = p_limit),
    (select source_id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_created_at, v_next_source_kind, v_next_source_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then
      jsonb_build_object('createdAt', v_next_created_at, 'sourceKind', v_next_source_kind, 'sourceId', v_next_source_id)
      else null end
  );
end;
$$;

-- Recover only deterministic legacy child receipts with exact link identities.
INSERT INTO public.scheduled_payment_goal_links(space_id,occurrence_id,settlement_event_id,goal_purchase_link_id)
SELECT oe.space_id,oe.occurrence_id,oe.id,link.id
FROM public.occurrence_events oe
JOIN public.planning_command_receipts receipt ON receipt.space_id=oe.space_id
  AND receipt.request_id=private.planning_child_request(oe.request_id,
    CASE oe.action WHEN 'confirm' THEN 'confirm_scheduled_occurrence:goal' ELSE 'link_scheduled_payment:goal' END)
  AND receipt.command='link_goal_purchase'
JOIN public.goal_purchase_links link ON link.space_id=oe.space_id AND link.expense_event_id=oe.linked_event_id
  AND link.request_id=receipt.request_id AND receipt.result->'linkIds' ? link.id::text
WHERE oe.action IN ('confirm','link')
ON CONFLICT DO NOTHING;

CREATE FUNCTION private.validate_payment_unlink() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
declare v_date date;
begin
  if TG_TABLE_NAME='scheduled_payment_unlinks' then
    select coalesce(oe.settlement_effective_date,fe.effective_date) into v_date from public.occurrence_events oe
      join public.financial_events fe on fe.id=oe.linked_event_id and fe.space_id=oe.space_id
      where oe.id=NEW.settlement_event_id and oe.space_id=NEW.space_id and oe.occurrence_id=NEW.occurrence_id and oe.action in ('link','confirm');
  else
    select coalesce(link.coverage_effective_date,fe.effective_date) into v_date from public.goal_purchase_links link
      join public.financial_events fe on fe.id=link.expense_event_id and fe.space_id=link.space_id
      where link.id=NEW.goal_purchase_link_id and link.space_id=NEW.space_id;
  end if;
  if v_date is null or NEW.effective_date<v_date then
    raise exception using errcode='23514',message='settlement_unlink_date_invalid';
  end if;
  return NEW;
end; $$;
CREATE TRIGGER scheduled_payment_unlinks_validate BEFORE INSERT ON public.scheduled_payment_unlinks
FOR EACH ROW EXECUTE FUNCTION private.validate_payment_unlink();
CREATE TRIGGER goal_purchase_unlinks_validate BEFORE INSERT ON public.goal_purchase_unlinks
FOR EACH ROW EXECUTE FUNCTION private.validate_payment_unlink();

CREATE FUNCTION public.unlink_scheduled_payment(p_space_id uuid,p_request_id uuid,p_occurrence_id uuid,p_settlement_event_id bigint,p_expected_head text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions SET statement_timeout='10s' AS $$
declare
  v_actor uuid; v_fingerprint bytea; v_result jsonb; v_today date;
  v_occurrence public.scheduled_occurrences%rowtype; v_event public.occurrence_events%rowtype;
  v_original public.financial_events%rowtype; v_receipt jsonb; v_child uuid; v_ids jsonb;
  v_goal_id uuid; v_unlink_id bigint;
begin
  if p_request_id is null or p_occurrence_id is null or p_settlement_event_id is null or p_expected_head is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  v_actor:=private.lock_planning_actor(p_space_id);
  v_fingerprint:=private.planning_fingerprint('unlink_scheduled_payment',v_actor,jsonb_build_object(
    'occurrenceId',p_occurrence_id,'settlementEventId',p_settlement_event_id::text,'expectedHead',p_expected_head));
  v_result:=private.planning_replay(p_space_id,p_request_id,'unlink_scheduled_payment',v_actor,v_fingerprint);
  if v_result is not null then return v_result; end if;
  v_today:=public.space_today(p_space_id);
  select * into v_occurrence from public.scheduled_occurrences where id=p_occurrence_id and space_id=p_space_id for update;
  if not found then raise exception using errcode='P0001',message='the occurrence does not belong to the requested space'; end if;
  if private.occurrence_settlement_head(p_occurrence_id) is distinct from p_expected_head then
    raise exception using errcode='40001',message='planning_stale_revision';
  end if;
  select * into v_event from public.occurrence_events where id=p_settlement_event_id and occurrence_id=p_occurrence_id and space_id=p_space_id and action in ('link','confirm');
  if not found then raise exception using errcode='P0001',message='settlement_line_not_found'; end if;
  select * into v_original from public.financial_events where id=v_event.linked_event_id and space_id=p_space_id for update;
  if not found or v_original.effective_date>v_today then
    raise exception using errcode='P0001',message='settlement_unlink_date_invalid';
  end if;
  if exists(select 1 from public.scheduled_payment_unlinks where settlement_event_id=p_settlement_event_id)
    or exists(select 1 from public.financial_events where reversal_of=v_original.id and effective_date<=v_today) then
    raise exception using errcode='P0001',message='settlement_already_detached';
  end if;

  if v_occurrence.funding_goal_id is not null then
    select result into v_receipt from public.planning_command_receipts
      where space_id=p_space_id and request_id=v_event.request_id;
    if not coalesce(v_receipt ? 'goalPurchaseLinkIds',false) then
      v_child:=private.planning_child_request(v_event.request_id,
        case v_event.action when 'confirm' then 'confirm_scheduled_occurrence:goal' else 'link_scheduled_payment:goal' end);
      select result->'linkIds' into v_ids from public.planning_command_receipts
        where space_id=p_space_id and request_id=v_child and command='link_goal_purchase';
      if v_ids is null then
        if exists(select 1 from public.goal_purchase_links where space_id=p_space_id and expense_event_id=v_event.linked_event_id and goal_id=v_occurrence.funding_goal_id) then
          raise exception using errcode='P0001',message='settlement_provenance_unavailable';
        end if;
      elsif jsonb_typeof(v_ids)<>'array'
        or jsonb_array_length(v_ids)<>(select count(*) from public.goal_purchase_links link where link.space_id=p_space_id and link.request_id=v_child and link.expense_event_id=v_event.linked_event_id and link.goal_id=v_occurrence.funding_goal_id and v_ids ? link.id::text)
        or jsonb_array_length(v_ids)<>(select count(*) from public.goal_purchase_links link where link.space_id=p_space_id and link.request_id=v_child) then
        raise exception using errcode='P0001',message='settlement_provenance_unavailable';
      else
        insert into public.scheduled_payment_goal_links(space_id,occurrence_id,settlement_event_id,goal_purchase_link_id)
          select p_space_id,p_occurrence_id,p_settlement_event_id,link.id from public.goal_purchase_links link
          where link.space_id=p_space_id and link.request_id=v_child and link.expense_event_id=v_event.linked_event_id and v_ids ? link.id::text
          on conflict do nothing;
      end if;
    end if;
  end if;
  for v_goal_id in select distinct link.goal_id from public.scheduled_payment_goal_links provenance
    join public.goal_purchase_links link on link.id=provenance.goal_purchase_link_id
    where provenance.settlement_event_id=p_settlement_event_id order by link.goal_id loop
    perform 1 from public.goals where id=v_goal_id and space_id=p_space_id for update;
  end loop;
  insert into public.scheduled_payment_unlinks(space_id,occurrence_id,settlement_event_id,effective_date,request_id,actor_id)
    values(p_space_id,p_occurrence_id,p_settlement_event_id,v_today,p_request_id,v_actor) returning id into v_unlink_id;
  insert into public.goal_purchase_unlinks(space_id,goal_purchase_link_id,effective_date,request_id,actor_id)
    select p_space_id,provenance.goal_purchase_link_id,v_today,
      private.planning_child_request(p_request_id,'unlink:goal:'||provenance.goal_purchase_link_id::text),v_actor
    from public.scheduled_payment_goal_links provenance
    where provenance.settlement_event_id=p_settlement_event_id;
  v_result:=jsonb_build_object('occurrenceId',p_occurrence_id::text,'settlementEventId',p_settlement_event_id::text,'unlinkId',v_unlink_id::text,'head',private.occurrence_settlement_head(p_occurrence_id));
  insert into public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result)
    values(p_space_id,p_request_id,'unlink_scheduled_payment',v_fingerprint,v_actor,v_result);
  return v_result;
end; $$;

CREATE FUNCTION public.scheduled_settlement_page(p_space_id uuid,p_occurrence_id uuid,p_after_id bigint DEFAULT NULL,p_limit int DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='10s' AS $$
declare v_result jsonb; v_today date;
begin
  if not private.is_active_member(p_space_id) then raise exception using errcode='42501',message='planning_not_authorized'; end if;
  if p_limit is null or p_limit<1 or p_limit>100 or p_occurrence_id is null then raise exception using errcode='22023',message='planning_invalid_input'; end if;
  if not exists(select 1 from public.scheduled_occurrences where id=p_occurrence_id and space_id=p_space_id) then raise exception using errcode='P0001',message='settlement_line_not_found'; end if;
  v_today:=public.space_today(p_space_id);
  with page as (
    select oe.*,coalesce(oe.settlement_effective_date,fe.effective_date) as effective_date, row_number() over(order by oe.id) as rn,
      not exists(select 1 from public.scheduled_payment_unlinks u where u.settlement_event_id=oe.id and u.effective_date<=v_today)
      and not exists(select 1 from public.financial_events rev where rev.reversal_of=fe.id and rev.effective_date<=v_today) as active
    from public.occurrence_events oe join public.financial_events fe on fe.id=oe.linked_event_id
    where oe.space_id=p_space_id and oe.occurrence_id=p_occurrence_id and oe.action in ('link','confirm') and (p_after_id is null or oe.id>p_after_id)
    order by oe.id limit p_limit+1
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
      'settlementEventId',id::text,'financialEventId',linked_event_id::text,'amountMinor',link_amount_minor::text,'effectiveDate',effective_date,'active',active) order by id) from page where rn<=p_limit),'[]'::jsonb),
    'hasMore',exists(select 1 from page where rn>p_limit),'nextCursor',case when exists(select 1 from page where rn>p_limit) then (select max(id)::text from page where rn<=p_limit) else null end) into v_result;
  return v_result;
end; $$;

-- New history has the same append-only/owner-write/member-read boundary as existing planning history.
DO $$
declare tab text;
begin
  foreach tab in array array['scheduled_payment_unlinks','scheduled_payment_goal_links','goal_purchase_unlinks'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(space_id))',tab||'_member_read',tab);
    execute format('create trigger %I before insert on public.%I for each statement execute function private.require_table_owner_write()',tab||'_owner_write',tab);
    execute format('create trigger %I before update or delete or truncate on public.%I for each statement execute function private.planning_reject_mutation()',tab||'_reject_mutation',tab);
  end loop;
end; $$;
REVOKE ALL ON FUNCTION public.unlink_scheduled_payment(uuid,uuid,uuid,bigint,text),public.scheduled_settlement_page(uuid,uuid,bigint,int),public.confirm_scheduled_occurrence_v2(uuid,uuid,uuid,text,text,date,uuid),public.link_scheduled_payment_v2(uuid,uuid,uuid,uuid,text,text),public.set_occurrence_state_v2(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.unlink_scheduled_payment(uuid,uuid,uuid,bigint,text),public.scheduled_settlement_page(uuid,uuid,bigint,int),public.confirm_scheduled_occurrence_v2(uuid,uuid,uuid,text,text,date,uuid),public.link_scheduled_payment_v2(uuid,uuid,uuid,uuid,text,text),public.set_occurrence_state_v2(uuid,uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.active_goal_purchase_links(uuid,date),private.goal_purchase_releases(uuid),private.occurrence_settlement_head(uuid),private.validate_payment_unlink(),private.confirm_scheduled_occurrence_body(uuid,uuid,uuid,bigint,text,date,uuid),private.link_scheduled_payment_body(uuid,uuid,uuid,uuid,text,bigint),private.set_occurrence_state_body(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
