-- Audit D7 (follow-up from W3A, docs/verification/2026-09-27-w3a-settlement.md §5):
-- the occurrence read exposed only `currentEventId` (the occurrence_events head,
-- e.g. a 'skip'), which is not the wallet event a settlement linked. Without
-- `occurrence_events.linked_event_id` the bills screen cannot unlink a match
-- made earlier -- auto-settle when the entry was recorded, or a Link from a
-- previous visit -- because the unlink mechanic (`reverse_financial_event`
-- through the wallets gateway) reverses the linked wallet event.
--
-- Forward-only: CREATE OR REPLACE both read functions, adding exactly one
-- field, `linkedEventId`: the wallet event of the newest still-live
-- `link`/`confirm` occurrence event for the row.
--
-- "Still live" mirrors `private.schedule_occurrence_settlement` exactly: a
-- linked wallet event counts only when it is effective on/before the read's
-- UTC `asOf`, and it is dropped once a reversal of it is also effective by
-- then. That makes the field the id a successful Unlink can actually reverse:
-- after reversing the newest payment the field falls back to the next live
-- one, and once nothing live remains it is null, so the affordance disappears
-- instead of pointing at an already-reversed event. `currentEventId` is
-- unchanged (skip/reopen still use it as the expected head).

create or replace function public.scheduled_occurrence_page(
  p_space_id uuid, p_from_date date, p_to_date date,
  p_after_due_date date default null, p_after_id uuid default null, p_limit int default 25
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_as_of date := (now() at time zone 'UTC')::date;
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
      select sum(gpl.amount_minor) from public.goal_purchase_links gpl
      where gpl.goal_id = settled.funding_goal_id
        and gpl.expense_event_id in (
          select oe.linked_event_id from public.occurrence_events oe
          where oe.occurrence_id = settled.id and oe.action in ('link','confirm')
        )
    ), 0) as goal_funded_minor
    from settled
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', funded.id::text, 'scheduleId', funded.schedule_id::text,
       'sourceRevisionId', funded.source_revision_id::text,
       'currentEventId', (select max(id)::text from public.occurrence_events where occurrence_id = funded.id),
       'linkedEventId', (select oe.linked_event_id::text
         from public.occurrence_events oe
         join public.financial_events fe on fe.id = oe.linked_event_id
         where oe.occurrence_id = funded.id and oe.action in ('link','confirm')
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
revoke all on function public.scheduled_occurrence_page(uuid,date,date,date,uuid,int) from public,anon,authenticated,service_role;
grant execute on function public.scheduled_occurrence_page(uuid,date,date,date,uuid,int) to authenticated;

create or replace function public.scheduled_overdue_page(
  p_space_id uuid, p_after_due_date date default null, p_after_id uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog set statement_timeout = '10s' as $$
declare
  v_as_of date := (now() at time zone 'UTC')::date;
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
      select sum(gpl.amount_minor) from public.goal_purchase_links gpl
      where gpl.goal_id = settled.funding_goal_id
        and gpl.expense_event_id in (
          select oe.linked_event_id from public.occurrence_events oe
          where oe.occurrence_id = settled.id and oe.action in ('link','confirm')
        )
    ), 0) as goal_funded_minor
    from settled
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', funded.id::text, 'scheduleId', funded.schedule_id::text,
       'sourceRevisionId', funded.source_revision_id::text,
       'currentEventId', (select max(id)::text from public.occurrence_events where occurrence_id = funded.id),
       'linkedEventId', (select oe.linked_event_id::text
         from public.occurrence_events oe
         join public.financial_events fe on fe.id = oe.linked_event_id
         where oe.occurrence_id = funded.id and oe.action in ('link','confirm')
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
revoke all on function public.scheduled_overdue_page(uuid,date,uuid,int) from public,anon,authenticated,service_role;
grant execute on function public.scheduled_overdue_page(uuid,date,uuid,int) to authenticated;
