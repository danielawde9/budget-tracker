# Future planning implementation packets

> **Superseded execution instructions:** Start with [the separate actionable task files](future-planning/00-start-here.md).
> The [coverage map](future-planning/40-roadmap-coverage.md) routes every roadmap ID.
> Keep this older packet for rationale; use the new task's exact schema/RPC contract
> when details differ. No implementation or database application occurred here.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> when a packet is explicitly requested. Use superpowers:systematic-debugging
> for any failure and superpowers:test-driven-development for implementation.
> No delegation or multi-agent work is implied by this document.

**Goal:** Add editable income allocation, clear actual comparisons, and
short-/long-term goals with milestones through narrow, verifiable milestones.

**Architecture:** Preserve the immutable money journal. Add revisioned planning
relations and protected RPCs, then typed application boundaries, then scoped UI.
One packet owns one layer. The SQL/code below defines algorithms and contracts;
it is design material, not a migration to execute wholesale.

**Tech stack:** Existing TypeScript/React/Vite/CSS, Supabase PostgreSQL, pnpm,
Vitest and Playwright. Repository `.nvmrc` is `22.22.0`, package manager is
`pnpm@11.17.0` at baseline `59af39a`. Verify the current lockfile at execution.
No new runtime package is selected. Before any version-scoped dependency claim,
use Context7 if available; if unavailable, report that and verify primary docs
or pinned source rather than inventing API behavior.

**Status:** detailed proposed handoff for later implementation. Owner has
requested planning only in this session. No packet is marked implemented or
approved here. Read the [allocation spec](../specs/2026-09-13-income-allocation-and-daily-control-design.md),
[goals spec](../specs/2026-09-13-goals-and-milestones-design.md), and
[master](../../product/2026-09-13-future-planning-master.md) before execution.

## 0. Execution protocol for every packet

- [ ] Read current `AGENTS.md`, relevant decisions, command inventory, git status
  and current packet prerequisites. Capture starting SHA and source inventory.
- [ ] Establish one isolated implementation branch/worktree after informing the
  owner of its bounded purpose; preserve unrelated staged/untracked files.
  Documentation in this planning session needs no extra worktree or database.
- [ ] Record requested layer and approved defaults. A future request to implement
  the named packet authorizes its listed edits. It does not authorize adjacent
  packets, production SQL, push, deployment, seed data or external sends.
- [ ] Write the named failing cases first, run the focused command, inspect the
  failure, implement the specified contract, rerun focused tests, and commit the
  green step with a conventional commit and its decisions entry.
- [ ] Run the broader layer checks once when focused tests pass. Add a packet
  completion record with actual command outputs and limitations.

Do not rename gateways or move source folders to bypass
`scripts/check-private-uat-scope.sh`. It is a historical release-freeze check;
new DB/gateway work needs an explicitly scoped successor release baseline and
scope contract. Preserve the old rehearsal's meaning. The September 12 Control
Room plan's filename workaround is not inherited by this package. If a required
gate actually blocks the requested scope, explain its exact source and resolve
the release boundary before changing protected code.

### Commands used by these packets

Run from the repository root, with the authoritative ignored `.env.test` only
after verifying it targets the dedicated Budget development/test environment.
Never print its values, use production, or access the Sandooq stack. The
disposable migration harness already exists in `tests/db/disposable-database.ts`.
Reuse it instead of creating another lifecycle mechanism.

```bash
pnpm install --frozen-lockfile
```

Focused DB example (replace the named test file only with that packet's exact
file; use the same environment-loading form):

```bash
bash -c 'set -euo pipefail; set -a; source ./.env.test; set +a; pnpm exec vitest run tests/db/planning-projections.integration.test.ts --pool=forks --no-file-parallelism'
```

Layer completion:

```bash
# DB: existing package check includes ops, typecheck, DB, Worker, UI and build.
bash -c 'set -euo pipefail; set -a; source ./.env.test; set +a; pnpm check'
# Gateway/UI (when database shape is unchanged in that packet):
pnpm typecheck
pnpm test:ui
pnpm build
# UI packet also runs the focused Playwright file and the required full suite.
pnpm test:e2e
git diff --check
```

Expected: exit 0 and every applicable test passed. Record actual counts, not
counts copied from old plans. Infrastructure failures are Blocked, not Pass;
use the documented Docker bridge when that test suite requires it. A browser
fixture pass is not authenticated database UAT. Do not apply new SQL to a shared
or hosted database as part of merely running this document's examples.

## V0 — reporting foundation verification, database layer

**Purpose:** prove the source contracts before allocation charts depend on them.
This is not a blanket refactor. Investigate each hypothesis before selecting a
minimal forward fix.

**Files:**

- Read: `supabase/migrations/20260912101000_monthly_budget_planning.sql`.
- Read: `supabase/migrations/20260912102000_reporting_read_models.sql`.
- Read: `supabase/migrations/20260910100000_subcategories_foundation.sql`.
- Read: `tests/db/monthly-budgeting.integration.test.ts`,
  `tests/db/financial-boundary-coverage.integration.test.ts`.
- Create: `tests/db/planning-projections.integration.test.ts`.
- Create only after a reproduced failure: a fresh timestamped migration ending
  `_planning_projection_contracts.sql`. Select its unused 14-digit UTC prefix
  at execution; never edit an applied file or pre-date another branch's work.
- Update: `docs/financial-command-inventory.md`, `docs/decisions.md` only for
  confirmed forward changes; add `docs/lessons/planning-projections.md` if a
  recurring defect pattern is established.

- [ ] Add a real-PostgreSQL test using `asUser`, `queryAsUser`, `databaseQuery`
  from `tests/db/test-database.ts`; setup a new synthetic space per case.
- [ ] Run the focused V0 command above and save the result for each hypothesis.
- [ ] If red, trace projection → association/movement → original command and
  auth context. Compare with existing loan/reversal tests. Change only the
  confirmed source boundary in a forward migration with defense-in-depth.
- [ ] Rerun the cases and the full DB completion check; commit
  `test(planning): verify report foundation contracts` or
  `fix(planning): correct verified report projection behavior` as appropriate.

Required cases and exact expected observations:

| Case | Expected |
| --- | --- |
| Categorized $50 expense + inverse reversal on same date | ordinary expense, category actual and root actual all `0` |
| $50 August expense reversed in September | August expense `5000`, September expense `-5000` |
| $100 income reversed on same date | income `0`; wallet delta `0` |
| Essentials root target $100, Grocery child expense $30 | root target `10000`, actual `3000`, remaining `7000`; overall spending `3000` |
| Attempt positive monthly target on a child | matches approved root-only contract; record any mismatch as a reproduced requirement gap |
| Call category-vs-budget as authenticated member | authorized read succeeds without granting direct writes or blanket SELECT |
| Call as outsider/removed member/anon/service_role without user capability | deny rather than return privileged data |
| Page with more than limit and equal created timestamps | returned cursor allows next page, no omitted or repeated roots; each currency row once |
| Explicit null limit or partial cursor | rejected; no unbounded query |
| Loan, transfer, opening and exchange fixtures | no ordinary income/expense contribution |

Test the already-inverse movement directly. The target arithmetic is:

```sql
-- Semantic kind determines the bucket; movement sign determines the net.
sum(m.amount_minor::numeric) filter (where semantic_kind = 'income')
-sum(m.amount_minor::numeric) filter (where semantic_kind = 'expense')
```

Those are separate SELECT expressions, not a subtraction of income and expense.
Join original kind/category for reversals with same-space predicates and preserve
the correction event's own effective date. Do not ship a UI sign workaround.

## A1 — allocation schema and RPCs, database layer

**Files:**

- Create fresh forward migrations ending `_allocation_plan_schema.sql` and
  `_allocation_plan_commands.sql`; schema before commands.
- Create `tests/db/allocation-planning.integration.test.ts` and
  `tests/db/allocation-migrations.integration.test.ts`.
- Modify the existing monthly setter definitions through the new migration only
  to participate in the common planning lock; preserve public signatures.
- Update command inventory and decisions with names, privileges, caps and the
  approved snapshot semantics.

### A1.1 — relation and privilege contract

- [ ] Translate every relation in allocation spec §4 into DDL, with composite
  tenant FKs, shape checks, referencing indexes, RLS and immutable guards.
  This skeleton pins the most error-prone parent shape:

```sql
create table public.allocation_month_snapshots (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  month_start date not null,
  currency public.currency_code not null,
  template_revision_id bigint not null,
  income_plan_revision_id bigint not null,
  base_income_minor bigint not null,
  expected_snapshot_id bigint,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, space_id, currency),
  unique (space_id, request_id),
  check (month_start = date_trunc('month', month_start)::date),
  check (base_income_minor between 0 and 999999999999999),
  foreign key (template_revision_id, space_id, currency)
    references public.allocation_template_revisions(id, space_id, currency)
    on delete restrict,
  foreign key (income_plan_revision_id, space_id)
    references public.monthly_budget_plan_revisions(id, space_id)
    on delete restrict,
  foreign key (expected_snapshot_id, space_id, currency)
    references public.allocation_month_snapshots(id, space_id, currency)
    on delete restrict
);
create index allocation_month_current_idx
  on public.allocation_month_snapshots(space_id, month_start, currency, id desc);
```

Create the referenced UNIQUE keys first. A deferred constraint trigger also
checks that the income revision matches month/currency/kind and snapshot base
amount, and that expected snapshot belongs to the same month. FK identity
alone cannot prove those fields. A partial publication must not pass commit.
Use a distinct `allocation_month_goal_lines` relation added by G1; A1 commitment
lines accept only `loan_pool`. Do not reserve an unenforced goal ID column.

- [ ] Add tests that grant INSERT inside a disposable transaction and attempt
  cross-space references, null discriminator fields, over-100% groups, child
  roots, wrong-currency snapshots and incomplete publications. Expect rejection.
- [ ] Test UPDATE, zero-row DELETE and TRUNCATE guards independently of ordinary
  API privileges; roll back temporary grants. Check effective EXECUTE for PUBLIC,
  anon, authenticated, service_role and every private helper.

### A1.2 — exact allocation and atomic publication

- [ ] Implement a bounded private allocation helper using numeric arithmetic.
  Given validated input `(group_id, basis_points, display_order)` including the
  residual row, the core query is:

```sql
with parts as (
  select group_id, display_order,
    floor(p_income_minor::numeric * basis_points / 10000) as base,
    mod(p_income_minor::numeric * basis_points, 10000) as fraction
  from validated_group_input
), ranked as (
  select *, row_number() over (
    order by fraction desc, display_order, group_id
  ) as remainder_rank,
  p_income_minor::numeric - sum(base) over () as units_left
  from parts
)
select group_id,
  (base + case when remainder_rank <= units_left then 1 else 0 end)::text
    as allocated_minor
from ranked order by display_order, group_id;
```

`validated_group_input` is the helper's local CTE produced from validated JSON
lines, plus the explicit residual row with `basis_points = 10000-sum(input)` and
display order 12. It is not a persistent table or an external dependency.
Use the fixed residual UUID `ffffffff-ffff-ffff-ffff-ffffffffffff`; reject it as
a user group ID. Publish the same order and amounts that preview returned.

- [ ] Implement commands in allocation spec §4 in its prescribed transaction
  order. Canonicalize parsed fields into `jsonb_build_object`/ordered arrays
  before digest; do not concatenate unescaped strings separated by `|`.
  Reject required NULL inputs before digest; use `IS DISTINCT FROM` on replay
  fingerprints and expected revision heads. Return money and revision IDs as
  text in API projections.
- [ ] Record `planning_command_receipts` with unique `(space_id,request_id)`,
  monotonic `sequence_id bigint identity UNIQUE`, command name, fingerprint,
  typed bounded result JSON, actor and server time. The result accommodates
  UUID entity IDs and bigint revision IDs without coercing one into the other.
- [ ] For category child requests derive a UUID from SHA-256 of canonical JSON
  `[parent_request_uuid, command_name, root_uuid]`, taking the first 16 bytes,
  setting UUID version bits to 8 and RFC variant bits to 10. SQL alone derives
  them; clients only send the parent UUID. Include a fixed test vector generated
  from the implementation and verify same input replay stability, distinct
  roots and command namespaces; do not claim random collision impossibility.
- [ ] Add every acceptance fixture in allocation spec §8, two-connection
  concurrent publish tests, and archive/member-removal races. Publication either
  commits the receipt + all plan revisions + snapshot or writes nothing.

### A1.3 — bounded reads and compatibility

- [ ] Return groups from the saved snapshot with latest actuals and explicit
  `child_plan_changed`; return category/head/history pages with complete cursors
  and `limit+1` lookahead. Aggregate the full filtered month in SQL, not a client
  page. Verify Unmapped and Uncategorized separately.
- [ ] Keep legacy manual mode read/write commands callable. Test saving a manual
  target after a snapshot marks it stale without corrupting saved history.
- [ ] Replay the journal into an empty disposable DB and into a copy seeded
  through the previous migration prefix, then apply the forward suffix. Use
  `tests/db/disposable-database.ts` and fail if prior row digests change.
- [ ] Run focused files, full DB completion checks, inspect staged scope, commit
  `feat(planning): add revisioned income allocation` with the ledger entry.

## A2 — allocation gateway and pure calculations, application layer

**Files:** create `src/features/allocation/types.ts`, `money-allocation.ts`,
`money-allocation.test.ts`, `supabase-allocation-gateway.ts`,
`supabase-allocation-gateway.test.ts`, `use-allocation.ts`,
`use-allocation.test.tsx`, `errors.ts`, and
`src/test/in-memory-allocation-gateway.ts`. No SQL or visible screen changes.

### A2.1 — exact preview implementation

- [ ] Add this algorithm and its tests. Input is already parsed integer basis
  points, canonical lowercase UUID, and unique display order 0…11; the gateway
  must validate those boundaries too. The helper owns numeric range and totals.

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
  if (groups.some((g) => !Number.isInteger(g.order) || g.order < 0 || g.order > 11
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

```ts
import { describe, expect, it } from 'vitest';
import { allocateIncome, residualId } from './money-allocation.js';
const weights = [
  { id: '00000000-0000-4000-8000-000000000001', order: 0, basisPoints: 5600 },
  { id: '00000000-0000-4000-8000-000000000002', order: 1, basisPoints: 2400 },
  { id: '00000000-0000-4000-8000-000000000003', order: 2, basisPoints: 2000 },
] as const;
describe('allocateIncome', () => {
  it('preserves every minor unit, including the residual row', () => {
    expect(allocateIncome('101', weights).map((row) => row.amountMinor))
      .toEqual(['57', '24', '20', '0']);
    expect(allocateIncome('200000', weights).map((row) => row.amountMinor))
      .toEqual(['112000', '48000', '40000', '0']);
  });
  it('supports an incomplete split', () => {
    expect(allocateIncome('100', weights.slice(0, 1))).toEqual([
      { id: weights[0].id, amountMinor: '56' },
      { id: residualId, amountMinor: '44' },
    ]);
  });
  it('rejects over-allocation and imprecise money', () => {
    expect(() => allocateIncome('1.50', weights)).toThrow();
    expect(() => allocateIncome('1', [{ ...weights[0], basisPoints: 10001 }])).toThrow();
  });
});
```

- [ ] Run `pnpm exec vitest run --config vitest.ui.config.ts src/features/allocation/money-allocation.test.ts`.
  Add deterministic bounded sweeps: incomes 0…1000, 12-group equal splits,
  max individual income, all-zero weights, one-unit ties and partial residual.
  Assert sum(output)=income and each group differs from its exact share by <1
  minor unit. Cross-check the same fixed cases against the SQL helper in A1.

### A2.2 — gateway, validation and request recovery

- [ ] Define immutable DTOs corresponding to every A1 projection, preserving
  `hasPlan`, null-versus-zero, currency, head tokens, signed amounts, and
  `childPlanChanged`. Use `AllocationGateway` with methods `loadMonth`,
  `loadCategoryPage`, `loadHistoryPage`, `saveTemplate`, `publishMonth`,
  `findCommand`; input fields map exactly to A1 RPC arguments.
- [ ] Build the gateway with the existing injected Supabase-client pattern and
  explicit boundary parsers. Money accepts integer strings or safe integer JSON
  numbers only, normalizing to canonical strings; reject unsafe numbers.
  Validate UUIDs, real Gregorian month/date, discriminators and caps on both
  requests and responses. Current package has no Zod dependency; do not import
  an absent library. Explicit parsers are the documented default, consistent
  with current gateways. Adopting Zod requires its normal dependency decision.
- [ ] Add a 15-second abortable network bound and cancellation on space/month
  change. Preserve original request+payload after an ambiguous write. A timeout
  does not mean rejection. `findCommand` success → read-only refresh; absent →
  explicit retry with same UUID; changed draft → new UUID after ambiguity resolves.
- [ ] Test stale response from space A after switching to B, unsafe money,
  incomplete cursor, 101-row response, unknown group purpose, zero income,
  stale revisions, membership loss, identical retry and post-success read failure.
- [ ] Run focused gateway/hook tests, then gateway layer completion checks;
  commit `feat(planning): add typed allocation gateway`.

## A3 — setup and comparisons, UI layer

**Files:** create `src/features/allocation/allocation-setup.tsx`,
`allocation-month-editor.tsx`, `allocation-overview.tsx`, `allocation-bars.tsx`,
`allocation.css`, matching `.test.tsx` files, and
`e2e/allocation.visual.spec.ts`. Extend the current Plan/Home route composition
only after verifying whether the Control Room implementation now exists.
If absent, request the narrowly scoped route integration under its approved
IA; do not implement that entire redesign as a side effect.

- [ ] Add tests for setup skipped/empty/existing categories, custom 56% split,
  root mappings, incomplete split, incompatible child sums and stale editor.
- [ ] Implement the allocation spec's six-step setup with a summary before save.
  Persist only via `AllocationGateway`; all local preview values derive from
  `allocateIncome`. Month change never auto-copies or automatically publishes.
- [ ] Render the §6 metrics with their exact labels and denominators, plus the
  §7 bars. Use `formatMinorAmount` from `src/features/wallets/money.ts`.
  The chart is a pure view of returned monetary strings, never a new actuals
  calculator over the loaded wallet journal.
- [ ] Add drilldowns with complete cursor requests, empty/uncategorized states,
  signed corrections, incomplete-data errors and preserved last confirmed values.
  Do not display B2 available-after-commitments until its read contract exists.
- [ ] Run `pnpm exec playwright test e2e/allocation.visual.spec.ts`, then the
  UI completion commands. Visually inspect 320/390/768/1440px, EN/AR RTL,
  keyboard, 200% zoom, reduced motion, over-100% bars and zero targets.
- [ ] Commit `feat(planning): add income allocation workspace` and record
  synthetic UI proof separately from authenticated UAT and deployment.

## G1 — goals and milestones, database layer

**Files:** new timestamped migrations ending `_goals_and_milestones.sql`,
`_goal_earmark_commands.sql`, `_goal_planning_projections.sql`;
`tests/db/goals.integration.test.ts`, `goal-earmarks.integration.test.ts`,
`goal-migrations.integration.test.ts`. Update command inventory and decisions.
No edits to financial posting signatures or wallet balance storage.

- [ ] Implement all relations and constraints in goals spec §4, including G1's
  separate `allocation_month_goal_lines`. Add explicit composite UNIQUE keys
  before FKs. Add max active/relevant-goal checks under planning locks.
- [ ] Implement all §5 command signatures using A1 receipts and authorization.
  A unified goal-history projection uses cursor `(created_at, source_kind,
  source_id)` over command receipts and linked financial reversals, all three
  required together; `source_id` is a stable canonical text identity. Query one
  record per command/event with bounded nested lines, never multiply history
  rows by joins and then paginate the multiplied result.
- [ ] Implement earmark line shape and sums with deferred triggers, plus signed
  fulfillment from original/inverse expense movements. Validate effective
  nonnegative balances in chronological `(effective_date,created_at,id)` order
  where linking historical expense could affect earlier state. Reject such a
  link if it would make any intermediate earmark negative. Aggregate/cursor
  bounds and statement timeout apply to the database work, not just HTTP.
- [ ] Implement coverage using a window over **all relevant goals**, then page:

```sql
with ordered as (
  select goal_id, remaining_earmark_minor,
    coalesce(sum(remaining_earmark_minor::numeric) over (
      order by priority, created_at, goal_id
      rows between unbounded preceding and 1 preceding
    ), 0) as prior_earmarks
  from relevant_goal_balances
)
select goal_id,
  least(remaining_earmark_minor::numeric,
    greatest(p_cash_pool_minor::numeric - prior_earmarks, 0))::text
    as covered_minor
from ordered;
```

`relevant_goal_balances` is a bounded private projection/CTE derived from goal
heads, signed earmark lines and effective fulfillment. `p_cash_pool_minor` is
calculated from same-space, same-currency journal movements through today in
the same SQL statement snapshot. It is never an RPC input supplied by a browser.

- [ ] Implement milestone state and deadline suggestion:

```sql
-- Positive remaining and positive months_remaining already validated.
ceil(remaining_minor::numeric / months_remaining)::text
```

`months_remaining = 12*(deadline_year-current_year) + deadline_month-current_month + 1`.
Do not divide days by 30. Overdue and no-date branches return labelled states,
not a fabricated amount/date. Rank amount checkpoints by threshold and derive
their current state from eligible progress; checklist state uses its event head.

- [ ] Add every goals §7 acceptance case plus authorization, null-shape,
  maximum amount, duplicate command, stale head, two-client reserve/release,
  multi-goal transfer rollback, expense-link ceiling and concurrent reverse/link.
- [ ] Prove planning commands leave financial_events, wallet_movements and
  loan_postings counts and digests unchanged. Prove purchase linking does not
  add a second ordinary expense. Verify empty/seeded upgrades and full checks;
  commit `feat(goals): add milestone and earmark planning ledger`.

## G2 — goals application boundary, gateway layer

**Files:** `src/features/goals/types.ts` (spec DTOs),
`supabase-goals-gateway.ts`, `supabase-goals-gateway.test.ts`, `use-goals.ts`,
`use-goals.test.tsx`, `goal-calculations.ts`, `goal-calculations.test.ts`,
`errors.ts`, `src/test/in-memory-goals-gateway.ts`.

- [ ] Define `GoalsGateway` methods matching each G1 public RPC; response
  types distinguish earmarked, covered, fulfilled, shortage and monthly targets.
- [ ] Implement explicit validators and request reconciliation exactly as A2;
  G1 is authoritative for saved/progress values. The frontend can preview
  contribution/monthly arithmetic but cannot overwrite balances.
- [ ] Add pure calculation tests for calendar months, leap-day deadlines,
  ceiling rounding, positive-only forecast, target reduction, null coverage,
  milestone deduplication, percentage >100 and closed-restored goal states.
- [ ] Add gateway/hook tests for two-connection-equivalent stale heads, mixed
  currencies, absent optional names, invalid checklist amount, duplicate links,
  unsafe bigint, timeout after accepted mutation and space switch.
- [ ] Run focused files then gateway completion checks; commit
  `feat(goals): add typed goals application boundary`.

## G3 — goals interface, UI layer

**Files:** `src/features/goals/goals-page.tsx`, `goal-detail.tsx`,
`goal-editor.tsx`, `goal-milestones.tsx`, `goal-funding-dialog.tsx`,
`goal-purchase-dialog.tsx`, `goals.css`, matching tests, and
`e2e/goals.visual.spec.ts`. Scoped integration in the current Plan route;
reuse existing transaction picker/read gateway for eligible expenses only.

- [ ] Implement list/filter/detail and create/edit with the goal spec's types,
  horizons, statuses, deadlines, milestone editor and monthly-plan preview.
- [ ] Implement reserve/release/move review dialogs with clear “Planning
  allocation; wallet balances stay the same” copy and explicit underfunded
  acknowledgement when the server preview requires it. Refresh after accepted
  actions and show coverage changes across affected goals.
- [ ] Implement goal-purchase linking against existing posted eligible expenses;
  no duplicate expense creation. If recording a new purchase is offered, the
  existing transaction flow completes first, then linking is a recoverable
  separate action with its own request receipt.
- [ ] Exercise the complete journey in goals spec §8 including unexpected
  spending, shortfall, release/reprioritize, fulfillment and reversal. Verify
  all milestone states, paused/closed-restored states, a 1-LBP target and very
  large balances in EN/AR, keyboard, mobile/desktop and error recovery.
- [ ] Run focused Playwright, UI completion checks, and record visual versus
  authenticated UAT evidence separately; commit `feat(goals): add goals and milestones workspace`.

## B/C/R packets — controlled continuation

B1 recurring drafts, B2 available cash/outlook, C1 copy/rollover and R1 wider
daily tooling are in the [technical register](../../product/2026-09-13-remaining-roadmap-technical-register.md).
They have architecture, invariants and acceptance gates; they need a dedicated
packet spec before code. Do not pretend a register row supplies a complete
recurring-payment or rollover implementation. A/G are the detailed immediate
handoff; speculative E items remain research-gated so no smaller model invents
financial behavior on its own.

## Definition of ready for a smaller-model implementation request

The owner has selected the packet and accepted its product defaults. The
executor has checked current source against `59af39a`, prerequisites have
actual completion evidence, and affected interfaces are frozen in that packet's
contract. Date-specific migration prefixes are chosen at execution to avoid
collisions; all suffixes and purposes above are fixed. If a source signature
has changed, update the packet contract and its tests before implementation.

Use this prompt, replacing only the packet identifier:

> Implement packet A1 from
> `docs/superpowers/plans/2026-09-13-future-planning-implementation.md`.
> This authorizes only that packet's layer and listed scope. Read its linked
> specifications, current decisions and command inventory; verify prerequisites
> against current source. Preserve existing journal/auth/loan behavior. Write
> failing tests, implement the specified contracts, run the packet's required
> checks, and commit each green step with the decisions entry. Do not implement
> another packet, rewrite applied SQL, bypass release gates, access production,
> seed accounts, push, deploy or send messages. Report exact local evidence and
> any unmet prerequisite. Use the documented defaults; ask only when the required
> choice changes scope or cannot be resolved from the approved specification.

## Planning-package review checklist

- [ ] Source assumptions are refreshed by V0 rather than treated as
  established live defects.
- [ ] Percentages, allocation groups, root categories, actuals and goal funding
  have one consistent definition across SQL, DTOs and charts.
- [ ] A test case proves every invariant rejects the invalid state.
- [ ] Two members cannot overwrite each other's revisions or overconsume a
  purchase link through racing requests.
- [ ] A transfer, exchange, loan, plan change or goal earmark never masquerades
  as ordinary income/spending.
- [ ] All previous roadmap IDs have a destination or explicit research gate.
- [ ] Approval, code existence, verification, deployment and UAT are separate.
