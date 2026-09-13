# 18 — Cash-Control gateway implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Implement the exact typed application boundary for cash-control.
**Layer:** gateway/hooks only. **Depends on:** [17-available-cash-db.md](17-available-cash-db.md).
**Architecture:** injected abortable RPC transport, explicit DTO validation and
request-stable mutations. **Tech Stack:** existing TypeScript/Vitest/Supabase.

## Owned files

Create `src/features/cash-control/types.ts`, `supabase-cash-control-gateway.ts`,
`supabase-cash-control-gateway.test.ts`, `use-cash-control.ts`,
`use-cash-control.test.tsx`, `errors.ts`, `src/test/in-memory-cash-control-gateway.ts`.
Update only necessary client composition in `src/lib/supabase.ts`, preserving
existing interfaces, and decisions/evidence18. No SQL or visible screen edit.

## Task 1 — Freeze DTOs and request mapping before implementation

Read the exact return fields and discriminators in [17-available-cash-db.md](17-available-cash-db.md) and mutation
payloads in [17-available-cash-db.md](17-available-cash-db.md); copy those definitions into `types.ts` as
readonly interfaces and discriminated unions. These files are the authoritative
field lists, not an invitation to infer fields from screenshots. Use
`CashControlGateway` with these exact methods (camelCase input → p_snake_case SQL args):

| Method | RPC | Input fields |
| --- | --- | --- |
| `loadAvailable` | `available_cash_summary` | `spaceId,currency,asOfDate` |
| `loadOutlook` | `cash_outlook` | `spaceId,currency,startDate,days,scenario` |

Read-only gateway. Preserve signed shortage, unavailable reasons, asOf, currency and scenario assumptions. Forecast points are not posted wallet balances. A server arithmetic/coverage error fails the response; never replace it with a positive default allowance.

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
const monetaryFixture = { cashMinor: '100000', availableMinor: '-10000', spendableMinor: '0', deficitMinor: '10000', state: 'ready' };
```

In the typed parser test use a complete fixture, then assert:

```ts
expect(result.availableMinor).toBe('-10000');
expect(result.spendableMinor).toBe('0');
```

Also test bigint `9007199254740993` as string is preserved; the equivalent unsafe
number is rejected. Reject null required strings, invalid enums, duplicate
rows, out-of-range limits, invalid leap dates, and another space's stale response.

## Task 3 — Read-only hook recovery

State union: loading, ready, error. Capture space/currency/date/scenario and a
request generation for each read; abort and discard stale responses when selection
changes. Retain confirmed data only for its matching scope. Membership loss clears
visible data. A failed read can retry once with the same parameters; no mutation
receipt or request UUID is involved. Changing a scenario creates no journal row.

Use deferred promises to prove stale response rejection, fake timers for the
15-second abort, exact component-sum fixtures, and unavailable/null guide cases.
No saving/accepted/ambiguous financial states or phantom writer methods are added
to this read-only gateway. Test daily extra guide1001/3→333 and signed deficit.

## Task 4 — Verify and commit

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/cash-control
pnpm typecheck
pnpm test:ui
pnpm build
git diff --check
```

Require all relevant tests pass, no new direct `.insert/.update/.delete/.upsert`
inside these gateways, and no money converted through floating-point amounts.
Commit `feat(cash-control): add typed command gateway` with decisions and
`docs/verification/future-planning/18.md`. Stop before its UI task.
