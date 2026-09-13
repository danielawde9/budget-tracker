# 07 — Allocation gateway implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Implement the exact typed application boundary for allocation.
**Layer:** gateway/hooks only. **Depends on:** [06-allocation-projections-db.md](06-allocation-projections-db.md).
**Architecture:** injected abortable RPC transport, explicit DTO validation and
request-stable mutations. **Tech Stack:** existing TypeScript/Vitest/Supabase.

## Owned files

Create `src/features/allocation/types.ts`, `supabase-allocation-gateway.ts`,
`supabase-allocation-gateway.test.ts`, `use-allocation.ts`,
`use-allocation.test.tsx`, `errors.ts`, `src/test/in-memory-allocation-gateway.ts`.
Update only necessary client composition in `src/lib/supabase.ts`, preserving
existing interfaces, and decisions/evidence07. No SQL or visible screen edit.

## Task 1 — Freeze DTOs and request mapping before implementation

Read the exact return fields and discriminators in [06-allocation-projections-db.md](06-allocation-projections-db.md) and mutation
payloads in [05-allocation-commands-db.md](05-allocation-commands-db.md); copy those definitions into `types.ts` as
readonly interfaces and discriminated unions. These files are the authoritative
field lists, not an invitation to infer fields from screenshots. Use
`AllocationGateway` with these exact methods (camelCase input → p_snake_case SQL args):

| Method | RPC | Input fields |
| --- | --- | --- |
| `loadMonth` | `allocation_month_state` | `spaceId,month,currency,snapshotId` |
| `loadCategoryPage` | `allocation_category_page` | `spaceId,month,currency,snapshotId,groupId,afterRootId,limit` |
| `loadHistoryPage` | `allocation_history_page` | `spaceId,month,currency,beforeId,limit` |
| `loadTrend` | `allocation_trend` | `spaceId,currency,firstMonth,monthCount` |
| `saveTemplate` | `save_allocation_template` | `spaceId,requestId,currency,expectedRevisionId,groups,rootMappings` |
| `publishMonth` | `publish_allocation_month` | `spaceId,requestId,month,currency,expectedSnapshotId,templateRevisionId,expectedIncomeRevisionId,incomeMinor,rootTargets,loanGroupId` |
| `findCommand` | `find_planning_command` | `spaceId,requestId` |

Preserve missing plan versus explicit zero, signed variance, complete category cursors, snapshot source heads and childPlanChanged. Do not recompute actuals from the loaded wallet page. Percent input has at most two decimal digits: 56.25 becomes 5625 bps. A sum below 10000 yields explicit unallocated; above10000 rejects.

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
const monetaryFixture = { snapshotId: '12', plannedIncomeMinor: '200000', actualIncomeMinor: '180000', expenseMinor: '161000', incomeAfterSpendingMinor: '19000', childPlanChanged: false };
```

In the typed parser test use a complete fixture, then assert:

```ts
expect(result.incomeAfterSpendingMinor).toBe('19000');
expect(result.plannedIncomeMinor).toBe('200000');
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
pnpm exec vitest run --config vitest.ui.config.ts src/features/allocation
pnpm typecheck
pnpm test:ui
pnpm build
git diff --check
```

Require all relevant tests pass, no new direct `.insert/.update/.delete/.upsert`
inside these gateways, and no money converted through floating-point amounts.
Commit `feat(allocation): add typed command gateway` with decisions and
`docs/verification/future-planning/07.md`. Stop before its UI task.

## Shared transport and parsers created by this task

Additional owned files: `src/features/planning-shared/rpc.ts`, `rpc.test.ts`,
`parse.ts`, `parse.test.ts`. Use this complete transport implementation:

```ts
export interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message: string } | null;
}
export interface RpcBuilder extends PromiseLike<RpcResult> {
  abortSignal(signal: AbortSignal): RpcBuilder;
}
export interface PlanningRpcClient {
  rpc(name: string, args: Record<string, unknown>): RpcBuilder;
}
export async function planningRpc(
  client: PlanningRpcClient,
  name: string,
  args: Record<string, unknown>,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (callerSignal?.aborted) cancel();
  callerSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15_000);
  try {
    const result = await client.rpc(name, args).abortSignal(controller.signal);
    if (result.error) throw result.error;
    return result.data;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
  }
}
```

The pinned local PostgREST transform builder was inspected and exposes
`abortSignal(signal)`. The existing `BudgetDataClient` abstraction currently
narrows RPC to a Promise, so extend its typed composition deliberately; do not
pretend every existing test double already implements abortSignal. New planning
fakes implement RpcBuilder, while old gateways keep their existing interfaces.

Complete core parsers:

```ts
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid response object.');
  }
  return value as Record<string, unknown>;
}
export function minor(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Unsafe money number.');
    return BigInt(value).toString();
  }
  if (typeof value !== 'string' || !/^(0|-?[1-9][0-9]{0,29})$/.test(value)) {
    throw new Error('Invalid money string.');
  }
  return BigInt(value).toString();
}
export function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Invalid date.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (value.startsWith('0000-') || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date.');
  }
  return value;
}
export function month(value: unknown): string {
  const result = date(value);
  if (!result.endsWith('-01')) throw new Error('Month must start on day one.');
  return result;
}
```

The aggregate parser cap is30 digits, while mutation inputs have the SQL
15-digit cap. Add `planningMoneyInput` validation for nonnegative/positive
mutation requirements before calling an RPC. Money formatting reuses the exact
BigInt implementation in `src/features/wallets/money.ts`, not the different
Loans formatter. Copy the complete `allocateIncome` implementation and tests
from the earlier packet plan's A2.1 into this feature, retaining its conservation
sweep; compare its outputs with task 05's SQL helper vectors.

Add parsers for each DTO field explicitly: object keys, string/null values,
UUID patterns, boolean flags, arrays with length cap, unique dimension keys,
and enum membership. Reject unknown enum values even if TypeScript casts compile.

## Exact pure allocation helper retained from A2.1

Create `src/features/allocation/money-allocation.ts` with this implementation.
Port the adjacent prior A2.1 tests, then add the edge fixtures listed above.

```ts
export interface AllocationWeight {
  readonly id: string;
  readonly order: number;
  readonly basisPoints: number;
}
export interface AllocatedAmount {
  readonly id: string;
  readonly amountMinor: string;
}
export const residualId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export function allocateIncome(
  incomeMinor: string,
  groups: readonly AllocationWeight[],
): readonly AllocatedAmount[] {
  if (!/^(0|[1-9][0-9]{0,14})$/.test(incomeMinor)) {
    throw new Error('Invalid nonnegative income.');
  }
  if (groups.length > 12) throw new Error('Too many allocation groups.');
  const ids = new Set(groups.map((group) => group.id));
  const orders = new Set(groups.map((group) => group.order));
  if (ids.size !== groups.length || orders.size !== groups.length || ids.has(residualId)) {
    throw new Error('Duplicate or reserved group identity/order.');
  }
  if (groups.some((g) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(g.id)
    || !Number.isInteger(g.order) || g.order < 0 || g.order > 11
    || !Number.isInteger(g.basisPoints) || g.basisPoints < 0 || g.basisPoints > 10000)) {
    throw new Error('Invalid allocation weight.');
  }
  const total = groups.reduce((sum, group) => sum + group.basisPoints, 0);
  if (total > 10000) throw new Error('Allocation exceeds 100 percent.');
  const income = BigInt(incomeMinor);
  const weights = [...groups, { id: residualId, order: 12, basisPoints: 10000 - total }];
  const parts = weights.map((group) => {
    const numerator = income * BigInt(group.basisPoints);
    return { ...group, base: numerator / 10000n, fraction: numerator % 10000n };
  });
  const remainder = Number(income - parts.reduce((sum, part) => sum + part.base, 0n));
  const ranked = [...parts].sort((a, b) => {
    if (a.fraction !== b.fraction) return a.fraction > b.fraction ? -1 : 1;
    return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const winners = new Set(ranked.slice(0, remainder).map((part) => part.id));
  return [...parts].sort((a, b) => a.order - b.order).map((part) => ({
    id: part.id, amountMinor: (part.base + (winners.has(part.id) ? 1n : 0n)).toString(),
  }));
}
```

Synthetic Unmapped/Uncategorized group rows intentionally have groupId NULL. Their
identity is rowKind, while real rows use groupId. Reject duplicate real IDs or
duplicate synthetic rowKind, not the two distinct synthetic rows merely because
both groupIds are null. Parse actualShareOfIncomeBps as signed integer text/null;
configured basisPoints remains a bounded number.

The month response may contain12 real groups plus2 synthetic groups; DTO cap is14.
Template input still caps real groups at12. Category pages contain actual category
root UUIDs only; uncategorized drilldown uses the journal's explicit filter.
