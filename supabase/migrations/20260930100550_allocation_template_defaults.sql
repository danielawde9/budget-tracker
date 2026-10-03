-- Complete current remembered defaults, distinct from approved period mappings.
CREATE FUNCTION public.allocation_template_defaults(p_space_id uuid, p_currency public.currency_code) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE
 v_head bigint; v_group_count integer; v_root_count integer;
 v_groups jsonb; v_roots jsonb;
BEGIN
 IF p_space_id IS NULL OR p_currency IS NULL OR NOT private.is_active_member(p_space_id) THEN
  RAISE EXCEPTION USING errcode='42501', message='planning_not_authorized';
 END IF;
 SELECT id,group_count,root_count INTO v_head,v_group_count,v_root_count
 FROM public.allocation_template_revisions WHERE space_id=p_space_id AND currency=p_currency ORDER BY id DESC LIMIT 1;
 IF v_head IS NULL THEN RETURN jsonb_build_object('templateRevisionId',NULL,'groups','[]'::jsonb,'rootMappings','[]'::jsonb,'lineCounts',jsonb_build_object('groups',0,'rootMappings',0)); END IF;
 IF v_root_count>10000 OR v_group_count>12 THEN RAISE EXCEPTION USING errcode='22023',message='period_plan_too_large'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.group_id,'purpose',g.purpose,'nameEn',l.name_en,'nameAr',l.name_ar,'order',l.display_order,'basisPoints',l.basis_points) ORDER BY l.display_order,l.group_id),'[]'::jsonb)
 INTO v_groups FROM public.allocation_template_lines l JOIN public.allocation_groups g ON g.id=l.group_id AND g.space_id=l.space_id AND g.currency=l.currency
 WHERE l.template_id=v_head AND l.space_id=p_space_id AND l.currency=p_currency;
 SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId',r.category_id,'groupId',r.group_id) ORDER BY r.category_id),'[]'::jsonb)
 INTO v_roots FROM public.allocation_template_roots r WHERE r.template_id=v_head AND r.space_id=p_space_id AND r.currency=p_currency;
 IF jsonb_array_length(v_groups)<>v_group_count OR jsonb_array_length(v_roots)<>v_root_count THEN
  RAISE EXCEPTION USING errcode='22023',message='allocation_template_defaults_incomplete';
 END IF;
 RETURN jsonb_build_object('templateRevisionId',v_head::text,'groups',v_groups,'rootMappings',v_roots,'lineCounts',jsonb_build_object('groups',v_group_count,'rootMappings',v_root_count));
END;
$$;
REVOKE ALL ON FUNCTION public.allocation_template_defaults(uuid,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.allocation_template_defaults(uuid,public.currency_code) TO authenticated;
