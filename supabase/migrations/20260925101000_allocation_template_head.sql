-- The latest allocation template revision for a space and currency, which
-- save_allocation_template requires as p_expected_revision_id. The month
-- state only reports the template of its own snapshot, which is null for a
-- month that has none yet (audit B1).
create function public.allocation_template_head(p_space_id uuid, p_currency public.currency_code)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_head bigint;
begin
  if p_space_id is null or p_currency is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'planning_not_authorized';
  end if;
  select revision.id into v_head
  from public.allocation_template_revisions as revision
  where revision.space_id = p_space_id and revision.currency = p_currency
  order by revision.id desc
  limit 1;
  return jsonb_build_object('templateRevisionId', v_head::text);
end;
$$;

revoke all on function public.allocation_template_head(uuid, public.currency_code) from public, anon, authenticated, service_role;
grant execute on function public.allocation_template_head(uuid, public.currency_code) to authenticated;
