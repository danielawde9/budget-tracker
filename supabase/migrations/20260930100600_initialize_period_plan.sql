-- All category commands acquire the same space lock as initialization before
-- their request advisory lock or category rows. Archive's receipt space FK can
-- then never invert initializer's space-before-category source-lock order.
CREATE OR REPLACE FUNCTION private.lock_category_request(
  p_space_id uuid,
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM private.lock_planning_actor(p_space_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'category:' || p_space_id::text || ':' || p_request_id::text,
      0
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION private.lock_category_request(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Read-only proposal identities are not database IDs. Only acceptance allocates IDs.
CREATE FUNCTION private.default_plan_reference(p_id uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE WHEN p_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('kind','existing','id',p_id) END $$;
REVOKE ALL ON FUNCTION private.default_plan_reference(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.preview_default_period_plan(p_space_id uuid,p_period_key date,p_currency public.currency_code)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE source jsonb; draft jsonb; groups jsonb:='[]'; mappings jsonb:='[]'; targets jsonb:='[]'; choices jsonb:='[]'; item jsonb; ref jsonb; gref jsonb; matched uuid; conflicts jsonb; result jsonb; context jsonb; received numeric; unpaid numeric; linked numeric; scheduled_count bigint; review boolean; signature jsonb;
BEGIN
 IF NOT private.is_active_member(p_space_id) THEN RAISE EXCEPTION USING errcode='42501',message='planning_not_authorized'; END IF;
 source:=private.period_plan_read(p_space_id,p_period_key,p_currency,true); draft:=source->'draft'; context:=source->'context';
 -- Source remains genuine current evidence, never a fabricated unsaved read.
 FOR item IN SELECT value FROM jsonb_array_elements('[{"key":"essentials","purpose":"spending","nameEn":"Essentials","nameAr":"الأساسيات","order":0,"basisPoints":6000},{"key":"guilt-free","purpose":"spending","nameEn":"Guilt free","nameAr":"الإنفاق الحر","order":1,"basisPoints":500},{"key":"short-term","purpose":"future","nameEn":"Short-term goals","nameAr":"الأهداف قصيرة المدى","order":2,"basisPoints":1500},{"key":"saving","purpose":"future","nameEn":"Saving","nameAr":"الادخار","order":3,"basisPoints":1000},{"key":"investment","purpose":"future","nameEn":"Investment","nameAr":"الاستثمار","order":4,"basisPoints":1000}]'::jsonb) LOOP
  SELECT (g->>'id')::uuid INTO matched FROM jsonb_array_elements(source#>'{draft,groups}')g WHERE g->>'purpose'=item->>'purpose' AND private.english_category_key(g->>'nameEn')=private.english_category_key(item->>'nameEn') AND private.arabic_category_key(g->>'nameAr')=private.arabic_category_key(item->>'nameAr') ORDER BY g->>'id' LIMIT 1;
  ref:=CASE WHEN matched IS NULL THEN jsonb_build_object('kind','proposed','key',item->>'key') ELSE private.default_plan_reference(matched) END;
  groups:=groups||jsonb_build_array((item-'key')||jsonb_build_object('id',ref));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(draft->'rootTargets') LOOP targets:=targets||jsonb_build_array(item||jsonb_build_object('categoryId',private.default_plan_reference((item->>'categoryId')::uuid))); END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements('[{"key":"rent","nameEn":"Rent","nameAr":"الإيجار","groupKey":"essentials"},{"key":"bills","nameEn":"Bills","nameAr":"الفواتير","groupKey":"essentials"},{"key":"groceries","nameEn":"Groceries","nameAr":"البقالة","groupKey":"essentials"},{"key":"transport","nameEn":"Transport","nameAr":"النقل","groupKey":"essentials"},{"key":"eating-out","nameEn":"Eating out","nameAr":"الأكل خارج المنزل","groupKey":"guilt-free"},{"key":"fun","nameEn":"Fun","nameAr":"الترفيه","groupKey":"guilt-free"},{"key":"shopping","nameEn":"Shopping","nameAr":"التسوق","groupKey":"guilt-free"}]'::jsonb) LOOP
  SELECT c.id INTO matched FROM public.categories c WHERE c.space_id=p_space_id AND c.kind='expense' AND c.parent_category_id IS NULL AND c.archived_at IS NULL AND c.name_en_key=private.english_category_key(item->>'nameEn') AND c.name_ar_key=private.arabic_category_key(item->>'nameAr');
  SELECT coalesce(jsonb_agg(c.id ORDER BY c.id),'[]') INTO conflicts FROM public.categories c WHERE c.space_id=p_space_id AND c.id IS DISTINCT FROM matched AND (c.name_en_key=private.english_category_key(item->>'nameEn') OR c.name_ar_key=private.arabic_category_key(item->>'nameAr'));
  choices:=choices||jsonb_build_array(item||jsonb_build_object('reuseCategoryId',matched,'conflictingCategoryIds',conflicts));
  ref:=CASE WHEN matched IS NOT NULL THEN private.default_plan_reference(matched) ELSE jsonb_build_object('kind','proposed','key',item->>'key') END;
  SELECT g->'id' INTO gref FROM jsonb_array_elements(groups)g WHERE g->>'order'=CASE item->>'groupKey' WHEN 'essentials' THEN '0' ELSE '1' END;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('categoryId',ref,'groupId',gref));
  IF matched IS NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('categoryId',ref,'amountMinor','0','expectedRevisionId',null)); END IF;
 END LOOP;
 SELECT coalesce(sum(income_minor),0) INTO received FROM private.planning_period_activity(p_space_id,p_period_key) WHERE currency=p_currency;
 WITH occurrences AS (
  SELECT so.id,so.expected_minor FROM public.scheduled_occurrences so JOIN public.schedules s ON s.id=so.schedule_id WHERE so.space_id=p_space_id AND so.currency=p_currency AND s.kind='income' AND so.due_date>=(context->>'start')::date AND so.due_date<(context->>'endExclusive')::date
  UNION ALL
  SELECT private.schedule_occurrence_id(c.schedule_id,c.due_date),c.expected_minor FROM private.schedule_occurrence_candidates(p_space_id,(context->>'start')::date,(context->>'endExclusive')::date-1)c JOIN public.schedules s ON s.id=c.schedule_id WHERE c.currency=p_currency AND s.kind='income' AND NOT EXISTS(SELECT 1 FROM public.scheduled_occurrences so WHERE so.id=private.schedule_occurrence_id(c.schedule_id,c.due_date))
 ) SELECT coalesce(sum(CASE WHEN st.skipped THEN 0 ELSE greatest(o.expected_minor-st.settled_minor,0) END),0),count(*) FILTER(WHERE NOT st.skipped) INTO unpaid,scheduled_count FROM occurrences o CROSS JOIN LATERAL private.schedule_occurrence_settlement(o.id,(context->>'asOf')::date)st;
 SELECT coalesce(sum(oe.link_amount_minor),0) INTO linked FROM public.occurrence_events oe JOIN public.scheduled_occurrences so ON so.id=oe.occurrence_id JOIN public.schedules s ON s.id=so.schedule_id JOIN public.financial_events fe ON fe.id=oe.linked_event_id
 WHERE so.space_id=p_space_id AND so.currency=p_currency AND s.kind='income' AND oe.action IN ('link','confirm') AND fe.kind='income' AND fe.effective_date>=(context->>'start')::date AND fe.effective_date<(context->>'endExclusive')::date AND fe.effective_date<=(context->>'asOf')::date AND coalesce(oe.settlement_effective_date,fe.effective_date)<=(context->>'asOf')::date
 AND NOT EXISTS(SELECT 1 FROM public.financial_events rev WHERE rev.reversal_of=fe.id AND rev.effective_date<=(context->>'asOf')::date)
 AND NOT EXISTS(SELECT 1 FROM public.scheduled_payment_unlinks u WHERE u.settlement_event_id=oe.id AND u.effective_date<=(context->>'asOf')::date);
 review:=scheduled_count>0 AND received>linked;
 SELECT g->'id' INTO gref FROM jsonb_array_elements(groups)g WHERE g->>'order'='2';
 draft:=draft||jsonb_build_object('groups',groups,'rootMappings',mappings,'rootTargets',targets,'incomeMinor',CASE WHEN review THEN draft->>'incomeMinor' ELSE greatest(received+unpaid,0)::text END,'loanGroupId',gref,'roleChange',jsonb_build_object('goalsGroupId',gref,'debtGroupId',gref,'expectedRevisionId',draft->'expectedRoleRevisionId'),
 'goalTargets',(SELECT coalesce(jsonb_agg(g||jsonb_build_object('groupId',gref)),'[]') FROM jsonb_array_elements(draft->'goalTargets')g),'goalDefaultChanges','[]'::jsonb);
 result:=jsonb_build_object('source',source,'draft',draft,'categoryChoices',choices,'suggestedIncomeMinor',CASE WHEN review THEN null ELSE greatest(received+unpaid,0)::text END,'incomeSuggestionNeedsReview',review);
 -- Include all relevant source rows, not just totals: reversals, same-total
 -- replacements, links/unlinks and metadata changes also invalidate acceptance.
 signature:=jsonb_build_object(
 'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.categories c WHERE c.space_id=p_space_id),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.financial_events e WHERE e.space_id=p_space_id),
 'movements',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.wallet_movements m WHERE m.space_id=p_space_id),
 'journalDescriptions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.event_id),'[]') FROM public.financial_event_descriptions d WHERE d.space_id=p_space_id),
 'journalCategories',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.event_id),'[]') FROM public.financial_event_categories c WHERE c.space_id=p_space_id),
 'scheduleRevisions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.schedule_revisions r WHERE r.space_id=p_space_id),
 'occurrences',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.scheduled_occurrences o WHERE o.space_id=p_space_id),
 'settlements',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.occurrence_events o WHERE o.space_id=p_space_id),
 'unlinks',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id),'[]') FROM public.scheduled_payment_unlinks u WHERE u.space_id=p_space_id),
 'schedule',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.space_schedule_revisions r WHERE r.space_id=p_space_id),
 'goalDefinitions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.goal_revisions r WHERE r.space_id=p_space_id),
 'loans',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.loans l WHERE l.space_id=p_space_id),
 'defaults',public.allocation_template_defaults(p_space_id,p_currency));
 RETURN result||jsonb_build_object('previewHash',encode(extensions.digest(jsonb_build_array(result,signature)::text,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.preview_default_period_plan(uuid,date,public.currency_code) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.preview_default_period_plan(uuid,date,public.currency_code) TO authenticated;

CREATE FUNCTION private.resolve_default_plan_reference(p_ref jsonb,p_map jsonb,p_nullable boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF p_nullable AND p_ref='null'::jsonb THEN RETURN p_ref; END IF;
 IF p_ref->>'kind'='existing' THEN
  PERFORM private.period_plan_object(p_ref,ARRAY['kind','id']);PERFORM private.period_plan_id(p_ref->'id',true,false);RETURN p_ref->'id';
 ELSIF p_ref->>'kind'='proposed' THEN
  PERFORM private.period_plan_object(p_ref,ARRAY['kind','key']);result:=p_map->(p_ref->>'key');IF result IS NOT NULL THEN RETURN result; END IF;
 END IF;
 RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference';
END $$;
REVOKE ALL ON FUNCTION private.resolve_default_plan_reference(jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.initialize_period_plan(p_space_id uuid,p_request_id uuid,p_period_key date,p_currency public.currency_code,p_accepted_preview_hash text,p_accepted_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE actor uuid; fingerprint bytea; result jsonb; preview jsonb; draft jsonb:=p_accepted_draft; groups jsonb:='{}'; categories jsonb:='{}'; resolved jsonb; lines jsonb; item jsonb; choice jsonb; collection text; field text; new_id uuid; proposal_key text;
BEGIN
 IF p_request_id IS NULL OR p_accepted_preview_hash IS NULL OR p_accepted_preview_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 actor:=private.lock_planning_actor(p_space_id);
 fingerprint:=private.planning_fingerprint('initialize_period_plan',actor,jsonb_build_object('periodKey',p_period_key,'currency',p_currency,'previewHash',p_accepted_preview_hash,'draft',draft));
 result:=private.planning_replay(p_space_id,p_request_id,'initialize_period_plan',actor,fingerprint);IF result IS NOT NULL THEN RETURN result; END IF;
 -- Category constructors/archive share our space-first protocol. Retain source
 -- row locks as well; all category locks are now acquired after the space lock.
 PERFORM 1 FROM public.categories WHERE space_id=p_space_id ORDER BY id FOR SHARE;
 preview:=public.preview_default_period_plan(p_space_id,p_period_key,p_currency);
 IF preview->>'previewHash' IS DISTINCT FROM p_accepted_preview_hash THEN RAISE EXCEPTION USING errcode='40001',message='default_plan_stale_preview'; END IF;
 PERFORM private.period_plan_object(draft,ARRAY['expectedRoleRevisionId','expectedGoalDefaultRevisionIds','roleChange','expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId','incomeMinor','groups','rootMappings','rootTargets','goalTargets','loanTargets','loanGroupId','acceptOverallocated','goalDefaultChanges']);
 FOREACH field IN ARRAY ARRAY['expectedSnapshotId','expectedTemplateRevisionId','expectedIncomeRevisionId','expectedRoleRevisionId','expectedGoalDefaultRevisionIds'] LOOP
  IF draft->field IS DISTINCT FROM preview#>ARRAY['source','draft',field] THEN RAISE EXCEPTION USING errcode='40001',message='planning_stale_revision'; END IF;
 END LOOP;
 FOREACH collection IN ARRAY ARRAY['groups','rootTargets','rootMappings','goalTargets','loanTargets','goalDefaultChanges'] LOOP
  IF jsonb_typeof(draft->collection) IS DISTINCT FROM 'array' OR jsonb_array_length(draft->collection)>10000 THEN RAISE EXCEPTION USING errcode='22023',message='planning_invalid_input'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(draft->'groups') LOOP
  IF item#>>'{id,kind}'='proposed' THEN
   proposal_key:=item#>>'{id,key}';IF proposal_key IS NULL OR proposal_key !~ '^[a-zA-Z0-9:_-]{1,100}$' OR groups ? proposal_key THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
   groups:=groups||jsonb_build_object(proposal_key,gen_random_uuid());
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(preview#>'{source,draft,groups}')g WHERE g->'id'=item#>'{id,id}') THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
 END LOOP;
 -- Only predefined preview category keys may create a root. Existing IDs are
 -- deliberate accepted choices and must name active expense roots in this space.
 FOR item IN SELECT value FROM jsonb_array_elements(draft->'rootTargets') LOOP
  IF item#>>'{categoryId,kind}'='proposed' THEN
   proposal_key:=item#>>'{categoryId,key}';SELECT c INTO choice FROM jsonb_array_elements(preview->'categoryChoices')c WHERE c->>'key'=proposal_key;
   IF NOT FOUND OR categories ? proposal_key OR item->'expectedRevisionId'<>'null'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
   SELECT id INTO new_id FROM public.create_category(p_space_id,private.planning_child_request(p_request_id,'category:'||proposal_key),'expense',choice->>'nameEn',choice->>'nameAr');
   categories:=categories||jsonb_build_object(proposal_key,new_id);
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.categories c WHERE c.id=(item#>>'{categoryId,id}')::uuid AND c.space_id=p_space_id AND c.kind='expense' AND c.parent_category_id IS NULL AND c.archived_at IS NULL) THEN RAISE EXCEPTION USING errcode='22023',message='default_plan_invalid_reference'; END IF;
  END IF;
 END LOOP;
 FOREACH collection IN ARRAY ARRAY['groups','rootMappings','rootTargets','goalTargets','goalDefaultChanges'] LOOP
  lines:='[]';FOR item IN SELECT value FROM jsonb_array_elements(draft->collection) LOOP
   IF collection='groups' THEN item:=item||jsonb_build_object('id',private.resolve_default_plan_reference(item->'id',groups)); END IF;
   IF collection IN ('rootMappings','rootTargets') THEN item:=item||jsonb_build_object('categoryId',private.resolve_default_plan_reference(item->'categoryId',categories)); END IF;
   IF collection IN ('rootMappings','goalTargets','goalDefaultChanges') THEN item:=item||jsonb_build_object('groupId',private.resolve_default_plan_reference(item->'groupId',groups,collection<>'rootMappings')); END IF;
   lines:=lines||jsonb_build_array(item);
  END LOOP;draft:=jsonb_set(draft,ARRAY[collection],lines);
 END LOOP;
 draft:=jsonb_set(draft,'{loanGroupId}',private.resolve_default_plan_reference(draft->'loanGroupId',groups,true));
 IF draft->'roleChange'<>'null'::jsonb THEN
  FOREACH field IN ARRAY ARRAY['goalsGroupId','debtGroupId'] LOOP draft:=jsonb_set(draft,ARRAY['roleChange',field],private.resolve_default_plan_reference(draft#>ARRAY['roleChange',field],groups)); END LOOP;
 END IF;
 result:=public.save_period_plan(p_space_id,private.planning_child_request(p_request_id,'save'),p_period_key,p_currency,draft);
 INSERT INTO public.planning_command_receipts(space_id,request_id,command,fingerprint,actor_id,result) VALUES(p_space_id,p_request_id,'initialize_period_plan',fingerprint,actor,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb) TO authenticated;
