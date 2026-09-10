alter table public.categories
  add column parent_category_id uuid,
  add constraint categories_parent_not_self_check
    check (parent_category_id is null or parent_category_id <> id),
  add constraint categories_parent_space_kind_fkey
    foreign key (parent_category_id, space_id, kind)
    references public.categories (id, space_id, kind)
    on delete restrict;

create index categories_parent_fk_idx
  on public.categories (parent_category_id, space_id, kind)
  where parent_category_id is not null;

create index categories_active_hierarchy_idx
  on public.categories (space_id, kind, parent_category_id, created_at, id)
  where archived_at is null;

alter table public.category_command_requests
  drop constraint category_command_requests_command_kind_check,
  add constraint category_command_requests_command_kind_check
    check (command_kind in (
      'create_category',
      'create_subcategory',
      'archive_category'
    ));

create function private.validate_category_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_parent_archived_at timestamptz;
  v_parent_parent_id uuid;
begin
  if new.parent_category_id is null then
    return new;
  end if;

  select category.archived_at, category.parent_category_id
  into v_parent_archived_at, v_parent_parent_id
  from public.categories as category
  where category.id = new.parent_category_id
    and category.space_id = new.space_id
    and category.kind = new.kind
  limit 1
  for key share;

  if not found or v_parent_archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'the parent category must be an active root in the requested space and kind';
  end if;

  if v_parent_parent_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'subcategory depth is limited to one level';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_category_parent()
  from public, anon, authenticated, service_role;

create trigger categories_validate_parent_insert
before insert on public.categories
for each row execute function private.validate_category_parent();

create function public.create_subcategory(
  p_space_id uuid,
  p_request_id uuid,
  p_parent_category_id uuid,
  p_name_en text,
  p_name_ar text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_name_en text;
  v_name_ar text;
  v_fingerprint bytea;
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_category_id uuid;
  v_category_id uuid;
  v_parent_kind public.category_kind;
  v_parent_archived_at timestamptz;
  v_parent_parent_id uuid;
  v_constraint_name text;
begin
  if p_space_id is null or p_request_id is null or p_parent_category_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'space, request ID, and parent category are required';
  end if;

  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  v_name_en := private.canonical_category_name(p_name_en);
  v_name_ar := private.canonical_category_name(p_name_ar);

  if (v_name_en is null and v_name_ar is null)
    or (v_name_en is not null and pg_catalog.char_length(v_name_en) > 120)
    or (v_name_ar is not null and pg_catalog.char_length(v_name_ar) > 120)
    or (v_name_en is not null and pg_catalog.btrim(private.english_category_key(v_name_en)) = '')
    or (v_name_ar is not null and pg_catalog.btrim(private.arabic_category_key(v_name_ar)) = '') then
    raise exception using
      errcode = 'P0001',
      message = 'at least one bounded searchable category name is required';
  end if;

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'create_subcategory',
      'parentCategoryId', p_parent_category_id,
      'nameEn', v_name_en,
      'nameAr', v_name_ar
    )::text,
    'sha256'
  );

  select request.command_kind, request.request_fingerprint, request.category_id, category.id
  into v_existing_kind, v_existing_fingerprint, v_existing_category_id, v_category_id
  from public.category_command_requests as request
  left join public.categories as category
    on category.id = request.category_id
   and category.space_id = request.space_id
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;

  if found then
    if v_existing_kind is distinct from 'create_subcategory'
      or v_existing_fingerprint is distinct from v_fingerprint
      or v_existing_category_id is distinct from v_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_category_id;
    return;
  end if;

  select category.kind, category.archived_at, category.parent_category_id
  into v_parent_kind, v_parent_archived_at, v_parent_parent_id
  from public.categories as category
  where category.id = p_parent_category_id
    and category.space_id = p_space_id
  limit 1
  for update;

  if not found or v_parent_archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'the parent category must be an active root in the requested space and kind';
  end if;

  if v_parent_parent_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'subcategory depth is limited to one level';
  end if;

  begin
    insert into public.categories (
      space_id, kind, name_en, name_ar, parent_category_id, created_by
    )
    values (p_space_id, v_parent_kind, v_name_en, v_name_ar, p_parent_category_id, v_actor_id)
    returning categories.id into v_category_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name in ('categories_active_name_en_idx', 'categories_active_name_ar_idx') then
        raise exception using
          errcode = 'P0001',
          message = 'an active category already uses one of the supplied normalized names';
      end if;
      raise;
  end;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'create_subcategory', v_fingerprint, v_category_id, v_actor_id
  );

  return query select v_category_id;
end;
$$;

revoke all on function public.create_subcategory(uuid, uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.create_subcategory(uuid, uuid, uuid, text, text)
  to authenticated;

create or replace function private.guard_category_archive_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid
  limit 1;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  -- Stored generated keys are not computed yet in a BEFORE UPDATE trigger.
  -- Every other column except the one-way archive pair remains immutable.
  if old.archived_at is not null
    or old.archived_by is not null
    or new.archived_at is null
    or new.archived_by is null
    or (pg_catalog.to_jsonb(new) - array['archived_at', 'archived_by', 'name_en_key', 'name_ar_key'])
      is distinct from
      (pg_catalog.to_jsonb(old) - array['archived_at', 'archived_by', 'name_en_key', 'name_ar_key']) then
    raise exception using
      errcode = '42501',
      message = 'categories may only transition once from active to archived';
  end if;

  if new.parent_category_id is null and exists (
    select 1
    from public.categories as child
    where child.parent_category_id = old.id
      and child.space_id = old.space_id
      and child.kind = old.kind
      and child.archived_at is null
    limit 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'archive active subcategories before archiving their parent';
  end if;

  return new;
end;
$$;

create or replace function public.archive_category(
  p_space_id uuid,
  p_request_id uuid,
  p_category_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_fingerprint bytea;
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_category_id uuid;
  v_archived_at timestamptz;
  v_parent_category_id uuid;
  v_category_kind public.category_kind;
begin
  if p_space_id is null or p_request_id is null or p_category_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'space, request ID, and category are required';
  end if;

  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'archive_category',
      'categoryId', p_category_id
    )::text,
    'sha256'
  );

  select request.command_kind, request.request_fingerprint, request.category_id
  into v_existing_kind, v_existing_fingerprint, v_existing_category_id
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;

  if found then
    if v_existing_kind is distinct from 'archive_category'
      or v_existing_fingerprint is distinct from v_fingerprint
      or v_existing_category_id is distinct from p_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_category_id;
    return;
  end if;

  -- Match child creation's lock order: request first, then the parent/target row.
  select category.archived_at, category.parent_category_id, category.kind
  into v_archived_at, v_parent_category_id, v_category_kind
  from public.categories as category
  where category.id = p_category_id
    and category.space_id = p_space_id
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the category does not belong to the requested space';
  end if;

  if v_archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the category is already archived';
  end if;

  if v_parent_category_id is null and exists (
    select 1
    from public.categories as child
    where child.parent_category_id = p_category_id
      and child.space_id = p_space_id
      and child.kind = v_category_kind
      and child.archived_at is null
    limit 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'archive active subcategories before archiving their parent';
  end if;

  update public.categories
  set archived_by = v_actor_id,
      archived_at = now()
  where categories.id = p_category_id;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'archive_category', v_fingerprint, p_category_id, v_actor_id
  );

  return query select p_category_id;
end;
$$;
