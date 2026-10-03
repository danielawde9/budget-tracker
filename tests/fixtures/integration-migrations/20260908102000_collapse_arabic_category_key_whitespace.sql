create or replace function private.arabic_category_key(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select coalesce(
    private.canonical_category_name(
      pg_catalog.regexp_replace(
        pg_catalog.translate(
          private.canonical_category_name(p_value),
          'آأإىة',
          'ااايه'
        ),
        '[ؐ-ؚـً-ٰٟۖ-ۭ]',
        '',
        'g'
      )
    ),
    ''
  );
$$;

alter table public.categories disable trigger categories_guard_archive_update;

do $$
declare
  v_batch_count integer;
begin
  for v_batch_number in 1..1000 loop
    with batch as (
      select category.id
      from public.categories as category
      where category.name_ar is not null
        and category.name_ar_key is distinct from private.arabic_category_key(category.name_ar)
      order by category.id
      limit 1000
    )
    update public.categories as category
    set name_ar = category.name_ar
    from batch
    where category.id = batch.id;

    get diagnostics v_batch_count = row_count;
    exit when v_batch_count = 0;
  end loop;

  if exists (
    select 1
    from public.categories as category
    where category.name_ar is not null
      and category.name_ar_key is distinct from private.arabic_category_key(category.name_ar)
    limit 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Arabic category key recomputation exceeded the one-million-row migration bound';
  end if;
end;
$$;

alter table public.categories enable trigger categories_guard_archive_update;

revoke all on function private.arabic_category_key(text)
from public, anon, authenticated, service_role;
