-- Task 13 (audit C1): the deferred earmark check counted a linked purchase
-- twice. It summed GROSS all-time earmark lines as running_balance and
-- separately subtracted every purchase link from the target, while the
-- reserve/move commands already compare against private.goal_financing_state,
-- which is NET of linked purchases. A goal with any linked purchase could
-- therefore never accept a further reserve even with room left. This makes
-- the check share the command's own financing-state definitions of
-- earmarked and fulfilled, so there is exactly one meaning of "room left".
-- Only the balance block changes; every shape check above it is unchanged.
create or replace function private.check_goal_earmark_event(p_event_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_event public.goal_earmark_events%rowtype;
  v_original public.goal_earmark_events%rowtype;
  v_line_count integer;
  v_positive_count integer;
  v_negative_count integer;
  v_distinct_goals integer;
  v_line_sum bigint;
  v_reverse_mismatch integer;
  v_bad_balance integer;
  v_as_of date;
begin
  select * into v_event from public.goal_earmark_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='goal_earmark_event_missing';
  end if;
  v_as_of := greatest((now() at time zone 'UTC')::date, v_event.effective_date);

  select count(*), count(*) filter (where amount_minor > 0), count(*) filter (where amount_minor < 0),
    count(distinct goal_id), coalesce(sum(amount_minor),0)
    into v_line_count, v_positive_count, v_negative_count, v_distinct_goals, v_line_sum
    from public.goal_earmark_lines where event_id = p_event_id;

  if v_line_count is distinct from v_event.line_count then
    raise exception using errcode='23514', message='goal_earmark_line_count_mismatch';
  end if;

  if v_event.operation = 'reserve' then
    if v_line_count <> 1 or v_positive_count <> 1 then
      raise exception using errcode='23514', message='goal_earmark_reserve_shape_invalid';
    end if;
  elsif v_event.operation = 'release' then
    if v_line_count <> 1 or v_negative_count <> 1 then
      raise exception using errcode='23514', message='goal_earmark_release_shape_invalid';
    end if;
  elsif v_event.operation = 'move' then
    if v_line_count <> 2 or v_distinct_goals <> 2 or v_positive_count <> 1
      or v_negative_count <> 1 or v_line_sum <> 0 then
      raise exception using errcode='23514', message='goal_earmark_move_shape_invalid';
    end if;
  elsif v_event.operation = 'reverse' then
    select * into v_original from public.goal_earmark_events where id = v_event.reversal_of for update;
    if not found or v_original.operation = 'reverse' then
      raise exception using errcode='23514', message='goal_earmark_reverse_target_invalid';
    end if;
    if v_line_count is distinct from v_original.line_count then
      raise exception using errcode='23514', message='goal_earmark_reverse_shape_invalid';
    end if;
    select count(*) into v_reverse_mismatch
    from public.goal_earmark_lines orig
    where orig.event_id = v_original.id
      and not exists(
        select 1 from public.goal_earmark_lines rev
        where rev.event_id = p_event_id and rev.goal_id = orig.goal_id and rev.amount_minor = -orig.amount_minor
      );
    if v_reverse_mismatch <> 0 then
      raise exception using errcode='23514', message='goal_earmark_reverse_shape_invalid';
    end if;
  end if;

  -- Same definitions as the reserve command (audit C1): earmark net of linked
  -- purchases plus what those purchases fulfilled must stay within the target,
  -- and the net earmark may never go below zero. Evaluated as of the later of
  -- UTC "today" and this event's own effective_date (v_as_of above), not
  -- UTC "today" alone: every RPC-written event posts at today, so v_as_of
  -- equals today for all of them and this is a no-op change for the command
  -- path, but an owner-level insert backdating effective_date into the future
  -- can no longer hide its own contribution from this check by outrunning
  -- "today". UTC "today" matches the command until the Spec 1 space clock
  -- replaces both together.
  select count(*) into v_bad_balance
  from (
    select el.goal_id, sum(el.amount_minor) as event_contribution,
      state.earmarked_minor, state.fulfilled_minor,
      (select target_minor from public.goal_revisions where goal_id = el.goal_id order by id desc limit 1) as target
    from public.goal_earmark_lines el
    cross join lateral private.goal_financing_state(el.goal_id, v_as_of) state
    where el.event_id = p_event_id
    group by el.goal_id, state.earmarked_minor, state.fulfilled_minor
  ) totals
  where earmarked_minor < 0
    or (v_event.operation <> 'reverse' and event_contribution > 0 and earmarked_minor + fulfilled_minor > target);
  if v_bad_balance <> 0 then
    raise exception using errcode='23514', message='goal_earmark_balance_invalid';
  end if;
end;
$$;
revoke all on function private.check_goal_earmark_event(bigint) from public, anon, authenticated, service_role;
