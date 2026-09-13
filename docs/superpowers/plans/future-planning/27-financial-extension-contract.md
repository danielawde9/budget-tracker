# 27 — Financial event extension integration contract

**Layer:** DB prerequisite audit. **Depends on:** 02. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Deliverable and files

Create `docs/verification/future-planning/27.md` and
`tests/db/financial-extension-classification.integration.test.ts`. Verify current
kind allowlists, posting/immutability triggers, reverse command, report SQL,
`docs/financial-command-inventory.md` and gateway shape ratchets. This is a DB test/contract step with the narrow read helper below; it does not
implement the future event kinds.

## Shared financial extension rules

Tasks28…34 each add only their named command. Preserve generic record_financial_event
allowlist; it must reject specialised kinds with malformed legs. Do not add a
client-supplied balance, arbitrary loan posting or bypass RPC. New enum values
belong in a separate earlier timestamped migration from SQL executed using the
value; replay each migration in its own transaction through the real harness.

Every new event has journal request replay, positive15digit inputs, server actor/
audit, same-space references and exact immutable economic facts. Extend reverse
and shape validators to append inverse financial legs and domain facts atomically.
The reverse event gets its own effective date. Never flip a signed inverse twice.
Update every affected report/category/cash/loan/goal/recurring classification in
the **same DB task**, not later UI. An exhaustive event-kind classification test
must fail on an unclassified enum value. Every gateway is independently gated on
that DB task's evidence and then35's relevant slice.

Lock audit is mandatory: existing exchange locks USD then LBP; reversal original
event then loan then wallets. Do not introduce wallet→loan order. For two-wallet
new commands, choose one canonical UUID order and forward-align every overlapping
old exchange/transfer/undo path before shipping, proving no inversion. Merely
sorting the new command while the old one retains another order is insufficient.
Receipt lookup precedes lifecycle/head checks; exact replay after wallet archive
returns original if actor still authorized. New money commands use actor-aware
fingerprints and prevent another actor replaying a request as their own.

## Classification matrix to encode as a test table

| Kind/fact | Ordinary income | Ordinary expense | Cash | Loan principal |
| --- | --- | --- | --- | --- |
| salary/income | signed income |0|movement|0|
| ordinary expense |0|signed expense|movement|0|
| transfer/exchange |0|0|each currency leg|0|
| loan opening |0|0|cash opening if present|signed opening|
| repayment |0|0|payment/collection|signed reduction|
| cash adjustment |0|0|difference|0|
| mixed purchase |0|explicit expense component|paid/change legs|0|
| linked refund |0|negative original-category amount|cash received|0|
| forgiveness |0|0|0|reduction|
| inverse |inverse original income|inverse original expense|inverse legs|inverse posting|

Test original and inverse in same month and separate months for each implemented
kind. For not-yet-implemented kinds store planned fixtures separately from enum
exhaustiveness; do not add runtime kinds merely to make future rows compile.
Preserve old seeded balances/digests before/after migrations. Catalog test proves
PUBLIC/anon/service_role cannot EXECUTE the new commands.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.

## Missing journal reconciliation read

Source search at this planning baseline found no financial-command lookup RPC.
Add `_financial_command_lookup.sql` in this task with this member/actor-scoped read,
then prove same actor, other actor, removed member, missing request and PUBLIC ACL
cases in the named integration test. No money posting occurs here.

```sql
create function public.find_financial_command(p_space_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog set statement_timeout='10s' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if v_actor is null or p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501',message='planning_not_authorized';
  end if;
  if p_request_id is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  select jsonb_build_object('eventId',id,'kind',kind)
  into v_result from public.financial_events
  where space_id=p_space_id and request_id=p_request_id and actor_id=v_actor;
  return v_result;
end; $$;
revoke all on function public.find_financial_command(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.find_financial_command(uuid,uuid) to authenticated;
```

A matching receipt is returned only to its actor; another authorized member gets
null. A conflicting foreign request still rejects inside the posting command.
Do not infer “not committed” from a transport error while performing this lookup.
