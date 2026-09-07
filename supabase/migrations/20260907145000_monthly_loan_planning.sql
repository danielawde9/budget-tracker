create table public.loan_monthly_target_revisions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  loan_id uuid not null,
  request_id uuid not null,
  request_fingerprint bytea not null,
  target_month date not null,
  target_minor bigint not null check (target_minor >= 0),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (loan_id, space_id) references public.loans (id, space_id) on delete restrict,
  unique (space_id, request_id)
);

create index loan_monthly_target_revisions_lookup_idx
  on public.loan_monthly_target_revisions (loan_id, target_month, created_at desc, id desc);

alter table public.loan_monthly_target_revisions enable row level security;

create policy loan_monthly_target_revisions_read_for_members
  on public.loan_monthly_target_revisions
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create function private.parse_nonnegative_minor_amount(p_amount_minor text)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_amount_minor is null or p_amount_minor !~ '^(0|[1-9][0-9]{0,14})$' then
    raise exception using
      errcode = 'P0001',
      message = 'amount must be a nonnegative integer minor-unit value within the allowed bound';
  end if;

  return p_amount_minor::bigint;
end;
$$;

create function public.set_loan_monthly_target(
  p_space_id uuid,
  p_request_id uuid,
  p_loan_id uuid,
  p_month date,
  p_target_minor text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target_month date := date_trunc('month', p_month)::date;
  v_target_minor bigint;
  v_direction public.loan_direction;
  v_outstanding_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  v_target_minor := private.parse_nonnegative_minor_amount(p_target_minor);
  v_fingerprint := extensions.digest(
    'loan_monthly_target|' || p_loan_id::text || '|' || v_target_month::text || '|'
      || p_target_minor,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select revision.request_fingerprint, revision.id
  into v_existing_fingerprint, v_existing_id
  from public.loan_monthly_target_revisions as revision
  where revision.space_id = p_space_id
    and revision.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_id;
    return;
  end if;

  select loan.direction
  into v_direction
  from public.loans as loan
  where loan.id = p_loan_id
    and loan.space_id = p_space_id
  for update;

  if not found or v_direction <> 'i_owe_them' then
    raise exception using errcode = 'P0001', message = 'monthly repayment targets are available only for loans I owe';
  end if;

  select coalesce(sum(posting.principal_delta_minor), 0)
  into v_outstanding_minor
  from public.loan_postings as posting
  where posting.loan_id = p_loan_id;

  if v_target_minor > v_outstanding_minor then
    raise exception using errcode = 'P0001', message = 'the monthly target cannot exceed outstanding principal';
  end if;

  insert into public.loan_monthly_target_revisions (
    space_id, loan_id, request_id, request_fingerprint, target_month, target_minor, actor_id
  )
  values (
    p_space_id, p_loan_id, p_request_id, v_fingerprint, v_target_month, v_target_minor, v_actor_id
  )
  returning loan_monthly_target_revisions.id into v_existing_id;

  return query select v_existing_id;
end;
$$;

create function public.loan_monthly_plan(
  p_space_id uuid,
  p_month date
)
returns table (
  loan_id uuid,
  currency public.currency_code,
  direction public.loan_direction,
  target_minor bigint,
  actual_repayment_minor bigint,
  remaining_reservation_minor bigint,
  due_amount_minor bigint,
  expected_collection_minor bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_next_month date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  with latest_target as (
    select distinct on (revision.loan_id)
      revision.loan_id,
      revision.target_minor
    from public.loan_monthly_target_revisions as revision
    where revision.space_id = p_space_id
      and revision.target_month = v_month
    order by revision.loan_id, revision.created_at desc, revision.id desc
  ),
  actual_repayments as (
    select
      posting.loan_id,
      coalesce(sum(posting.repayment_effect_minor), 0)::bigint as actual_repayment_minor
    from public.loan_postings as posting
    join public.financial_events as event on event.id = posting.event_id
    where posting.space_id = p_space_id
      and event.effective_date >= v_month
      and event.effective_date < v_next_month
    group by posting.loan_id
  )
  select
    loan.id,
    loan.currency,
    loan.direction,
    coalesce(target.target_minor, 0)::bigint,
    greatest(coalesce(actual.actual_repayment_minor, 0), 0)::bigint,
    greatest(
      coalesce(target.target_minor, 0) - greatest(coalesce(actual.actual_repayment_minor, 0), 0),
      0
    )::bigint,
    case
      when loan.due_date >= v_month and loan.due_date < v_next_month then balance.outstanding_minor
      else 0
    end::bigint,
    case when loan.direction = 'they_owe_me' then balance.outstanding_minor else 0 end::bigint
  from public.loans as loan
  join public.loan_balances as balance on balance.loan_id = loan.id
  left join latest_target as target on target.loan_id = loan.id
  left join actual_repayments as actual on actual.loan_id = loan.id
  where loan.space_id = p_space_id;
end;
$$;

revoke all on table public.loan_monthly_target_revisions from anon, authenticated;
grant select on table public.loan_monthly_target_revisions to authenticated;
revoke all on function private.parse_nonnegative_minor_amount(text) from public;
revoke all on function public.set_loan_monthly_target(uuid, uuid, uuid, date, text) from public;
revoke all on function public.loan_monthly_plan(uuid, date) from public;
grant execute on function public.set_loan_monthly_target(uuid, uuid, uuid, date, text) to authenticated;
grant execute on function public.loan_monthly_plan(uuid, date) to authenticated;
