-- Unpaid, unskipped occurrences due before today (UTC, until the Spec 1 space
-- clock), oldest first, keyset-paged. Projections count these with no lower
-- date bound, so the list must be able to reach all of them (audit D1).
create function public.scheduled_overdue_page(
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
