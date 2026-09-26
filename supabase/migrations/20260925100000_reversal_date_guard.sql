-- A reversal cancels an earlier journal entry. Dating it before that entry
-- would move money into a period the original never touched (audit A2).
-- A trigger rather than a check inside reverse_financial_event, so every
-- present and future reversal path is covered. Existing rows are not
-- re-validated.
create function private.reject_reversal_before_original()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_original_date date;
begin
  select event.effective_date into v_original_date
  from public.financial_events as event
  where event.id = new.reversal_of;
  if v_original_date is not null and new.effective_date < v_original_date then
    raise exception using errcode = '23514', message = 'a reversal cannot be dated before the entry it reverses';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_reversal_before_original() from public, anon, authenticated, service_role;

create trigger financial_events_reversal_date_guard
before insert on public.financial_events
for each row
when (new.reversal_of is not null)
execute function private.reject_reversal_before_original();
