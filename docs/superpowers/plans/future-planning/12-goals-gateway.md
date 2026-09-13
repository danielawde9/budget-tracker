# 12 — Goals gateway implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Implement the exact typed application boundary for goals.
**Layer:** gateway/hooks only. **Depends on:** [11-goals-projections-db.md](11-goals-projections-db.md).
**Architecture:** injected abortable RPC transport, explicit DTO validation and
request-stable mutations. **Tech Stack:** existing TypeScript/Vitest/Supabase.

## Owned files

Create `src/features/goals/types.ts`, `supabase-goals-gateway.ts`,
`supabase-goals-gateway.test.ts`, `use-goals.ts`,
`use-goals.test.tsx`, `errors.ts`, `src/test/in-memory-goals-gateway.ts`.
Update only necessary client composition in `src/lib/supabase.ts`, preserving
existing interfaces, and decisions/evidence12. No SQL or visible screen edit.

## Task 1 — Freeze DTOs and request mapping before implementation

Read the exact return fields and discriminators in [11-goals-projections-db.md](11-goals-projections-db.md) and mutation
payloads in [10-goals-commands-db.md](10-goals-commands-db.md); copy those definitions into `types.ts` as
readonly interfaces and discriminated unions. These files are the authoritative
field lists, not an invitation to infer fields from screenshots. Use
`GoalsGateway` with these exact methods (camelCase input → p_snake_case SQL args):

| Method | RPC | Input fields |
| --- | --- | --- |
| `loadPage` | `goal_page` | `spaceId,currency,stateFilter,afterCreatedAt,afterId,limit` |
| `loadDetail` | `goal_detail` | `spaceId,goalId,month` |
| `loadHistory` | `goal_history_page` | `spaceId,goalId,beforeCreatedAt,beforeSourceKind,beforeSourceId,limit` |
| `create` | `create_goal_plan` | `spaceId,requestId,goalId,definition,milestones` |
| `revise` | `revise_goal_plan` | `spaceId,requestId,goalId,expectedRevisionId,definition,milestones,state` |
| `reserveOrRelease` | `record_goal_earmark` | `spaceId,requestId,goalId,action,amountMinor,expectedHead,acceptUnderfunded` |
| `move` | `move_goal_earmark` | `spaceId,requestId,fromGoalId,toGoalId,amountMinor,expectedFromHead,expectedToHead,acceptUnderfunded` |
| `reverse` | `reverse_goal_earmark` | `spaceId,requestId,eventId,expectedHeads` |
| `linkPurchase` | `link_goal_purchase` | `spaceId,requestId,expenseEventId,lines` |
| `setMonthlyTarget` | `set_goal_monthly_target` | `spaceId,requestId,goalId,month,amountMinor,expectedRevisionId` |
| `setMilestone` | `set_goal_milestone_state` | `spaceId,requestId,milestoneId,action,expectedEventId` |
| `findCommand` | `find_planning_command` | `spaceId,requestId` |

Keep earmarked, covered, fulfilled, shortage, monthly contribution and lifetime target as distinct fields. A 64-hex funding head is not a bigint definition revision. A goal with null coverage is unknown, not zero. Preserve restored closed goals with needsReview. G1 introduces publish_allocation_month_v2: add an explicit v2 gateway method and typed goalTargets, never ambiguously choose an overloaded RPC.

Each method accepts an optional AbortSignal for reads. Persist no credentials
in hook state/localStorage. Distinguish command receipt acceptance from a failed
subsequent read. Do not expose a generic arbitrary-RPC method to screen code.

## Task 2 — Explicit validation and transport

Reuse the shared parser/transport specified in task 07; first implementation
creates it, later gateways import it without copying divergent money logic.
Parsers accept unknown, return a checked type, reject duplicate IDs and unknown
variants, and normalize safe integer numbers to canonical money strings.
Validate full ISO dates by calendar roundtrip, complete cursor tuples, caps
from SQL, exact currency and head-token formats. Unknown required money is an
error, never `0`. Do not cast a JSON object to the DTO without validation.

Add boundary fixtures including this monetary subset within a complete valid
response from the linked DB contract:

```ts
const monetaryFixture = { earmarkedMinor: '30000', coveredMinor: '10000', shortageMinor: '20000', fulfilledMinor: '0', needsReview: true };
```

In the typed parser test use a complete fixture, then assert:

```ts
expect(result.coveredMinor).toBe('10000');
expect(result.shortageMinor).toBe('20000');
```

Also test bigint `9007199254740993` as string is preserved; the equivalent unsafe
number is rejected. Reject null required strings, invalid enums, duplicate
rows, out-of-range limits, invalid leap dates, and another space's stale response.

## Task 3 — Hook state/recovery

State union: loading, ready, saving, accepted-refresh-pending, ambiguous, error.
Ready includes last confirmed data. Each read carries captured space/month and
a request generation; abort and discard stale responses when either changes.
Mutations capture an immutable payload and one UUID. Accepted receipt → refresh
only. Timeout → lookup receipt; absent permits explicit same-payload/same-UUID
retry. Changing a draft while ambiguous is disabled until reconciliation.
Membership loss clears the space's data and delegates to existing workspace recovery.

Use fake timers for the 15-second abort, deferred promises for stale-response
race, and an in-memory fake that tracks UUID/payload equality and revision heads.
Fakes never substitute for the DB acceptance suite. Assert one RPC on accepted
mutation followed by failed refresh, not two postings.

## Task 4 — Verify and commit

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/goals
pnpm typecheck
pnpm test:ui
pnpm build
git diff --check
```

Require all relevant tests pass, no new direct `.insert/.update/.delete/.upsert`
inside these gateways, and no money converted through floating-point amounts.
Commit `feat(goals): add typed command gateway` with decisions and
`docs/verification/future-planning/12.md`. Stop before its UI task.
