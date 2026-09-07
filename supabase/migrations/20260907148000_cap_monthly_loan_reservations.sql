create or replace function public.loan_monthly_plan(
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
    least(
      greatest(
        coalesce(target.target_minor, 0) - greatest(coalesce(actual.actual_repayment_minor, 0), 0),
        0
      ),
      balance.outstanding_minor
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
