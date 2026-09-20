-- Server-side journal search (register X4): one bounded, keyset-paged read
-- over already-RLS-protected journal tables. The function stays security
-- invoker so the caller's space membership remains the isolation boundary.

-- Date-ordered scans keep their index shape; the millisecond-truncated keyset
-- ordering sorts at runtime because timestamptz truncation is not immutable.
-- A supporting expression index is a measured-performance follow-up.
create index financial_events_space_keyset_idx
  on public.financial_events (space_id, effective_date desc, created_at desc, id desc);

drop index public.financial_events_space_date_idx;

create function public.journal_search_page(
  p_space_id uuid,
  p_from date default null,
  p_to date default null,
  p_wallet_id uuid default null,
  p_root_category_id uuid default null,
  p_payee_id uuid default null,
  p_min_amount_minor bigint default null,
  p_max_amount_minor bigint default null,
  p_query text default null,
  p_cursor text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  space_id uuid,
  request_id uuid,
  kind public.financial_event_kind,
  effective_date date,
  actor_id uuid,
  reversal_of uuid,
  created_at timestamptz
)
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_parts text[];
  v_cursor_date date;
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_query text;
  v_limit integer;
begin
  v_limit := coalesce(p_limit, 50);
  if v_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_from is not null and p_to is not null
    and (p_from > p_to or p_to - p_from > 366) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_query := nullif(pg_catalog.btrim(p_query), '');
  if v_query is not null and pg_catalog.char_length(v_query) > 120 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_query is not null then
    v_query := lower(v_query);
  end if;

  if p_cursor is not null then
    v_parts := pg_catalog.string_to_array(p_cursor, '|');
    if v_parts is null or pg_catalog.array_length(v_parts, 1) <> 3 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    begin
      v_cursor_date := v_parts[1]::date;
      v_cursor_created := v_parts[2]::timestamptz;
      v_cursor_id := v_parts[3]::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end;
  end if;

  return query
  select event.id, event.space_id, event.request_id, event.kind,
         event.effective_date, event.actor_id, event.reversal_of, event.created_at
  from public.financial_events as event
  where event.space_id = p_space_id
    and (p_from is null or event.effective_date >= p_from)
    and (p_to is null or event.effective_date <= p_to)
    and (v_cursor_date is null
      or (event.effective_date, date_trunc('milliseconds', event.created_at), event.id)
         < (v_cursor_date, date_trunc('milliseconds', v_cursor_created), v_cursor_id))
    and (p_wallet_id is null or exists (
      select 1 from public.wallet_movements as movement
      where movement.event_id = event.id
        and movement.space_id = event.space_id
        and movement.wallet_id = p_wallet_id))
    and (p_payee_id is null or exists (
      select 1 from public.financial_event_descriptions as description
      where description.event_id = event.id
        and description.space_id = event.space_id
        and description.payee_id = p_payee_id))
    and (p_min_amount_minor is null or exists (
      select 1 from public.wallet_movements as movement
      where movement.event_id = event.id
        and movement.space_id = event.space_id
        and movement.amount_minor >= p_min_amount_minor))
    and (p_max_amount_minor is null or exists (
      select 1 from public.wallet_movements as movement
      where movement.event_id = event.id
        and movement.space_id = event.space_id
        and movement.amount_minor <= p_max_amount_minor))
    and (p_root_category_id is null or exists (
      select 1
      from public.financial_event_categories as association
      join public.categories as category
        on category.id = association.category_id
       and category.space_id = association.space_id
      left join public.categories as parent
        on parent.id = category.parent_category_id
       and parent.space_id = category.space_id
      where association.event_id = event.id
        and association.space_id = event.space_id
        and coalesce(parent.id, category.id) = p_root_category_id))
    and (v_query is null
      or exists (
        select 1
        from public.financial_event_descriptions as description
        left join public.payees as payee
          on payee.id = description.payee_id
         and payee.space_id = description.space_id
        where description.event_id = event.id
          and description.space_id = event.space_id
          and (
            position(v_query in lower(coalesce(description.note, ''))) > 0
            or position(v_query in lower(coalesce(payee.name, ''))) > 0
          ))
      or exists (
        select 1
        from public.wallet_movements as movement
        join public.wallets as wallet
          on wallet.id = movement.wallet_id
         and wallet.space_id = movement.space_id
        where movement.event_id = event.id
          and movement.space_id = event.space_id
          and position(v_query in lower(wallet.name)) > 0
      )
      or exists (
        select 1
        from public.financial_event_categories as association
        join public.categories as category
          on category.id = association.category_id
         and category.space_id = association.space_id
        left join public.categories as parent
          on parent.id = category.parent_category_id
         and parent.space_id = category.space_id
        where association.event_id = event.id
          and association.space_id = event.space_id
          and (
            position(v_query in lower(coalesce(category.name_en, ''))) > 0
            or position(v_query in lower(coalesce(category.name_ar, ''))) > 0
            or position(v_query in lower(coalesce(parent.name_en, ''))) > 0
            or position(v_query in lower(coalesce(parent.name_ar, ''))) > 0
          )
      ))
  order by event.effective_date desc, date_trunc('milliseconds', event.created_at) desc, event.id desc
  limit v_limit;
end;
$$;

revoke all on function public.journal_search_page(
  uuid, date, date, uuid, uuid, uuid, bigint, bigint, text, text, integer)
  from public, anon, service_role;

grant execute on function public.journal_search_page(
  uuid, date, date, uuid, uuid, uuid, bigint, bigint, text, text, integer)
  to authenticated;
