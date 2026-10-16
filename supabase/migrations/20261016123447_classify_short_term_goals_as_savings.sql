-- Defaults for newly created groups only. Persisted plan purposes, historical
-- versions and all money rows stay unchanged; explicit user choices win.
create or replace function budget.default_group_purpose(p_en text, p_ar text)
returns text language sql immutable set search_path = '' as $$
  select case when lower(trim(coalesce(p_en, ''))) in
    ('saving','savings','investment','investments','insurance','mazoot','mazout',
     'short-term goals','short term goals')
    or trim(coalesce(p_ar, '')) in
      ('الادخار','ادخار','التوفير','الاستثمار','الاستثمارات','التأمين','المازوت','مازوت','الأهداف قصيرة المدى')
    then 'savings' else 'expense' end
$$;
