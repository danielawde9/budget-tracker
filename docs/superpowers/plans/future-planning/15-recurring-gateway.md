# 15 — Recurring gateway implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Implement the exact typed application boundary for recurring.
**Layer:** gateway/hooks only. **Depends on:** [14-recurring-db.md](14-recurring-db.md).
**Architecture:** injected abortable RPC transport, explicit DTO validation and
request-stable mutations. **Tech Stack:** existing TypeScript/Vitest/Supabase.

## Owned files

Create `src/features/recurring/types.ts`, `supabase-recurring-gateway.ts`,
`supabase-recurring-gateway.test.ts`, `use-recurring.ts`,
`use-recurring.test.tsx`, `errors.ts`, `src/test/in-memory-recurring-gateway.ts`.
Update only necessary client composition in `src/lib/supabase.ts`, preserving
existing interfaces, and decisions/evidence15. No SQL or visible screen edit.

## Task 1 — Freeze DTOs and request mapping before implementation

Read the exact return fields and discriminators in [14-recurring-db.md](14-recurring-db.md) and mutation
payloads in [14-recurring-db.md](14-recurring-db.md); copy those definitions into `types.ts` as
readonly interfaces and discriminated unions. These files are the authoritative
field lists, not an invitation to infer fields from screenshots. Use
`RecurringGateway` with these exact methods (camelCase input → p_snake_case SQL args):

| Method | RPC | Input fields |
| --- | --- | --- |
| `loadOccurrences` | `scheduled_occurrence_page` | `spaceId,fromDate,toDate,afterDueDate,afterId,limit` |
| `saveSchedule` | `save_schedule` | `spaceId,requestId,scheduleId,expectedRevisionId,definition` |
| `materialize` | `materialize_schedule_occurrences` | `spaceId,requestId,fromDate,toDate` |
| `setOccurrenceState` | `set_occurrence_state` | `spaceId,requestId,occurrenceId,expectedEventId,action` |
| `confirm` | `confirm_scheduled_occurrence` | `spaceId,requestId,occurrenceId,expectedEventId,actualAmountMinor,effectiveDate,walletId` |
| `linkExisting` | `link_scheduled_payment` | `spaceId,requestId,occurrenceId,eventId,amountMinor,expectedEventId` |
| `findCommand` | `find_planning_command` | `spaceId,requestId` |

Schedule amount is expected intent; occurrence unpaid amount is derived from exact settlement links and reversals. Never post because the app rendered a due row. Confirmation timeout reconciles the planning receipt and returned financial event ID. Partial payments keep a remaining amount. Overdue derives from business date, not a mutable flag.

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
const monetaryFixture = { expectedMinor: '50000', settledMinor: '20000', remainingMinor: '30000', state: 'partial' };
```

In the typed parser test use a complete fixture, then assert:

```ts
expect(result.remainingMinor).toBe('30000');
expect(result.state).toBe('partial');
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
pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring
pnpm typecheck
pnpm test:ui
pnpm build
git diff --check
```

Require all relevant tests pass, no new direct `.insert/.update/.delete/.upsert`
inside these gateways, and no money converted through floating-point amounts.
Commit `feat(recurring): add typed command gateway` with decisions and
`docs/verification/future-planning/15.md`. Stop before its UI task.
