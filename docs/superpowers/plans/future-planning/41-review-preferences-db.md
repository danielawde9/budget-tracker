# 41 — Review acknowledgements and insight dismissals

**Layer:** DB. **Depends on:** 03,37. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Table and exact commands

Create `_member_review_state.sql`, `tests/db/member-review-state.integration.test.ts`.
`member_review_events`: id bigint identity PK,space_id uuid,member_id uuid,
issue_kind text CHECK uncategorized/overspent/overdue/goal_shortage/pace,
period_start date,entity_id uuid nullable,source_head text1…128,
action acknowledge/dismiss/restore,expected_event_id bigint nullable,audit.
Stream(space,member,issue_kind,period_start,entity identity including NULL).
Use NULLS NOT DISTINCT unique key if supported by pinnedengine, otherwise explicit
normalized entity key generated COALESCE(entity_id,zeroUUID) and reject zeroUUID
real entity. Verify actual PG version in harness before choosing syntax. Crossrow
validator verifies entity belongs tospace for given kind. Self-only writes/reads;
owner cannot browse another member's acknowledgements. Common immutable guards.

`save_review_state(p_space_id uuid,p_request_id uuid,p_issue_kind text,
p_period_start date,p_entity_id uuid,p_source_head text,p_action text,
p_expected_event_id bigint)` →{eventId}.
`member_review_state(p_space_id uuid,p_period_start date,p_limit int)` →{rows};
limit≤100, return overflow explicitly if more than100 current issue keys ratherthan
silent truncation. RowissueKind,periodStart,entityId,sourceHead,action,eventId.
sourceHead is a dependency fingerprint from report DTO; does not authorize an
amount mutation. Acknowledgement applies only to exact fact head and week/month.
New fact head becomes visible without deleting old acknowledgement. No lastSeen
cursor that accidentally acknowledges facts never shown on a laterpage.

Tests memberA cannotread/writeB state, restore after dismiss, new source head reappears,
NULL entity head uniqueness, forged entity space, equal timestamporder, no ledger digest
change. Expose stable SQLSTATE errors matching01 and no raw tableaccess.

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
