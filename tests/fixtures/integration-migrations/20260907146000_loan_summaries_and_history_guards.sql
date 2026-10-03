create function public.loan_monthly_currency_summary(
  p_space_id uuid,
  p_month date
)
returns table (
  currency public.currency_code,
  owed_to_me_minor bigint,
  i_owe_minor bigint,
  due_amount_minor bigint,
  planned_repayment_minor bigint,
  actual_repayment_minor bigint,
  remaining_reservation_minor bigint,
  expected_collection_minor bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select
    plan.currency,
    coalesce(sum(case when plan.direction = 'they_owe_me' then balance.outstanding_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then balance.outstanding_minor else 0 end), 0)::bigint,
    coalesce(sum(plan.due_amount_minor), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.target_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.actual_repayment_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.remaining_reservation_minor else 0 end), 0)::bigint,
    coalesce(sum(plan.expected_collection_minor), 0)::bigint
  from public.loan_monthly_plan(p_space_id, p_month) as plan
  join public.loan_balances as balance on balance.loan_id = plan.loan_id
  group by plan.currency;
end;
$$;

create function private.reject_posted_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'posted financial history is immutable';
end;
$$;

create trigger financial_events_reject_history_row_mutation
before update or delete on public.financial_events
for each row execute function private.reject_posted_history_mutation();

create trigger financial_events_reject_history_truncate
before truncate on public.financial_events
for each statement execute function private.reject_posted_history_mutation();

create trigger wallet_movements_reject_history_row_mutation
before update or delete on public.wallet_movements
for each row execute function private.reject_posted_history_mutation();

create trigger wallet_movements_reject_history_truncate
before truncate on public.wallet_movements
for each statement execute function private.reject_posted_history_mutation();

create trigger loans_reject_history_row_mutation
before update or delete on public.loans
for each row execute function private.reject_posted_history_mutation();

create trigger loans_reject_history_truncate
before truncate on public.loans
for each statement execute function private.reject_posted_history_mutation();

create trigger loan_postings_reject_history_row_mutation
before update or delete on public.loan_postings
for each row execute function private.reject_posted_history_mutation();

create trigger loan_postings_reject_history_truncate
before truncate on public.loan_postings
for each statement execute function private.reject_posted_history_mutation();

create trigger loan_monthly_target_revisions_reject_history_row_mutation
before update or delete on public.loan_monthly_target_revisions
for each row execute function private.reject_posted_history_mutation();

create trigger loan_monthly_target_revisions_reject_history_truncate
before truncate on public.loan_monthly_target_revisions
for each statement execute function private.reject_posted_history_mutation();

revoke all on function private.reject_posted_history_mutation() from public;
revoke all on function public.loan_monthly_currency_summary(uuid, date) from public;
grant execute on function public.loan_monthly_currency_summary(uuid, date) to authenticated;
