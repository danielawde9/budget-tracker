create type public.loan_direction as enum ('they_owe_me', 'i_owe_them');

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  direction public.loan_direction not null,
  person_name text not null check (char_length(btrim(person_name)) between 1 and 120),
  currency public.currency_code not null,
  effective_date date not null,
  due_date date,
  note text check (note is null or char_length(note) <= 2_000),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (due_date is null or due_date >= effective_date),
  unique (id, space_id)
);

create index loans_space_direction_currency_idx
  on public.loans (space_id, direction, currency);

create table public.loan_postings (
  event_id uuid primary key,
  loan_id uuid not null,
  space_id uuid not null,
  principal_delta_minor bigint not null check (principal_delta_minor <> 0),
  repayment_effect_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  foreign key (event_id, space_id)
    references public.financial_events (id, space_id) on delete restrict,
  foreign key (loan_id, space_id)
    references public.loans (id, space_id) on delete restrict
);

create index loan_postings_loan_event_idx on public.loan_postings (loan_id, event_id);
create index loan_postings_space_idx on public.loan_postings (space_id);

create view public.loan_balances
with (security_invoker = true)
as
select
  loan.id as loan_id,
  loan.space_id,
  loan.direction,
  loan.currency,
  coalesce(sum(posting.principal_delta_minor), 0)::bigint as outstanding_minor
from public.loans as loan
left join public.loan_postings as posting on posting.loan_id = loan.id
group by loan.id, loan.space_id, loan.direction, loan.currency;

alter table public.loans enable row level security;
alter table public.loan_postings enable row level security;

create policy loans_read_for_members
  on public.loans
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create policy loan_postings_read_for_members
  on public.loan_postings
  for select
  to authenticated
  using ((select private.is_active_member(space_id)));

create function private.parse_positive_minor_amount(p_amount_minor text)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,14}$' then
    raise exception using
      errcode = 'P0001',
      message = 'amount must be a positive integer minor-unit value within the allowed bound';
  end if;

  return p_amount_minor::bigint;
end;
$$;

create function private.lock_financial_request(
  p_space_id uuid,
  p_request_id uuid
)
returns void
language sql
volatile
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended(p_space_id::text || ':' || p_request_id::text, 0));
$$;

create function public.open_loan_outstanding(
  p_space_id uuid,
  p_request_id uuid,
  p_direction public.loan_direction,
  p_person_name text,
  p_currency public.currency_code,
  p_amount_minor text,
  p_effective_date date,
  p_due_date date default null,
  p_note text default null
)
returns table (loan_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_amount_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_loan_id uuid;
  v_existing_event_id uuid;
  v_loan_id uuid;
  v_event_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using
      errcode = '42501',
      message = 'an active space membership is required';
  end if;

  if char_length(btrim(p_person_name)) not between 1 and 120
    or (p_note is not null and char_length(p_note) > 2_000)
    or (p_due_date is not null and p_due_date < p_effective_date) then
    raise exception using errcode = 'P0001', message = 'the loan details are invalid';
  end if;

  v_amount_minor := private.parse_positive_minor_amount(p_amount_minor);
  v_fingerprint := extensions.digest(
    'loan_opening|' || p_direction::text || '|' || btrim(p_person_name) || '|'
      || p_currency::text || '|' || p_amount_minor || '|' || p_effective_date::text || '|'
      || coalesce(p_due_date::text, '') || '|' || coalesce(p_note, ''),
    'sha256'
  );

  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.request_fingerprint, posting.loan_id, event.id
  into v_existing_fingerprint, v_existing_loan_id, v_existing_event_id
  from public.financial_events as event
  join public.loan_postings as posting on posting.event_id = event.id
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_loan_id, v_existing_event_id;
    return;
  end if;

  insert into public.loans (
    space_id, direction, person_name, currency, effective_date, due_date, note, actor_id
  )
  values (
    p_space_id, p_direction, btrim(p_person_name), p_currency, p_effective_date,
    p_due_date, p_note, v_actor_id
  )
  returning id into v_loan_id;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (
    p_space_id, p_request_id, v_fingerprint, 'loan_opening', p_effective_date, v_actor_id
  )
  returning id into v_event_id;

  insert into public.loan_postings (
    event_id, loan_id, space_id, principal_delta_minor
  )
  values (v_event_id, v_loan_id, p_space_id, v_amount_minor);

  return query select v_loan_id, v_event_id;
end;
$$;

revoke all on table public.loans, public.loan_postings from anon, authenticated;
grant select on table public.loans, public.loan_postings to authenticated;
grant select on public.loan_balances to authenticated;

revoke all on function private.parse_positive_minor_amount(text) from public;
revoke all on function private.lock_financial_request(uuid, uuid) from public;
revoke all on function public.open_loan_outstanding(
  uuid, uuid, public.loan_direction, text, public.currency_code, text, date, date, text
) from public;
grant execute on function public.open_loan_outstanding(
  uuid, uuid, public.loan_direction, text, public.currency_code, text, date, date, text
) to authenticated;
