-- Enforce opening-assignment affordability at the journal boundary, including
-- privileged maintenance callers that use the internal line-writing helpers.
-- Only future inserts fire this deferred guard; existing rows are untouched.
create function budget.guard_opening_assignment_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_minor < 0
     and exists (select 1 from budget.items i where i.id = new.item_id and i.kind = 'ready')
     and exists (select 1 from budget.entries e where e.id = new.entry_id and e.kind = 'opening_assign') then
    -- Match public money commands' serialization and check the complete entry
    -- after every line has been inserted, including all later dated balances.
    perform budget.lock_space(new.space_id);
    perform budget.assert_ready_not_deepened(new.entry_id, new.space_id);
  end if;
  return null;
end;
$$;

create constraint trigger opening_assignment_ready_guard
  after insert on budget.item_lines
  deferrable initially deferred
  for each row
  execute function budget.guard_opening_assignment_ready();

revoke all on function budget.guard_opening_assignment_ready() from public, anon, authenticated, service_role;
