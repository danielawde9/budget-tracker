-- Lifecycle actions clone the expected immutable revision on the server.
-- The summary DTO intentionally lacks note/priority/contribution settings;
-- reconstructing a definition from it would erase those fields.
create function public.set_goal_state(
  p_space_id uuid, p_request_id uuid, p_goal_id uuid,
  p_expected_revision_id bigint, p_state text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  v_revision public.goal_revisions%rowtype;
  v_kind text;
  v_definition jsonb;
  v_milestones jsonb;
begin
  if auth.uid() is null or p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  select revision.* into v_revision
    from public.goal_revisions revision
    join public.goals goal on goal.id = revision.goal_id and goal.space_id = revision.space_id
    where revision.id = p_expected_revision_id and revision.goal_id = p_goal_id and revision.space_id = p_space_id;
  if not found then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  select kind into v_kind from public.goals where id = p_goal_id and space_id = p_space_id;
  v_definition := jsonb_build_object(
    'kind', v_kind, 'currency', v_revision.currency,
    'nameEn', v_revision.name_en, 'nameAr', v_revision.name_ar, 'note', v_revision.note,
    'targetMinor', v_revision.target_minor::text, 'deadline', v_revision.deadline,
    'contributionMode', v_revision.contribution_mode, 'monthlyAmountMinor', v_revision.monthly_minor::text,
    'priority', v_revision.priority
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', milestone_id::text, 'kind', kind, 'labelEn', label_en, 'labelAr', label_ar,
    'thresholdMinor', threshold_minor::text, 'dueDate', due_date, 'ordinal', ordinal
  ) order by ordinal), '[]'::jsonb) into v_milestones
    from public.goal_revision_milestones where revision_id = p_expected_revision_id;
  -- Reusing the expected revision (not the current head) keeps repeated
  -- requests fingerprint-identical even after the first request succeeds.
  return public.revise_goal_plan(p_space_id, p_request_id, p_goal_id,
    p_expected_revision_id, v_definition, v_milestones, p_state);
end;
$$;
revoke all on function public.set_goal_state(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.set_goal_state(uuid,uuid,uuid,bigint,text) to authenticated;
