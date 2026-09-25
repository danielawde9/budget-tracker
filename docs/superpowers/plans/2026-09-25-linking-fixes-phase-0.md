# Linking fixes, phase 0: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task here is a **bug fix**. Follow superpowers:systematic-debugging: the red reproducer comes first, and you confirm the named root cause before changing anything. Then superpowers:test-driven-development. If a task's reproducer does **not** fail as described, stop and report. Do not "fix" working code.

**Goal:** Fix the audit's fix-now defects so that four things are right before payday periods are built:

- goal amounts
- undo dates
- month-2 allocation publishing
- "Available after commitments", Plan totals, and bill/salary/loan settlement

**Architecture:** Each task fixes one defect at one layer: a forward-only Postgres migration, or UI in its owning feature folder. Each is reproduced by a failing test first. UI fixes reuse the existing currency, date and command helpers. DB fixes add small, separately testable objects rather than rewriting large functions. No new dependencies.

**Tech Stack:** React 19, Vite, TypeScript strict, Vitest, Testing Library, Playwright. Supabase Postgres (plpgsql). Testcontainers, reached through `scripts/ops/docker-ssh-bridge.sh`.

**Spec:** `docs/verification/2026-09-25-linking-audit.md`. Finding IDs (A1, B1, C2, D3, E1, F1, O1 …) refer to it. Owner-approved order: phase 0 bugs → Spec 1 (one clock, payday periods, payday check-in) → Spec 2 (onboarding, redo setup).

## Global Constraints

- **Migrations:**
  - Forward-only. New files only, timestamps after `20260919100000`. Never edit an existing migration.
  - Never run `pnpm migrate:live`, never push, never deploy. Daniel runs releases.
- **Every task that adds a migration also updates the release files in the same commit:**
  1. `SOURCE_SHA=$(git rev-parse HEAD)` (the commit your task starts from).
  2. `bash scripts/ops/migrate-budget.sh create-manifest supabase/migrations ops/budget-migrations.sha256 "$SOURCE_SHA"`.
  3. Set `readonly LIVE_MANIFEST_SOURCE_SHA='<SOURCE_SHA>'` in `scripts/ops/apply-live-migrations.sh`, and set the matching `releaseHead` in `tests/ops/live-migrations.test.ts`.
  4. Add the new version literal(s) and one existence check per new object to `LIVE_VERIFY_SQL` in `scripts/ops/apply-live-migrations.sh`.
  5. Update the expected version count in `tests/ops/live-migrations.test.ts` (currently `toHaveLength(49)`).
  6. Run `pnpm exec vitest run tests/ops`. Expected: PASS.
- **Security-definer SQL:**
  - `set search_path = pg_catalog` (add `extensions` only if used).
  - `revoke all … from public, anon, authenticated, service_role`.
  - `grant execute … to authenticated` for public RPCs only.
  - Membership check through `private.is_active_member(p_space_id)` → `42501`.
- **Naming and comments:**
  - Trigger and constraint names must not end in `_check`, which collides with auto-named CHECKs (`tests/db/constraint-trigger-names-ratchet.test.ts`).
  - Inside public function bodies, never write `insert/update/delete/merge/truncate` followed by `categories` in a comment (`tests/db/subcategories-source-ratchet.test.ts`).
- **Money:**
  - Integer minor units, carried as strings or bigint. LBP has no minor unit (minor = major). USD has 2.
  - Convert only through `minorToMajorText` (`src/features/allocation/money-allocation.ts:33`), `parsePositiveMinorAmount` (`src/features/wallets/money.ts:10`) and `formatMinorAmount`.
- **UI:**
  - Copy through the file-local `t(locale, en, ar)` helper.
  - DB-sourced strings go in `<bdi>`. Use logical CSS properties and only `cr-*` classes (`docs/design-guidelines.md`).
  - A new visual pattern is added to `src/control-room.css` and recorded in `docs/design-guidelines.md` in the same commit.
- **No new clocks:** Nothing added by this plan may compare a browser-local date with a UTC "today" in a new place. Phase 1 (Spec 1) introduces the single space clock. Until then, reuse the existing helper of the code you are editing.
- **Code rules:**
  - No empty `catch`. No floating promises (prefix with `void` and end with `.catch`).
  - Every loop has a literal bound. Every RPC call goes through the feature's existing gateway.
- **Decisions ledger:** any behavior this plan chooses is appended to `docs/decisions.md` in the **same commit** (**Decision**, **Why**, **If changed**).
- **Commits:**
  - One commit per green task.
  - Conventional message ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage everything `git status` shows, tool state (`.swarm/`, `.claude-flow/`) included. Screen new files for secrets first.
  - Follow the confidentiality naming rule in the global `~/.claude/CLAUDE.md`: use the `b-<project-name>` placeholder, never the real name.
- **Running tests:**
  - DB tests need Docker: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run <file> --pool=forks --no-file-parallelism`. If the bridge prints a `login.tailscale.com` check URL and hangs, stop and ask Daniel to re-login to Tailscale.
  - UI tests: `pnpm exec vitest run --config vitest.ui.config.ts <file>`.
  - `pnpm test:db` already has failures on `main` (26 were recorded 2026-09-16). Task 0 records today's list; only failures that are *new* against it count.

## Review Focus

1. **Large and fractional money:** LBP amounts of 7+ digits and USD amounts with cents must round-trip unchanged through every edited form, not just goals. Pinned by Task 1's LBP/USD tests and its source ratchet.
2. **Beirut early morning:** from 00:00 to 03:00 the local date is a day ahead of UTC. Pinned by Task 2, whose Undo test uses the entry's own date and never "today".
3. **Second time through:**
   - a second month's allocation publish (Task 6)
   - a second payment against the same schedule (Task 9, "oldest unpaid instance")
   - a second page of categories (Task 8) or bills (Task 12)
4. **Look-alike bills:** two schedules with the same amount and category (two $10 subscriptions) must never auto-settle by guessing. Pinned by Task 9's ambiguity test.
5. **Household member vs outsider:** every new RPC is allowed for an active member and refused for an outsider. Pinned in Tasks 5, 7 and 11.

---

### Task 0: Isolated branch and recorded baseline

**Files:**
- Create: `docs/verification/2026-09-25-phase-0-baseline.md`

- [ ] **Step 1: Create the workspace.** Use superpowers:using-git-worktrees to create branch `fix/linking-phase-0` from `main`.
- [ ] **Step 2: Record the fast gates.**
  Run: `pnpm typecheck && pnpm test:ui && pnpm test:worker && pnpm build && pnpm exec vitest run tests/ops`
  Expected: all pass. If anything fails, stop and report. Do not fix unrelated failures.
- [ ] **Step 3: Record the DB baseline.**
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm test:db 2>&1 | tee "$TMPDIR/phase0-db.log"`
  Then list the failing tests: `grep -E "^ +(×|FAIL) " "$TMPDIR/phase0-db.log" | sort -u`
  Expected: roughly 26 failures in the goal-`TODAY` and household-planner tests. Paste the exact list into the baseline doc.
- [ ] **Step 4: Record Playwright.**
  Run: `pnpm test:e2e`
  Expected: `149 passed`, `51 skipped` (measured at `e149057`).
- [ ] **Step 5: Write the baseline doc** with the commit SHA, the command outputs' summary lines, and the failing-DB-test list. Commit:

```bash
git add -A
git commit -m "docs(verification): record phase-0 baseline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Goal amounts round-trip exactly through the goal editor (C2)

**Root cause (verified):** `goal-editor.tsx:146,163,170` turn stored minor units into input text with `BigInt(x) / 100n`. That is only right for USD, and even then it drops cents. Save parses correctly with `parsePositiveMinorAmount(text, currency)`. So every Edit, Pause or Close of an LBP goal saves 1/100 of its target, milestone thresholds and monthly amount. A USD goal with cents loses them.

**Files:**
- Modify: `src/features/goals/goal-editor.tsx:143-149` (`draftFromMilestone`), `:163` (`targetMajor`), `:170` (`monthlyMajor`), `:173` (milestones initializer)
- Test: `src/features/goals/goal-editor.test.tsx` (inside `describe('GoalEditor: revise')`)
- Create: `src/features/money-conversion-ratchet.test.ts`

**Interfaces:**
- Consumes: `minorToMajorText(amountMinor: string, currency: Currency): string` from `src/features/allocation/money-allocation.ts`.
- Produces: `draftFromMilestone(milestone: GoalMilestoneInput, currency: Currency): MilestoneDraft`. It stays internal to `goal-editor.tsx`.

- [ ] **Step 1: Write the failing tests.** Add them inside `describe('GoalEditor: revise', …)`, after the existing `walkToReview` helper:

```tsx
  it('keeps an LBP goal’s target, monthly amount and milestone exact when paused without edits', async () => {
    const onRevise = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g2', revisionId: '8' } });
    const lbp = {
      goalId: 'g2', expectedRevisionId: '7', currentState: 'active' as const,
      definition: {
        kind: 'reserve' as const, currency: 'LBP' as const, nameEn: 'Generator fund', nameAr: null, note: null,
        targetMinor: '90000000', deadline: null, contributionMode: 'manual_monthly' as const, monthlyAmountMinor: '4500000', priority: 0,
      },
      milestones: [{ id: 'm1', kind: 'amount' as const, labelEn: 'Half', labelAr: null, thresholdMinor: '45000000', dueDate: null }],
    };
    render(<GoalEditor {...baseProps()} mode="revise" existing={lbp} initialState="paused" onRevise={onRevise} />);
    await walkToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledTimes(1));
    const call = onRevise.mock.calls[0]![0];
    expect(call.definition).toMatchObject({ targetMinor: '90000000', monthlyAmountMinor: '4500000' });
    expect(call.milestones[0]).toMatchObject({ thresholdMinor: '45000000' });
  });

  it('keeps a USD goal’s cents when revised without edits', async () => {
    const onRevise = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '4' } });
    const cents = { ...existing, definition: { ...existing.definition, targetMinor: '600050', monthlyAmountMinor: '12345' } };
    render(<GoalEditor {...baseProps()} mode="revise" existing={cents} onRevise={onRevise} />);
    await walkToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ targetMinor: '600050', monthlyAmountMinor: '12345' }),
    })));
  });
```

  If TypeScript rejects the milestone literal, read `GoalMilestoneInput` in `src/features/goals/types.ts` and match its field names exactly. Do not loosen the assertion.

- [ ] **Step 2: Write the failing ratchet.** Create `src/features/money-conversion-ratchet.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const FEATURES = join(process.cwd(), 'src', 'features');
// A minor-unit value divided by 100n and printed is only right for USD;
// LBP has no minor unit. Use minorToMajorText / formatMinorAmount instead.
const CURRENCY_BLIND = /[Mm]inor[^;\n]*\/\s*100n\s*\)?\s*\.toString\(\)/;

function sourceFiles(dir: string, depth: number): string[] {
  if (depth > 4) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, depth + 1);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('money conversion ratchet', () => {
  it('never prints a minor-unit amount divided by 100n without its currency', () => {
    const offenders = sourceFiles(FEATURES, 0)
      .filter((path) => CURRENCY_BLIND.test(readFileSync(path, 'utf8')))
      .map((path) => relative(FEATURES, path));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both and watch them fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/goals/goal-editor.test.tsx src/features/money-conversion-ratchet.test.ts`
  Expected: FAIL.
  - The LBP test receives `targetMinor: '900000'`.
  - The USD test receives `targetMinor: '600000'`.
  - The ratchet lists `goals/goal-editor.tsx`.
- [ ] **Step 4: Fix the three pre-fills.** In `src/features/goals/goal-editor.tsx`:

```tsx
import { minorToMajorText } from '../allocation/money-allocation.js';

function draftFromMilestone(milestone: GoalMilestoneInput, currency: Currency): MilestoneDraft {
  return {
    id: milestone.id, kind: milestone.kind, labelEn: milestone.labelEn ?? '', labelAr: milestone.labelAr ?? '',
    thresholdMajor: milestone.thresholdMinor ? minorToMajorText(milestone.thresholdMinor, currency) : '',
    dueDate: milestone.dueDate ?? '',
  };
}
```

```tsx
  const [targetMajor, setTargetMajor] = useState(existing ? minorToMajorText(existing.definition.targetMinor, existing.definition.currency) : '');
```

```tsx
  const [monthlyMajor, setMonthlyMajor] = useState(existing?.definition.monthlyAmountMinor
    ? minorToMajorText(existing.definition.monthlyAmountMinor, existing.definition.currency)
    : '');
```

```tsx
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(() => (existing
    ? existing.milestones.map((milestone) => draftFromMilestone(milestone, existing.definition.currency))
    : []));
```

  If `Currency` isn't already imported in this file, add `import type { Currency } from '../loans/types.js';`.
- [ ] **Step 5: Run them green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/goals src/features/money-conversion-ratchet.test.ts && pnpm typecheck`
  Expected: PASS.
- [ ] **Step 6: Commit** (no ledger entry: pure bug fix):

```bash
git add -A
git commit -m "fix(goals): keep LBP and USD goal amounts exact when revising

Revising, pausing or closing an LBP goal saved 1/100 of its target,
milestones and monthly amount; USD goals lost their cents. A source
ratchet now fails on any currency-blind minor/100n conversion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Journal Undo reverses on the original entry's date (A2)

**Root cause (verified):**
- `routes.tsx:300` calls `wallets.reverseEvent({ eventId: id, effectiveDate: todayIso() })`. `todayIso()` is UTC today.
- `JournalScreen.onReverse(eventId)` (`journal-screen.tsx:71,121`) never passes the selected event's date.
- The approved behavior (ledger 2026-09-11) and `wallets/correction-dialog.tsx:29` both use the original `effectiveDate`.

**Files:**
- Modify: `src/features/control-room/journal-screen.tsx:71` (prop type), `:121` (call)
- Modify: `src/features/control-room/routes.tsx:300`
- Test: `src/features/control-room/journal-screen.test.tsx:171-178`; `src/features/control-room/routes.test.tsx` (new wiring test)

**Interfaces:**
- Produces: `onReverse(eventId: string, effectiveDate: string): Promise<unknown>` on `JournalScreenProps`.

- [ ] **Step 1: Write the failing tests.** In `journal-screen.test.tsx`, change the existing assertion at line 177 to the new contract. `event()` defaults to `effectiveDate: '2026-09-07'`:

```tsx
    expect(onReverse).toHaveBeenCalledWith('evt-1', '2026-09-07');
```

  In `routes.test.tsx`, add a wiring test. It seeds one old entry into the in-memory wallets gateway and asserts the gateway receives that entry's date:

```tsx
describe('ControlRoomRoutes journal undo', () => {
  it('reverses an entry on its own date, never on today', async () => {
    const user = userEvent.setup();
    const walletsGateway = new InMemoryWalletsGateway();
    walletsGateway.events = [{
      id: 'evt-old', spaceId: 'personal-space', requestId: 'req-old', kind: 'expense',
      effectiveDate: '2026-08-15', createdAt: '2026-08-15T09:00:00Z', reversalOf: null, reversedBy: null,
      loanLinked: false, payeeName: 'Market',
      movements: [{ walletId: walletsGateway.wallets[0]!.id, walletName: 'Cash', currency: 'USD', amountMinor: '-2500', walletArchived: false }],
    }];
    const reverse = vi.spyOn(walletsGateway, 'reverseEvent');
    renderHome(gateways({ wallets: walletsGateway }), { destination: 'journal' });
    await user.click(await screen.findByRole('button', { name: /Market/ }));
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-old', effectiveDate: '2026-08-15' })));
  });
});
```

  If `walletFixtures[0]` belongs to a different space than `'personal-space'`, add a wallet to `walletsGateway.wallets` with `spaceId: 'personal-space'`, copying the fixture's shape. Also check the list label: if a payee-labelled row reads differently, use the label `journal-screen.test.tsx` uses for `payeeName`.
- [ ] **Step 2: Run them and watch them fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/control-room/journal-screen.test.tsx src/features/control-room/routes.test.tsx -t "onReverse|own date"`
  Expected: FAIL.
  - `journal-screen` was called with `('evt-1')` only.
  - `routes` received `effectiveDate: <UTC today>`.
- [ ] **Step 3: Pass the date through.**

```tsx
// journal-screen.tsx — props
  onReverse(eventId: string, effectiveDate: string): Promise<unknown>;
// journal-screen.tsx — where the selected event is reversed (line ~121)
      await props.onReverse(selected.id, selected.effectiveDate);
```

```tsx
// routes.tsx:300
        onReverse={(id, effectiveDate) => wallets.reverseEvent({ eventId: id, effectiveDate })}
```

- [ ] **Step 4: Run them green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/control-room && pnpm typecheck`
  Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "fix(journal): undo reverses on the original entry's date

The Control Room journal dated every Undo 'today' in UTC, so undoing an
older mistake left its month overspent and credited the current month.
Restores the 2026-09-11 decision (Undo on the original date).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The schema refuses a reversal dated before its original (A2 defense in depth; O1)

**Why:** Task 2 fixes one caller, but three paths can still reverse: any future caller, the Wallets correction date field, and the loan reversal path. Only a schema rule makes an early date impossible. The same commit catches the release manifest up with the unlisted `20260919100000_journal_search_page.sql` (O1). It also adds the detector that would have caught O1.

**Files:**
- Create: `supabase/migrations/20260925100000_reversal_date_guard.sql`
- Create: `tests/db/reversal-date-guard.integration.test.ts`
- Create: `tests/ops/manifest-matches-journal.test.ts`
- Modify: `ops/budget-migrations.sha256`, `scripts/ops/apply-live-migrations.sh`, `tests/ops/live-migrations.test.ts` (Global Constraints release steps; the count goes 49 → 51)
- Modify: the wallets error map (`src/features/wallets/errors.ts`) plus its test. Map the new message to bilingual copy.
- Modify: `docs/decisions.md`, `docs/verification/2026-09-25-linking-audit.md` (mark O1 fixed)

- [ ] **Step 1: Write the failing DB test.** Create `tests/db/reversal-date-guard.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase,
  migrationFiles, replayMigrations, withAuthenticatedTransaction, type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_reversal_date');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(`insert into auth.users(id, email, email_confirmed_at) values ($1,'owner@budget.invalid', now())`, [actor]);
}, 120_000);

afterAll(async () => { if (database) await disposeDisposableDatabase(database); }, 30_000);

async function fixture(): Promise<{ spaceId: string; walletId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>("select id from public.create_space($1, 'personal') limit 2", [`Reversal ${randomUUID()}`]);
    const spaceId = space.rows[0]!.id;
    const wallet = await db().client.query<{ id: string }>("select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId]);
    return { spaceId, walletId: wallet.rows[0]!.id };
  });
}

async function recordExpense(spaceId: string, walletId: string, date: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: '5000' }])],
    );
    return event.rows[0]!.id;
  });
}

async function reverse(spaceId: string, eventId: string, date: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select * from public.reverse_financial_event($1,$2,$3,$4::date) limit 2', [spaceId, randomUUID(), eventId, date]));
}

describe('reversal date guard', () => {
  it('refuses a reversal dated before the entry it reverses', async () => {
    const { spaceId, walletId } = await fixture();
    const eventId = await recordExpense(spaceId, walletId, '2026-09-10');
    await expect(reverse(spaceId, eventId, '2026-09-09'))
      .rejects.toMatchObject({ code: '23514', message: 'a reversal cannot be dated before the entry it reverses' });
  });

  it('accepts a reversal on the original date or later', async () => {
    const { spaceId, walletId } = await fixture();
    const sameDay = await recordExpense(spaceId, walletId, '2026-09-10');
    const later = await recordExpense(spaceId, walletId, '2026-09-10');
    await expect(reverse(spaceId, sameDay, '2026-09-10')).resolves.toBeUndefined();
    await expect(reverse(spaceId, later, '2026-09-20')).resolves.toBeUndefined();
  });
});
```

  If `record_financial_event` rejects an uncategorized expense in this schema, use `record_categorized_financial_event` with a category from `create_category`, as in `tests/db/allocation-projections.integration.test.ts:66-81`.
- [ ] **Step 2: Write the failing manifest detector.** Create `tests/ops/manifest-matches-journal.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('release manifest', () => {
  it('lists every migration file in journal order with its current sha256', () => {
    const dir = join(root, 'supabase', 'migrations');
    const files = readdirSync(dir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
    const rows = readFileSync(join(root, 'ops', 'budget-migrations.sha256'), 'utf8')
      .trim().split('\n').filter((line) => /^\d{14}\|/.test(line));
    const expected = files.map((name) =>
      `${name.slice(0, 14)}|${name}|${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}`);
    expect(rows).toEqual(expected);
  });

  it('pins the same source SHA in the manifest and the live script', () => {
    const manifestSha = /^source_sha=([0-9a-f]{40})$/m.exec(readFileSync(join(root, 'ops', 'budget-migrations.sha256'), 'utf8'))?.[1];
    const scriptSha = /readonly LIVE_MANIFEST_SOURCE_SHA='([0-9a-f]{40})'/.exec(readFileSync(join(root, 'scripts', 'ops', 'apply-live-migrations.sh'), 'utf8'))?.[1];
    expect(manifestSha).toBeDefined();
    expect(manifestSha).toBe(scriptSha);
  });
});
```

- [ ] **Step 3: Run both and watch them fail.**
  Run: `pnpm exec vitest run tests/ops/manifest-matches-journal.test.ts`
  Expected: FAIL. The rows lack `20260919100000_journal_search_page.sql`.
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run tests/db/reversal-date-guard.integration.test.ts --pool=forks --no-file-parallelism`
  Expected: FAIL. The first test's promise resolves, because nothing is rejected yet.
- [ ] **Step 4: Write the migration.** Create `supabase/migrations/20260925100000_reversal_date_guard.sql`:

```sql
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
```

  Before committing, confirm the trigger name is unused. Temporarily add `select tgname from pg_trigger where tgrelid = 'public.financial_events'::regclass` to a scratch query in the test run, and remove it afterwards.
- [ ] **Step 5: Update the release files** (Global Constraints). The count goes to **51**: `20260919100000` plus `20260925100000`. `LIVE_VERIFY_SQL` gains both version literals, plus the existence check `exists (select 1 from pg_trigger where tgname = 'financial_events_reversal_date_guard')`.
- [ ] **Step 6: Give the new refusal friendly copy.** In `src/features/wallets/errors.ts`, map the message `a reversal cannot be dated before the entry it reverses` to:
  - EN: "Undo can't be dated before the entry it undoes. Pick the entry's date or later."
  - AR: "لا يمكن أن يسبق تاريخ التراجع تاريخ القيد الأصلي. اختر تاريخ القيد أو تاريخًا لاحقًا."

  Follow the file's existing mapping pattern, and add one test in `src/features/wallets/errors.test.ts` in that file's style.
- [ ] **Step 7: Run everything green.**
  Run: `pnpm exec vitest run tests/ops && bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run tests/db/reversal-date-guard.integration.test.ts tests/db/categories.integration.test.ts tests/db/available-cash.integration.test.ts --pool=forks --no-file-parallelism && pnpm exec vitest run --config vitest.ui.config.ts src/features/wallets`
  Expected: PASS, with no failures that are new against the Task 0 baseline.
- [ ] **Step 8: Ledger + audit.**
  - Append to `docs/decisions.md`: "Reversals may not be dated before the entry they reverse (schema trigger)".
    - **Why:** A2, plus layered defense.
    - **If changed:** a legitimate back-dated correction would need its own command.
    - Include this read-only query Daniel can run live before applying, to see whether existing rows already violate the rule:

      ```sql
      select count(*) from financial_events r join financial_events o on o.id = r.reversal_of where r.effective_date < o.effective_date;
      ```

  - Append a second entry: "Release manifest must list every migration (ops test)", covering O1.
  - In the audit doc, mark O1 and the A2 schema guard as fixed in this commit.
- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "fix(journal): refuse reversals dated before their entry; catch up the release manifest

Adds a BEFORE INSERT trigger on financial_events so no path can back-date
a reversal, and lists 20260919100000_journal_search_page in the release
manifest (verify-manifest would have refused the next live release with
'unmanifested migration file'). A new ops test fails whenever a migration
is missing from the manifest.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One occurrence window, generated automatically when Available needs it (D2)

**Root cause (verified):**
- `available_cash_summary` returns `incomplete` unless occurrences are generated through `today + 89` (`available_cash_projection.sql:305,323`).
- The only generate call covers `today + 60` (`routes.tsx:389-390`). The two tasks chose two windows (ledger 2704-2709 vs 2936-2946), with no shared contract.
- Generation is explicit-only, and the 89-day window moves daily. So even after a manual refresh, Available returns to `incomplete` whenever a new due date enters the window.

**Decision (ledger, this commit):**
- The Upcoming list, its Refresh, and an automatic generate all use one 89-day window, pinned to the SQL by a test.
- When Available reports `incomplete` with `unmaterializedCount > 0`, Home and Plan generate that window **once per space and day**, then reload.
- Generation is safe to repeat because occurrence ids are deterministic. This keeps the 2026-09-14 rule that "the button never generates a different range than what is on screen".

**Files:**
- Create: `src/features/recurring/occurrence-window.ts`, `src/features/recurring/occurrence-window.test.ts`
- Create: `src/features/recurring/use-auto-materialize.ts`, `src/features/recurring/use-auto-materialize.test.tsx`
- Modify: `src/features/control-room/routes.tsx:385-391` (Upcoming window) and the Home and Plan cash-summary mounts (the `CashControlSummary` render sites at `home-screen.tsx:83` via routes, and `routes.tsx:432`)
- Modify: `docs/decisions.md`

**Interfaces:**
- Produces:
  - `OCCURRENCE_WINDOW_DAYS = 89`
  - `occurrenceWindow(todayIso: string): { fromDate: string; toDate: string }`
  - `useAutoMaterialize(options: { gateway: RecurringGateway | null; spaceId: string; today: string; needed: boolean; onGenerated(): Promise<unknown> }): AutoMaterializeState`
  - `AutoMaterializeState = { status: 'idle' } | { status: 'running' } | { status: 'failed'; message: string }`

- [ ] **Step 1: Confirm repeats are harmless.** Read `materialize_schedule_occurrences` in `supabase/migrations/20260914170000_recurring_schedules.sql`. Also check `tests/db/recurring-schedules.integration.test.ts` for a test that materializes the same window twice with different request ids and gets no duplicates.
  - If that test exists, cite it in the ledger entry.
  - If it doesn't, add it there (red → it should already pass) before continuing.
  - If repeats **do** duplicate, stop and report: the automatic generate would be unsafe.
- [ ] **Step 2: Write the failing tests.** Create `src/features/recurring/occurrence-window.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OCCURRENCE_WINDOW_DAYS, occurrenceWindow } from './occurrence-window.js';

describe('occurrence window', () => {
  it('equals the horizon available_cash_summary requires', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const latest = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
      .filter((name) => /create (or replace )?function public\.available_cash_summary\(/.test(readFileSync(join(dir, name), 'utf8')))
      .at(-1);
    expect(latest).toBeDefined();
    expect(readFileSync(join(dir, latest!), 'utf8')).toContain(`v_horizon_end := v_today + ${OCCURRENCE_WINDOW_DAYS};`);
  });

  it('spans today through today + 89 days', () => {
    expect(occurrenceWindow('2026-09-25')).toEqual({ fromDate: '2026-09-25', toDate: '2026-12-23' });
  });
});
```

  Create `src/features/recurring/use-auto-materialize.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRecurringGateway } from '../../test/in-memory-recurring-gateway.js';
import { useAutoMaterialize } from './use-auto-materialize.js';

describe('useAutoMaterialize', () => {
  it('generates the shared window once when needed, then reloads', async () => {
    const gateway = new InMemoryRecurringGateway();
    const onGenerated = vi.fn(async () => undefined);
    const { rerender } = renderHook((props: { needed: boolean }) => useAutoMaterialize({
      gateway, spaceId: 'space-1', today: '2026-09-25', needed: props.needed, onGenerated,
    }), { initialProps: { needed: true } });
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    rerender({ needed: true });
    const generated = gateway.calls.filter((call) => call.name === 'materialize');
    expect(generated).toHaveLength(1);
    expect(generated[0]!.input).toMatchObject({ spaceId: 'space-1', fromDate: '2026-09-25', toDate: '2026-12-23' });
  });

  it('does nothing when not needed', () => {
    const gateway = new InMemoryRecurringGateway();
    renderHook(() => useAutoMaterialize({ gateway, spaceId: 'space-1', today: '2026-09-25', needed: false, onGenerated: vi.fn() }));
    expect(gateway.calls).toHaveLength(0);
  });

  it('reports a failure without retrying in a loop', async () => {
    const gateway = new InMemoryRecurringGateway();
    vi.spyOn(gateway, 'materialize').mockRejectedValue(new Error('materialize_cap_exceeded'));
    const { result } = renderHook(() => useAutoMaterialize({ gateway, spaceId: 'space-1', today: '2026-09-25', needed: true, onGenerated: vi.fn() }));
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', message: 'materialize_cap_exceeded' }));
    expect(gateway.materialize).toHaveBeenCalledTimes(1);
  });
});
```

  `InMemoryRecurringGateway.materialize` records its calls under the name `'materialize'` (`src/test/in-memory-recurring-gateway.ts:92-96`, via `mutate`).
- [ ] **Step 3: Run them and watch them fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring/occurrence-window.test.ts src/features/recurring/use-auto-materialize.test.tsx`
  Expected: FAIL (modules not found).
- [ ] **Step 4: Implement.** Create `src/features/recurring/occurrence-window.ts`:

```ts
/** Days ahead that bills are generated and listed. Must equal the horizon
 * `available_cash_summary` checks (`v_horizon_end := v_today + 89`);
 * occurrence-window.test.ts pins the two together. */
export const OCCURRENCE_WINDOW_DAYS = 89;

export function occurrenceWindow(todayIso: string): { fromDate: string; toDate: string } {
  const end = new Date(`${todayIso}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + OCCURRENCE_WINDOW_DAYS);
  return { fromDate: todayIso, toDate: end.toISOString().slice(0, 10) };
}
```

  Create `src/features/recurring/use-auto-materialize.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { occurrenceWindow } from './occurrence-window.js';
import type { RecurringGateway } from './types.js';

export type AutoMaterializeState = { status: 'idle' } | { status: 'running' } | { status: 'failed'; message: string };

/** Generates bill occurrences once per space and day when Available reports
 * a generation gap. Occurrence ids are deterministic, so a repeat never
 * duplicates; a failure is shown, never retried in a loop. */
export function useAutoMaterialize(options: {
  gateway: RecurringGateway | null;
  spaceId: string;
  today: string;
  needed: boolean;
  onGenerated(): Promise<unknown>;
}): AutoMaterializeState {
  const { gateway, spaceId, today, needed, onGenerated } = options;
  const [state, setState] = useState<AutoMaterializeState>({ status: 'idle' });
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    const key = `${spaceId}|${today}`;
    if (!gateway || !needed || attempted.current === key) return;
    attempted.current = key;
    setState({ status: 'running' });
    void gateway.materialize({ spaceId, requestId: globalThis.crypto.randomUUID(), ...occurrenceWindow(today) })
      .then(() => onGenerated())
      .then(() => setState({ status: 'idle' }))
      .catch((cause: unknown) => setState({ status: 'failed', message: cause instanceof Error ? cause.message : String(cause) }));
  }, [gateway, spaceId, today, needed, onGenerated]);
  return state;
}
```

  Wire it up:
  - In `routes.tsx:389-390`, replace `const toDate = addDaysIso(fromDate, 60);` with `const { toDate } = occurrenceWindow(fromDate);`.
  - Wherever `routes.tsx` builds the per-currency `available` summaries for Home, and inside the Plan cash section (`routes.tsx:~425-435`), call `useAutoMaterialize`:
    - `gateway: gateways.recurring ?? null`
    - `today: todayIso()`
    - `needed`: true when any currency's `available.data` has `state === 'incomplete' && unmaterializedCount > 0`
    - `onGenerated`: that screen's existing cash-control refresh
  - Render `state.status === 'failed'` as `<p className="cr-banner" role="alert">` with bilingual copy: "Upcoming bills couldn't be generated: {message}" / "تعذر توليد الفواتير القادمة: {message}".
- [ ] **Step 5: Run everything green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring src/features/cash-control src/features/control-room && pnpm typecheck`
  Expected: PASS. If a test pinned the old 60-day `toDate`, update it to `occurrenceWindow(...)`.
- [ ] **Step 6: Ledger.** Append to `docs/decisions.md`: "Bill occurrences use one 89-day window and are generated automatically when Available reports a gap".
  - **Why:** D2. The 60- and 90-day windows came from two tasks, and a moving window with explicit-only generation keeps going stale.
  - **If changed:** a different horizon must change `OCCURRENCE_WINDOW_DAYS` and `available_cash_summary` together (the test enforces it). Going back to explicit-only means Available will regularly show "needs a refresh".
- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "fix(recurring): one 89-day occurrence window, generated when Available needs it

Available cash required occurrences through today+89 while the only
generate call covered today+60, so it never became ready with any monthly
or weekly bill. One shared window (pinned to the SQL by a test), and a
once-per-day automatic generate when the summary reports a gap.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Read the allocation template head (B1, DB)

**Root cause (verified):**
- `save_allocation_template` compares `p_expected_revision_id` with the latest template revision for the whole space and currency (`allocation_commands.sql:404-407`).
- The UI can only learn a template id from `allocation_month_state`, and that is `null` for a month without a snapshot (`month_transitions.sql:1302`).
- So from the second month on, the UI always sends `null` and gets `40001`. Proven by `tests/db/allocation-commands.integration.test.ts:266-273`.

**Files:**
- Create: `supabase/migrations/20260925101000_allocation_template_head.sql`
- Create: `tests/db/allocation-template-head.integration.test.ts`
- Modify: release files (count → 52)

**Interfaces:**
- Produces RPC: `public.allocation_template_head(p_space_id uuid, p_currency public.currency_code) returns jsonb`, returning `{ "templateRevisionId": "<id>" | null }`.

- [ ] **Step 1: Write the failing test.** Create `tests/db/allocation-template-head.integration.test.ts`. Copy the harness from `tests/db/allocation-commands.integration.test.ts:1-60` exactly: `database`, `actor`, `outsider`, `db()`, `beforeAll`/`afterAll`, and `freshSpace`. Also copy that file's `saveTemplate` and `templateGroup` helpers (the ones its tests at lines 255-285 use), with their exact signatures. Then add:

```ts
async function head(spaceId: string, user: string = actor): Promise<string | null> {
  return withAuthenticatedTransaction(db().client, user, async () => {
    const result = await db().client.query<{ head: { templateRevisionId: string | null } }>(
      "select public.allocation_template_head($1, 'USD') as head", [spaceId]);
    return result.rows[0]!.head.templateRevisionId;
  });
}

describe('allocation_template_head', () => {
  it('is null before any template and the latest revision after saves', async () => {
    const spaceId = await freshSpace('Template head');
    expect(await head(spaceId)).toBeNull();
    const groupId = randomUUID();
    const first = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    expect(await head(spaceId)).toBe(first.templateRevisionId);
    const second = await saveTemplate({
      spaceId, expectedRevisionId: Number(first.templateRevisionId),
      groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [],
    });
    expect(await head(spaceId)).toBe(second.templateRevisionId);
  });

  it('lets a second month save against the head even though that month has no snapshot', async () => {
    const spaceId = await freshSpace('Template head second month');
    const groupId = randomUUID();
    await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    const current = await head(spaceId);
    await expect(saveTemplate({
      spaceId, expectedRevisionId: Number(current), groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [],
    })).resolves.toMatchObject({ templateRevisionId: expect.stringMatching(/^\d+$/) });
  });

  it('allows an active household member and refuses an outsider', async () => {
    const spaceId = await freshSpace('Template head access', 'household');
    const member = randomUUID();
    await db().client.query(`insert into auth.users(id, email, email_confirmed_at) values ($1,'th-member@budget.invalid', now())`, [member]);
    await db().client.query(`insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`, [spaceId, member]);
    await expect(head(spaceId, member)).resolves.toBeNull();
    await expect(head(spaceId, outsider)).rejects.toMatchObject({ code: '42501' });
  });
});
```

  If this file's `freshSpace` has no `kind` parameter, copy the two-argument version from `tests/db/allocation-projections.integration.test.ts:34-41`.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run tests/db/allocation-template-head.integration.test.ts --pool=forks --no-file-parallelism`
  Expected: FAIL with `function public.allocation_template_head(uuid, unknown) does not exist`.
- [ ] **Step 3: Write the migration.** Create `supabase/migrations/20260925101000_allocation_template_head.sql`:

```sql
-- The latest allocation template revision for a space and currency, which
-- save_allocation_template requires as p_expected_revision_id. The month
-- state only reports the template of its own snapshot, which is null for a
-- month that has none yet (audit B1).
create function public.allocation_template_head(p_space_id uuid, p_currency public.currency_code)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_head bigint;
begin
  if p_space_id is null or p_currency is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'planning_not_authorized';
  end if;
  select revision.id into v_head
  from public.allocation_template_revisions as revision
  where revision.space_id = p_space_id and revision.currency = p_currency
  order by revision.id desc
  limit 1;
  return jsonb_build_object('templateRevisionId', v_head::text);
end;
$$;

revoke all on function public.allocation_template_head(uuid, public.currency_code) from public, anon, authenticated, service_role;
grant execute on function public.allocation_template_head(uuid, public.currency_code) to authenticated;
```

- [ ] **Step 4: Release files** (count → 52; existence check `to_regprocedure('public.allocation_template_head(uuid,public.currency_code)') is not null`). Then run the DB test and `tests/ops`. Expected: PASS.
- [ ] **Step 5: Commit** (no ledger entry: an additive read):

```bash
git add -A
git commit -m "feat(allocation): read the template head for a space and currency

Lets a month without a snapshot save its template against the real head
instead of null (audit B1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Allocation re-publishes against the current heads (B1, B2, B3, UI)

**Root cause (verified B1; traced B2/B3) at `src/features/allocation/allocation-setup.tsx`:**
- **B1:** `:127` sends the snapshot's template id, which is `null` in a new month.
- **B2:** `:136` sends the snapshot's income revision instead of the Plan's.
- **B3:** `:41` pre-fills targets from the snapshot page ahead of the Plan's current amounts, while the category revision check uses the Plan's revision. So Confirm silently writes old targets back.

The in-memory gateway checks none of these heads, which is why the UI tests passed (lesson `in-memory-fakes-hide-head-checks`).

**Files:**
- Modify: `src/features/allocation/types.ts`. Add `loadTemplateHead(input: { spaceId: string; currency: Currency }, signal?: AbortSignal): Promise<{ templateRevisionId: string | null }>` to `AllocationGateway`.
- Modify: `src/features/allocation/supabase-allocation-gateway.ts`. Implement via `planningRpc(client, 'allocation_template_head', { p_space_id, p_currency })`, parsing with the existing `nullableBigIntId`.
- Modify: `src/features/allocation/use-allocation.ts`. Expose `loadTemplateHead(): Promise<{ templateRevisionId: string | null }>` for the hook's space and currency.
- Modify: `src/features/allocation/allocation-setup.tsx:12-24` (a new prop), `:36-47` (pre-fill order) and `:120-140` (the heads it sends).
- Modify: `src/features/control-room/routes.tsx:335-348`. Pass `monthlyPlanIncomeRevisionId` from the Plan summary's `incomePlanRevisionId` for that currency.
- Modify: `src/test/in-memory-allocation-gateway.ts`. Enforce the heads.
- Test: `src/features/allocation/allocation-setup.test.tsx`, `src/features/allocation/supabase-allocation-gateway.test.ts`, `src/features/allocation/use-allocation.test.tsx`

**Interfaces:**
- Consumes: the `allocation_template_head` RPC (Task 5).
- Produces:
  - `AllocationGateway.loadTemplateHead`
  - `useAllocation(...).loadTemplateHead`
  - the `AllocationSetupProps.monthlyPlanIncomeRevisionId?: string | null` prop

- [ ] **Step 1: Write the failing setup tests.** Add to `allocation-setup.test.tsx`. `fakeAllocation` needs `loadTemplateHead` in its defaults: add `loadTemplateHead: vi.fn(async () => ({ templateRevisionId: null })),`.

```tsx
  it('publishes a month without a snapshot against the current template head', async () => {
    const saveTemplate = vi.fn(async (_input: Omit<SaveTemplateInput, 'spaceId' | 'requestId'>) => ({ status: 'success', reconciled: false, result: { templateRevisionId: '10' } }) as CommandOutcome);
    const publishMonth = vi.fn(async (_input: Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>) => ({ status: 'success', reconciled: false, result: { snapshotId: '2', incomeRevisionId: '5' } }) as CommandOutcome);
    const loadTemplateHead = vi.fn(async () => ({ templateRevisionId: '9' }));
    render(<AllocationSetup locale="en" currency="USD" month="2026-10-01" categories={categories}
      allocation={fakeAllocation({ saveTemplate, publishMonth, loadTemplateHead })} gateway={stubGateway}
      monthlyPlanIncomeMinor="200000" monthlyPlanIncomeRevisionId="31" />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    // Walk the editor exactly as the existing 'Confirm chains saveTemplate then publishMonth…' test does, then confirm.
    expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ expectedRevisionId: '9' }));
    expect(publishMonth).toHaveBeenCalledWith(expect.objectContaining({ templateRevisionId: '10', expectedIncomeRevisionId: '31' }));
  });

  it('pre-fills a category target from the Plan, not the older snapshot', async () => {
    const loadCategoryPage = vi.fn(async () => ({ rows: [{ rootId: 'cat-essentials', groupId: null, targetMinor: '40000' }], nextRootId: null, hasMore: false }));
    const planTargets = new Map([['cat-essentials', { amountMinor: '50000', revisionId: '12' }]]);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories}
      allocation={fakeAllocation({ month: { ...emptyMonth, snapshotId: '12', hasPlan: true }, loadCategoryPage })}
      gateway={stubGateway} categoryTargets={planTargets} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit|Set up/ }));
    expect(await screen.findByDisplayValue('500.00')).toBeInTheDocument();
  });
```

  Complete the first test's walk-through by copying the steps between `Set up` and `Confirm` from the existing test at `allocation-setup.test.tsx:62-80`, including its income and percent inputs. The final two `expect`s are the red assertions. For the second test, if the page row type needs more fields, copy a full `AllocationCategoryRow` from `src/test/in-memory-allocation-gateway.ts`.
- [ ] **Step 2: Make the fake enforce the heads.** In `src/test/in-memory-allocation-gateway.ts`, add these fields and make both commands check them. Throw the same error shape that `planningRpc` throws for SQLSTATE `40001` (read `src/features/planning-shared/rpc.ts`).

```ts
  templateHead: string | null = null;
  incomeHeads = new Map<string, string | null>(); // `${month}|${currency}` → Plan income revision

  async loadTemplateHead(input: { spaceId: string; currency: Currency }) {
    this.calls.push({ name: 'loadTemplateHead', input });
    return { templateRevisionId: this.templateHead };
  }
```

  In `saveTemplate`, after the receipt replay: if `(input.expectedRevisionId ?? null) !== this.templateHead`, throw the 40001 stale error. On success, set `this.templateHead = result.templateRevisionId`.
  In `publishMonth` and `publishMonthV2`, after the replay: compare `input.expectedIncomeRevisionId ?? null` with `this.incomeHeads.get(`${input.month}|${input.currency}`) ?? null`, and throw 40001 on a mismatch.
  Then add a `use-allocation.test.tsx` test with this fake. Publish for September, then run a second publish for October with `month.templateRevisionId === null`. It must succeed only if the hook sends the head from `loadTemplateHead`.
- [ ] **Step 3: Run them and watch them fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/allocation`
  Expected: FAIL on:
  - `expectedRevisionId: null` (not '9')
  - `expectedIncomeRevisionId: null` (not '31')
  - the display value `400.00`
- [ ] **Step 4: Fix `allocation-setup.tsx`.** Add the prop:

```tsx
  /** The Plan's current planned-income revision for this currency and month.
   * publishMonth's expected income head must be the Plan's, not the last
   * snapshot's (audit B2). */
  monthlyPlanIncomeRevisionId?: string | null;
```

  Pre-fill from the Plan first (B3). In `buildInitialDraft`:

```tsx
    const amountMinor = fromPlan?.amountMinor ?? fromPage?.targetMinor ?? '0';
```

  Send the current heads (B1, B2). Inside `onSubmit`:

```tsx
              const head = await allocation.loadTemplateHead();
              const templateOutcome = await allocation.saveTemplate({
                currency,
                expectedRevisionId: head.templateRevisionId,
                groups: submission.groups,
                rootMappings: submission.rootMappings,
              });
              if (templateOutcome.status === 'ambiguous') return;
              const templateResult = templateOutcome.result as SaveTemplateResult;
              const publishOutcome = await allocation.publishMonth({
                templateRevisionId: templateResult.templateRevisionId,
                expectedSnapshotId: allocation.month.snapshotId,
                expectedIncomeRevisionId: props.monthlyPlanIncomeRevisionId ?? null,
                incomeMinor: submission.incomeMinor,
                rootTargets: submission.rootTargets,
                loanGroupId: submission.loanGroupId,
              });
```

  Implement `loadTemplateHead` in the gateway and the hook, following `loadCategoryPage`'s pattern in both files. Add a gateway parse test in `supabase-allocation-gateway.test.ts` covering both `{templateRevisionId: '9'}` and `{templateRevisionId: null}`. In `routes.tsx`, pass `monthlyPlanIncomeRevisionId` from the same Plan summary row that already supplies `plannedIncomeMinor`.
- [ ] **Step 5: Run everything green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/allocation src/features/control-room && pnpm typecheck`
  Expected: PASS.
- [ ] **Step 6: Ledger.** Append "Allocation Confirm sends the current template head and the Plan's income revision; the editor pre-fills from the Plan".
  - **Why:** B1–B3. The Plan is the source of truth for targets and income, per the component's own documented rule.
  - **If changed:** if the snapshot becomes the source of truth instead (a Spec 1 question), reverse the pre-fill order and fetch the snapshot's revision ids.
- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "fix(allocation): publish any month against the current template and plan heads

Every month after the first failed with 'changed elsewhere' because the
editor sent the new month's null snapshot template id; it also sent the
snapshot's income revision and pre-filled old snapshot targets over Plan
edits. The in-memory gateway now enforces the same heads as SQL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Plan category page v3: parent categories, subcategory spending rolled up, real paging (B5, B4, DB)

**Root cause (verified B5; traced B4):**
- v1 (`monthly_budget_planning.sql:245-287`) lists every expense category, subcategories included, in both currencies. It counts spending only on the exact category, and its rows carry no cursor field, so the client can't page (`plan-client.ts:152` hard-codes `nextCursor: null`).
- v2 (`planning_projection_contracts.sql:227-309`) pages correctly, but it also drops subcategory spending and hides parents with no target yet.
- The app uses v1. Nothing uses v2 except `tests/db/planning-projections.integration.test.ts:286`.

**Files:**
- Create: `supabase/migrations/20260925102000_monthly_budget_category_page_v3.sql`
- Create: `tests/db/plan-category-page-v3.integration.test.ts`
- Modify: release files (count → 53)

**Interfaces:**
- Produces RPC: `public.monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text default null, p_after_category_id uuid default null, p_limit integer default 100)`.
- It returns `table(category_id uuid, category_created_at text, name_en text, name_ar text, archived_at timestamptz, target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text, target_revision_id text, has_more boolean)`.
- Rows: every active parent (root) expense category in the space, plus archived parents that have a target or spending that month in that currency.

- [ ] **Step 1: Write the failing test.** Create `tests/db/plan-category-page-v3.integration.test.ts`. Copy the harness and the helpers `freshSpace`, `expenseRootCategory`, `subcategoryOf` from `tests/db/allocation-commands.integration.test.ts:1-60`, and `recordExpense`/`reverseEvent` from `tests/db/allocation-projections.integration.test.ts:66-105`. Add a USD and an LBP wallet via `create_wallet`, and this target helper:

```ts
async function setTarget(spaceId: string, categoryId: string, currency: 'USD' | 'LBP', amountMinor: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01'::date,$4::public.currency_code,$5,null) limit 2",
    [spaceId, randomUUID(), categoryId, currency, amountMinor]));
}

async function page(spaceId: string, currency: 'USD' | 'LBP', after: { createdAt: string; id: string } | null = null, limit = 100, user: string = actor) {
  return withAuthenticatedTransaction(db().client, user, async () => (await db().client.query<{
    category_id: string; category_created_at: string; target_minor: string; actual_spent_minor: string; has_more: boolean;
  }>(
    'select * from public.monthly_budget_category_page_v3($1, $2::date, $3::public.currency_code, $4, $5, $6)',
    [spaceId, '2026-09-01', currency, after?.createdAt ?? null, after?.id ?? null, limit],
  )).rows);
}
```

  `set_monthly_category_target(p_space_id, p_request_id, p_category_id, p_month, p_currency, p_amount_minor, p_expected_revision_id default null)` is defined at `supabase/migrations/20260912101000_monthly_budget_planning.sql:140`. Then add the cases:
  1. **Subcategory spending rolls up.** Parent `Food` with subcategory `Groceries`. USD target on Food 40000. USD expense 12000 on Groceries dated 2026-09-12. Expect Food's row `actual_spent_minor === '12000'`, and no row for Groceries.
  2. **A parent with no target and no spending is listed** (target `'0'`), so it can be given one.
  3. **Archived parents** appear only if they have a target or spending (archive through the categories RPC the existing tests use).
  4. **Currency isolation.** An LBP expense on Food doesn't change the USD page.
  5. **Reversal nets out.** Expense 5000, then a reversal on the same date: `actual_spent_minor === '0'`.
  6. **Paging.** Three parents with `limit = 2` give 2 rows with `has_more` true. The next page, from the last row's `(category_created_at, category_id)`, gives 1 row with `has_more` false.
  7. **Access.** An active household member can read; an outsider gets `42501`.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run tests/db/plan-category-page-v3.integration.test.ts --pool=forks --no-file-parallelism`
  Expected: FAIL (the function doesn't exist).
- [ ] **Step 3: Write the migration.** Create `supabase/migrations/20260925102000_monthly_budget_category_page_v3.sql`:

```sql
-- Plan page rows per parent (root) expense category for one currency:
-- spending recorded on a subcategory counts toward its parent (audit B5),
-- every active parent is listed so it can receive a target, and a keyset
-- cursor pages through all of them (audit B4). v1 and v2 stay for their
-- existing callers.
create function public.monthly_budget_category_page_v3(
  p_space_id uuid,
  p_month date,
  p_currency public.currency_code,
  p_after_created_at text default null,
  p_after_category_id uuid default null,
  p_limit integer default 100
)
returns table (
  category_id uuid, category_created_at text,
  name_en text, name_ar text, archived_at timestamptz,
  target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text,
  target_revision_id text, has_more boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  v_after_created_at timestamptz := p_after_created_at::timestamptz;
begin
  if p_month is null or p_currency is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'monthly budget category page limit must be between 1 and 100';
  end if;
  if (p_after_created_at is null) <> (p_after_category_id is null) then
    raise exception using errcode = 'P0001', message = 'monthly budget category cursor is incomplete';
  end if;
  return query
  with latest as (
    select distinct on (revision.category_id) revision.*
    from public.monthly_budget_plan_revisions as revision
    where revision.space_id = p_space_id and revision.month_start = v_month_start
      and revision.currency = p_currency and revision.plan_kind = 'expense_category'
    order by revision.category_id, revision.id desc
  ), expense_actual as (
    select coalesce(tagged.parent_category_id, tagged.id) as root_id,
      (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id and wallet.currency = p_currency
    join public.financial_event_categories as association on association.event_id = event.id
    join public.categories as tagged on tagged.id = association.category_id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by coalesce(tagged.parent_category_id, tagged.id)
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, target.amount_minor as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    left join latest as target on target.category_id = category.id
    left join expense_actual as actual on actual.root_id = category.id
    where category.space_id = p_space_id and category.kind = 'expense'
      and category.parent_category_id is null
      and (category.archived_at is null or coalesce(target.amount_minor, 0) <> 0 or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.created_at::text, rows.name_en, rows.name_ar, rows.archived_at,
    coalesce(rows.selected_target_minor, 0)::text,
    rows.selected_actual_spent_minor::text,
    greatest(coalesce(rows.selected_target_minor, 0) - rows.selected_actual_spent_minor, 0)::text,
    greatest(rows.selected_actual_spent_minor - coalesce(rows.selected_target_minor, 0), 0)::text,
    rows.selected_target_revision_id::text,
    count(*) over () > p_limit
  from rows
  where v_after_created_at is null
    or (rows.created_at, rows.selected_category_id) > (v_after_created_at, p_after_category_id)
  order by rows.created_at, rows.selected_category_id
  limit p_limit;
end;
$$;

revoke all on function public.monthly_budget_category_page_v3(uuid, date, public.currency_code, text, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.monthly_budget_category_page_v3(uuid, date, public.currency_code, text, uuid, integer) to authenticated;
```

- [ ] **Step 4: Release files** (count → 53; existence check `to_regprocedure('public.monthly_budget_category_page_v3(uuid,date,public.currency_code,text,uuid,integer)') is not null`). Run the new test, `tests/db/subcategories-source-ratchet.test.ts`, `tests/db/constraint-trigger-names-ratchet.test.ts` and `tests/ops`. Expected: PASS.
- [ ] **Step 5: Ledger.** Append "Plan rows are parent categories with subcategory spending rolled up (v3); v1 and v2 are kept but superseded".
  - **Why:** B5, B4, and the 2026-09-10 rollup decision.
  - **If changed:** child-level budgets need the anti-double-counting rule named in the 2026-09-13 planning entry.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(plan): category page v3 rolls subcategory spending into its parent and pages fully

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Plan page reads v3 and loads every page (B5, B4, UI)

**Files:**
- Modify: `src/features/plan/plan-client.ts:17,140-153`. Add `loadCategoryRows(spaceId, month, currency)`, which pages through v3 with a hard cap.
- Modify: `src/features/plan/types.ts`. Add `loadCategoryRows` to the client interface and keep `BudgetCategoryRow`; the client sets `currency` on each row.
- Modify: `src/features/plan/use-plan.ts:39`. Load both currencies with `loadCategoryRows` and concatenate them.
- Modify: `src/test/in-memory-plan-client.ts`. Implement `loadCategoryRows`.
- Test: `src/features/plan/plan-client.test.ts`, `src/features/plan/use-plan.test.tsx`

**Interfaces:**
- Produces: `PlanClient.loadCategoryRows(spaceId: string, month: string, currency: Currency): Promise<readonly BudgetCategoryRow[]>`.
- `MAX_CATEGORY_PAGES = 20` (at most 2,000 parent categories). Throws `Error('Too many categories to plan at once.')` beyond that.

- [ ] **Step 1: Write the failing tests.** In `plan-client.test.ts`, follow that file's existing fake `PlanDataClient` pattern (it records `rpc` calls):
  1. **Pages until `has_more` is false.** The fake returns 100 rows with `has_more: true`, then 1 row with `has_more: false`. Expect 101 rows. The second call must carry `p_after_created_at` and `p_after_category_id` from row 100, with `p_currency: 'USD'`, calling `monthly_budget_category_page_v3`.
  2. **Stops at the cap.** The fake always returns `has_more: true`. Expect a rejection with `Too many categories to plan at once.` after exactly 20 calls.
  3. **Row mapping.** Each row gets `currency: 'USD'`, and the targets and actuals are parsed with the file's existing parsers.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/plan/plan-client.test.ts`
  Expected: FAIL (`loadCategoryRows` is not a function).
- [ ] **Step 3: Implement:**

```ts
const V3_PAGE_LIMIT = 100;
const MAX_CATEGORY_PAGES = 20;

    async loadCategoryRows(spaceId, month, currency) {
      const rows: BudgetCategoryRow[] = [];
      let after: { createdAt: string; categoryId: string } | null = null;
      for (let pageIndex = 0; pageIndex < MAX_CATEGORY_PAGES; pageIndex += 1) {
        const data = await call(client, 'monthly_budget_category_page_v3', {
          p_space_id: spaceId, p_month: month, p_currency: currency,
          p_after_created_at: after?.createdAt ?? null, p_after_category_id: after?.categoryId ?? null,
          p_limit: V3_PAGE_LIMIT,
        });
        if (!Array.isArray(data)) throw new Error('Unexpected category page shape.');
        const page = (data as unknown[]).map((value) => categoryRowV3(value, currency));
        rows.push(...page);
        const last = (data as unknown[]).at(-1);
        const hasMore = last !== undefined && asRow(last)['has_more'] === true;
        if (!hasMore) return rows;
        after = { createdAt: textField(asRow(last), 'category_created_at'), categoryId: textField(asRow(last), 'category_id') };
      }
      throw new Error('Too many categories to plan at once.');
    },
```

  Write `categoryRowV3(value, currency)` next to the existing `categoryRow`. It maps v3 columns into `BudgetCategoryRow`, reusing the same field parsers and setting `currency`. Use the file's existing text-field helper; if there isn't one, add `textField(row, key)` beside `revisionIdValue` with the same validation style. In `use-plan.ts:39`, replace `client.loadCategoryPage(spaceId, month)` with a `Promise.all` of `loadCategoryRows` for `'USD'` and `'LBP'`, concatenated into the shape the page already consumes (`{ rows, nextCursor: null }`). Keep `loadCategoryPage` in the interface until nothing calls it, then delete it and its in-memory implementation in this same task.
- [ ] **Step 4: Run everything green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/plan src/features/control-room && pnpm typecheck`
  Expected: PASS. Subcategory rows no longer appear in Plan tests; update any assertion that expected them, citing B5.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "fix(plan): show every parent category with its subcategory spending

The Plan tab showed at most 25 categories and never counted subcategory
spending toward its parent, so it disagreed with Home and Allocation.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Auto-settle picks the oldest unpaid bill and reports what happened (D3, D7)

**Root cause (verified):** `findSettleableOccurrence` (`auto-settle.ts:28-36`) needs exactly one candidate in ±31 days.
- A monthly bill paid on or after its due date also matches next month's generated occurrence, so nothing settles. A weekly bill always has several matches.
- It compares exact category ids, so a subcategory expense against a parent-category bill never matches.
- `autoSettleExpense` swallows every error (`:71-73`), so the user never learns the result.

**Decision (ledger, this commit):**
- Candidates are grouped **per schedule**, and each schedule offers its **oldest** unpaid occurrence.
- Exactly one schedule must match; two or more schedules is `ambiguous` and never guessed.
- Categories match when equal, or when one is the other's parent (depth is one level).
- An uncategorized bill matches only an uncategorized entry (unchanged).
- The amount must equal the occurrence's **remaining** amount.
- The outcome is returned and shown.

**Files:**
- Modify: `src/features/recurring/auto-settle.ts`
- Modify: `src/features/recurring/auto-settle.test.ts`. Replace the test "refuses to guess when several occurrences match": it encodes the defect, because both rows share `scheduleId: 'sch-1'`.
- Modify: `src/features/control-room/routes.tsx:604-623`. Pass the category parent lookup, store the outcome, and render it.
- Modify: `docs/decisions.md`. Commit `9dbf6f0`'s matching rules had no entry.

**Interfaces:**
- Produces:

```ts
export interface RecordedEventForMatching {
  readonly eventId: string;
  readonly eventKind: 'expense' | 'income';
  readonly categoryId: string | null;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly effectiveDate: string;
}
export type SettleCandidate =
  | { readonly kind: 'match'; readonly occurrence: ScheduledOccurrenceRow }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly scheduleCount: number };
export type AutoSettleOutcome =
  | { readonly status: 'settled'; readonly occurrenceId: string; readonly nameEn: string | null; readonly nameAr: string | null }
  | { readonly status: 'none' }
  | { readonly status: 'ambiguous'; readonly scheduleCount: number }
  | { readonly status: 'failed'; readonly message: string };
export function findSettleableOccurrence(
  recorded: RecordedEventForMatching,
  occurrences: readonly ScheduledOccurrenceRow[],
  parentOf: (categoryId: string) => string | null,
): SettleCandidate;
export function autoSettleRecordedEvent(
  gateway: RecurringGateway, spaceId: string, recorded: RecordedEventForMatching,
  parentOf: (categoryId: string) => string | null,
): Promise<AutoSettleOutcome>;
```

- [ ] **Step 1: Write the failing tests.** In `auto-settle.test.ts`, change `expense()` to build a `RecordedEventForMatching` (add `eventKind: 'expense'`). Add `const flat = () => null;` for callers with no subcategories, and pass `flat` as the third argument everywhere. Then replace and add:

```ts
  it('picks the oldest unpaid occurrence of a single schedule', () => {
    const rows = [occurrence({ id: 'occ-oct', dueDate: '2026-10-30' }), occurrence({ id: 'occ-sep', dueDate: '2026-09-30' })];
    expect(findSettleableOccurrence(expense({ effectiveDate: '2026-09-30' }), rows, flat))
      .toEqual({ kind: 'match', occurrence: expect.objectContaining({ id: 'occ-sep' }) });
  });

  it('settles a weekly bill against its oldest unpaid week', () => {
    const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((dueDate, index) =>
      occurrence({ id: `w${index}`, dueDate, state: index === 0 ? 'settled' : 'pending', remainingMinor: index === 0 ? '0' : '6000' }));
    expect(findSettleableOccurrence(expense({ effectiveDate: '2026-09-15' }), weeks, flat))
      .toEqual({ kind: 'match', occurrence: expect.objectContaining({ id: 'w1' }) });
  });

  it('refuses to guess between two look-alike schedules', () => {
    const rows = [occurrence({ id: 'a', scheduleId: 'sch-music' }), occurrence({ id: 'b', scheduleId: 'sch-video' })];
    expect(findSettleableOccurrence(expense(), rows, flat)).toEqual({ kind: 'ambiguous', scheduleCount: 2 });
  });

  it('matches a subcategory entry to a bill on its parent category', () => {
    const parentOf = (id: string) => (id === 'cat-internet' ? 'cat-utilities' : null);
    const bill = occurrence({ categoryId: 'cat-utilities' });
    expect(findSettleableOccurrence(expense({ categoryId: 'cat-internet' }), [bill], parentOf).kind).toBe('match');
  });

  it('does not match sibling subcategories', () => {
    const parentOf = (id: string) => (id === 'cat-internet' || id === 'cat-power' ? 'cat-utilities' : null);
    const bill = occurrence({ categoryId: 'cat-power' });
    expect(findSettleableOccurrence(expense({ categoryId: 'cat-internet' }), [bill], parentOf).kind).toBe('none');
  });

  it('settles the rest of a partly paid bill when the amount equals what remains', () => {
    const partial = occurrence({ state: 'partial', settledMinor: '2000', remainingMinor: '4000' });
    expect(findSettleableOccurrence(expense({ amountMinor: '4000' }), [partial], flat).kind).toBe('match');
  });

  it('reports a link failure instead of swallowing it', async () => {
    const gateway = {
      loadOccurrences: vi.fn(async () => ({ rows: [occurrence()], nextCursor: null })),
      linkExisting: vi.fn(async (_input: LinkExistingInput) => { throw new Error('a payment cannot be linked before its effective date has occurred'); }),
    } as unknown as RecurringGateway;
    await expect(autoSettleRecordedEvent(gateway, 'space-1', expense(), flat))
      .resolves.toEqual({ status: 'failed', message: 'a payment cannot be linked before its effective date has occurred' });
  });
```

  Keep every existing `it.each` rejection case. In the "partially settled" row, the expense amount (6000) ≠ remaining (4000), so it still rejects. Update the success-path test for `autoSettleRecordedEvent` to expect `{ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Internet', nameAr: null }`. If the existing `loadOccurrences` fake returns a different page shape, copy that shape.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring/auto-settle.test.ts`
  Expected: FAIL on the oldest-per-schedule, weekly, ambiguous, parent-category and failure-reporting cases.
- [ ] **Step 3: Implement.** Replace the body of `auto-settle.ts` from `findSettleableOccurrence` down:

```ts
function categoriesMatch(bill: string | null, entry: string | null, parentOf: (id: string) => string | null): boolean {
  if (bill === null || entry === null) return bill === entry;
  return bill === entry || parentOf(entry) === bill || parentOf(bill) === entry;
}

export function findSettleableOccurrence(
  recorded: RecordedEventForMatching,
  occurrences: readonly ScheduledOccurrenceRow[],
  parentOf: (categoryId: string) => string | null,
): SettleCandidate {
  const oldestPerSchedule = new Map<string, ScheduledOccurrenceRow>();
  for (const row of occurrences) {
    if (row.kind !== recorded.eventKind) continue;
    if (row.state !== 'pending' && row.state !== 'partial') continue;
    if (row.currency !== recorded.currency || row.remainingMinor !== recorded.amountMinor) continue;
    if (!categoriesMatch(row.categoryId, recorded.categoryId, parentOf)) continue;
    if (Math.abs(daysBetween(row.dueDate, recorded.effectiveDate)) > MATCH_WINDOW_DAYS) continue;
    const current = oldestPerSchedule.get(row.scheduleId);
    if (!current || row.dueDate < current.dueDate || (row.dueDate === current.dueDate && row.id < current.id)) {
      oldestPerSchedule.set(row.scheduleId, row);
    }
  }
  if (oldestPerSchedule.size === 0) return { kind: 'none' };
  if (oldestPerSchedule.size > 1) return { kind: 'ambiguous', scheduleCount: oldestPerSchedule.size };
  const [only] = oldestPerSchedule.values();
  return only ? { kind: 'match', occurrence: only } : { kind: 'none' };
}

/**
 * After an entry is recorded, link it to the one bill (or income) it clearly
 * pays: same kind, currency and remaining amount, category equal or
 * parent/child, due within 31 days, and exactly one schedule — whose oldest
 * unpaid occurrence is settled. Never blocks recording; the outcome is
 * returned so the caller can tell the person what happened.
 */
export async function autoSettleRecordedEvent(
  gateway: RecurringGateway,
  spaceId: string,
  recorded: RecordedEventForMatching,
  parentOf: (categoryId: string) => string | null,
): Promise<AutoSettleOutcome> {
  try {
    const page = await gateway.loadOccurrences({
      spaceId,
      fromDate: shiftDate(recorded.effectiveDate, -MATCH_WINDOW_DAYS),
      toDate: shiftDate(recorded.effectiveDate, MATCH_WINDOW_DAYS),
      afterDueDate: null,
      afterId: null,
      limit: 100,
    });
    const candidate = findSettleableOccurrence(recorded, page.rows, parentOf);
    if (candidate.kind === 'none') return { status: 'none' };
    if (candidate.kind === 'ambiguous') return { status: 'ambiguous', scheduleCount: candidate.scheduleCount };
    const match = candidate.occurrence;
    await gateway.linkExisting({
      spaceId,
      requestId: globalThis.crypto.randomUUID(),
      occurrenceId: match.id,
      eventId: recorded.eventId,
      amountMinor: recorded.amountMinor,
      expectedEventId: match.currentEventId,
    });
    return { status: 'settled', occurrenceId: match.id, nameEn: match.nameEn, nameAr: match.nameAr };
  } catch (cause) {
    return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}
```

  In `routes.tsx:604-623`:
  - Rename `settleRecordedExpense` to `settleRecordedEvent`, and let it accept `info.kind === 'expense' || info.kind === 'income'`.
  - Build `parentOf` from `categories.categories`, the categories hook already mounted at `:624`. Map each category id to its `parentCategoryId ?? null`.
  - Store the outcome in `const [settleNotice, setSettleNotice] = useState<AutoSettleOutcome | null>(null);`.
  - Render the notice once, above the active screen, as `<p className="cr-banner" role="status">` with a dismiss button. Show nothing for `none`.
    - `settled`: "Marked “{name}” as paid." / "تم تعليم «{name}» كمدفوعة." (name in `<bdi>`)
    - `ambiguous`: "This payment matches {n} bills — open Upcoming bills to choose." / "تطابق هذه الدفعة {n} فواتير — افتح الفواتير القادمة للاختيار."
    - `failed`: "Couldn't mark the bill as paid: {message}" / "تعذر تعليم الفاتورة كمدفوعة: {message}"
  - If `.cr-banner` has no dismiss affordance, add one to `src/control-room.css` and record it in `docs/design-guidelines.md`.
- [ ] **Step 4: Run everything green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring src/features/control-room && pnpm typecheck`
  Expected: PASS. Add a `routes.test.tsx` wiring test: a recorded expense whose occurrence settles shows the "Marked … as paid." status. Use `InMemoryRecurringGateway` seeded with one pending occurrence.
- [ ] **Step 5: Ledger.** Append the matching decision in full.
  - **Why:** D3, D7, and review focus #4.
  - **If changed:** loosening "exactly one schedule" risks paying the wrong bill silently; a picker (Spec 1) is the alternative.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "fix(recurring): settle the oldest unpaid bill of one schedule and say what happened

Auto-settle refused every bill paid on or after its due date (next
month's occurrence also matched), never settled weekly bills, ignored
parent categories and hid its failures. It now matches per schedule,
never guesses between look-alike bills, and reports the outcome.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Salary and loan repayments settle their schedules (D8, D5)

**Root cause (verified D5; traced D8):**
- `routes.tsx:609` settles `expense` entries only. So a salary never settles its `income` occurrence: it is counted twice in the outlook, and "received" looks like "not received".
- A loan repayment is recorded through the Loans flow (`use-loans.ts:126`, `record_loan_repayment` returns `event_id`) and never links its `debt_payment` occurrence.
  - `available_cash_projection.sql:180-192` keeps `greatest(reservation, unsettled instalments)`, so repaid debt stays reserved.
  - `link_scheduled_payment` already accepts `loan_repay_borrowing`/`loan_receive_repayment` events for the occurrence's own loan, and several links per event up to its amount (`recurring_schedules.sql:1072-1100`).

**Files:**
- Modify: `src/features/control-room/routes.tsx`. Income flows through Task 9's `settleRecordedEvent` (already accepted there). Add a wiring test.
- Create: `src/features/recurring/settle-loan-repayment.ts` and `src/features/recurring/settle-loan-repayment.test.ts`
- Modify: `src/features/loans/use-loans.ts:126` (an `onRepaymentRecorded` option) and `routes.tsx` where `useLoans` is mounted (`:624`)

**Interfaces:**
- Produces:

```ts
export interface RecordedRepayment {
  readonly eventId: string; readonly loanId: string; readonly amountMinor: string;
  readonly currency: Currency; readonly effectiveDate: string;
}
export async function settleLoanRepayment(
  gateway: RecurringGateway, spaceId: string, repayment: RecordedRepayment,
): Promise<AutoSettleOutcome>; // 'settled' names the first occurrence; 'none' when no instalment exists
```

- The `useLoans` option is `onRepaymentRecorded?(repayment: RecordedRepayment): Promise<void>`.

- [ ] **Step 1: Write the failing tests.** Create `settle-loan-repayment.test.ts`. Reuse an `occurrence()` builder like `auto-settle.test.ts`'s, with `kind: 'debt_payment'` and `loanId: 'loan-1'`:
  1. **One instalment of 50000, repayment 50000:** one `linkExisting` for 50000, outcome `settled`.
  2. **Two months at once:** instalments 50000 (Sep 1) and 50000 (Oct 1), repayment 100000. Two links, **oldest first**, each 50000.
  3. **Partial:** repayment 20000 against an instalment of 50000. One link for 20000.
  4. **Overpayment:** repayment 70000 against a single 50000 instalment. One link for 50000; the rest stays unlinked.
  5. **Another loan's instalments are ignored**, giving outcome `none`.
  6. **Bound:** 30 pending instalments with a repayment covering all of them. At most 12 links; the outcome is still `settled`.
  7. **A `linkExisting` failure** gives outcome `failed` with its message.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring/settle-loan-repayment.test.ts`
  Expected: FAIL (module not found).
- [ ] **Step 3: Implement:**

```ts
import type { Currency } from '../loans/types.js';
import type { AutoSettleOutcome } from './auto-settle.js';
import type { RecurringGateway, ScheduledOccurrenceRow } from './types.js';

export interface RecordedRepayment {
  readonly eventId: string;
  readonly loanId: string;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly effectiveDate: string;
}

const LOOK_BACK_DAYS = 59;
const LOOK_AHEAD_DAYS = 30; // 89 days: within scheduled_occurrence_page's 90-day limit
const MAX_LINKS = 12;

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Links a loan repayment to that loan's unpaid instalments, oldest first,
 * up to the repayment amount (at most 12 links). */
export async function settleLoanRepayment(
  gateway: RecurringGateway,
  spaceId: string,
  repayment: RecordedRepayment,
): Promise<AutoSettleOutcome> {
  try {
    const page = await gateway.loadOccurrences({
      spaceId,
      fromDate: shiftDate(repayment.effectiveDate, -LOOK_BACK_DAYS),
      toDate: shiftDate(repayment.effectiveDate, LOOK_AHEAD_DAYS),
      afterDueDate: null,
      afterId: null,
      limit: 100,
    });
    const instalments = page.rows
      .filter((row: ScheduledOccurrenceRow) => row.kind === 'debt_payment' && row.loanId === repayment.loanId
        && row.currency === repayment.currency && (row.state === 'pending' || row.state === 'partial'))
      .sort((left, right) => (left.dueDate === right.dueDate ? left.id.localeCompare(right.id) : left.dueDate.localeCompare(right.dueDate)));
    let left = BigInt(repayment.amountMinor);
    let first: ScheduledOccurrenceRow | null = null;
    for (const row of instalments.slice(0, MAX_LINKS)) {
      if (left <= 0n) break;
      const remaining = BigInt(row.remainingMinor);
      const amount = remaining < left ? remaining : left;
      if (amount <= 0n) continue;
      await gateway.linkExisting({
        spaceId,
        requestId: globalThis.crypto.randomUUID(),
        occurrenceId: row.id,
        eventId: repayment.eventId,
        amountMinor: amount.toString(),
        expectedEventId: row.currentEventId,
      });
      first ??= row;
      left -= amount;
    }
    return first ? { status: 'settled', occurrenceId: first.id, nameEn: first.nameEn, nameAr: first.nameAr } : { status: 'none' };
  } catch (cause) {
    return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}
```

  Wire it up:
  - In `use-loans.ts`, after a successful `recordRepayment` whose result has `eventId`, call `options.onRepaymentRecorded?.({ eventId, loanId: draft.loanId, amountMinor: draft.amountMinor, currency: <that loan's currency from the hook's loan list>, effectiveDate: draft.effectiveDate })`. Follow `use-wallets.ts:355-362`'s after-success placement. Add a `use-loans.test.tsx` test that the option is called once with the event id.
  - In `routes.tsx`, pass `onRepaymentRecorded` to `useLoans`. It calls `settleLoanRepayment(gateways.recurring, spaceId, repayment)` when `gateways.recurring` is set, and stores the outcome in Task 9's `settleNotice`.
  - Add a `routes.test.tsx` test: recording an income entry that matches a pending `income` occurrence links it (`InMemoryRecurringGateway.calls` contains the `linkExisting` input with `eventId`).
- [ ] **Step 4: Run everything green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring src/features/loans src/features/control-room && pnpm typecheck`
  Expected: PASS.
- [ ] **Step 5: Ledger.** Append "Loan repayments settle their instalments oldest-first up to the repayment amount (max 12); salary settles its income schedule under Task 9's rules".
  - **Why:** D5 and D8, and Spec 1's early-salary prompt depends on it.
  - **If changed:** interest or fee splits would need per-instalment amounts.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "fix(recurring): salary and loan repayments settle their schedules

Recorded income never settled its income schedule (counted twice in the
outlook) and loan repayments never settled their instalments, so repaid
debt stayed reserved in Available.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: A paged read of overdue unpaid occurrences (D1, DB)

**Root cause (verified):** `scheduled_occurrence_page` needs a window of at most 90 days, and the Upcoming list starts at today (`routes.tsx:389`). But `available_cash_summary` and `cash_outlook` count every unpaid occurrence due by the period end, with **no lower date bound** (`available_cash_projection.sql:188,547-555`). So overdue bills reduce Available while being impossible to see, skip or link.

**Files:**
- Create: `supabase/migrations/20260925103000_scheduled_overdue_page.sql`
- Create: `tests/db/scheduled-overdue-page.integration.test.ts`
- Modify: release files (count → 54)

**Interfaces:**
- Produces RPC: `public.scheduled_overdue_page(p_space_id uuid, p_after_due_date date default null, p_after_id uuid default null, p_limit int default 50) returns jsonb`.
- Returns `{ rows: [...same row objects as scheduled_occurrence_page...], hasMore: boolean, nextDueDate: date | null, nextId: uuid | null }`. Rows are unpaid (not skipped, remaining > 0), due before UTC today, oldest first.

- [ ] **Step 1: Write the failing test.** Copy the harness and the schedule/materialize helpers from `tests/db/recurring-settlement.integration.test.ts` (read its first 120 lines for `saveSchedule`, `materialize` and `link` helpers). Build one monthly expense schedule starting 2026-05-01 and generate occurrences from 2026-05-01. Settle June's occurrence and skip July's. Then:
  1. With `as of` = the real UTC today, the overdue page lists May, August and September (those due before today and unpaid), oldest first, but not June (paid) or July (skipped).
  2. **Paging:** `p_limit = 1` gives one row with `hasMore` true, and the cursor continues with the next row.
  3. `p_limit` 0 or 101 gives `22023`. A half-set cursor gives `22023`.
  4. **Access:** an active household member can read it; an outsider gets `42501`.

  Use dates computed relative to `new Date()` in UTC (like the existing recurring tests do) so the test stays valid on any day.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run tests/db/scheduled-overdue-page.integration.test.ts --pool=forks --no-file-parallelism`
  Expected: FAIL (the function doesn't exist).
- [ ] **Step 3: Write the migration.** Build it by copying `public.scheduled_occurrence_page`'s latest definition (`supabase/migrations/20260914170000_recurring_schedules.sql`, from `create function public.scheduled_occurrence_page` to its `grant`). Change exactly these parts:
  - **Signature:** drop `p_from_date`/`p_to_date`. Keep `p_after_due_date`, `p_after_id` and `p_limit` (default 50).
  - **Validation:** keep the membership, cursor-pair and `1..100` limit checks; remove the window check.
  - **The `page` CTE:** it must filter unpaid rows **before** the limit. Use this in place of the original `page`, `numbered` and `settled` CTEs:

```sql
  with unpaid as (
    select so.*, sch.kind as schedule_kind, rev.name_en, rev.name_ar, stl.settled_minor, stl.skipped
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = so.space_id
    join public.schedule_revisions rev on rev.id = so.source_revision_id
    cross join lateral private.schedule_occurrence_settlement(so.id, v_as_of) stl
    where so.space_id = p_space_id and so.due_date < v_as_of
      and not stl.skipped and so.expected_minor - stl.settled_minor > 0
      and (p_after_due_date is null or (so.due_date, so.id) > (p_after_due_date, p_after_id))
    order by so.due_date, so.id
    limit p_limit + 1
  ), numbered as (
    select unpaid.*, row_number() over (order by due_date, id) as rn from unpaid
  ), settled as (
    select numbered.* from numbered where numbered.rn <= p_limit
  ), funded as (
```

  The `funded` CTE and the final `jsonb_build_object` projection stay **identical** to `scheduled_occurrence_page`, so both RPCs return the same row shape.
  - **Header comment:**

```sql
-- Unpaid, unskipped occurrences due before today (UTC, until the Spec 1 space
-- clock), oldest first, keyset-paged. Projections count these with no lower
-- date bound, so the list must be able to reach all of them (audit D1).
```

  - **Grants:** `revoke all … from public, anon, authenticated, service_role; grant execute … to authenticated;` for `(uuid, date, uuid, integer)`.
- [ ] **Step 4: Release files** (count → 54; existence check `to_regprocedure('public.scheduled_overdue_page(uuid,date,uuid,integer)') is not null`). Run the DB test and `tests/ops`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(recurring): page through overdue unpaid occurrences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Upcoming bills shows overdue bills and every page (D1, D10, UI)

**Root cause (traced):**
- The list loads a single 25-row page from today onward (`use-recurring.ts:104`). `loadMore` is never used (`:245`). So the "Overdue" filter (`upcoming-page.tsx:31`) can never match.
- Rows past the 25th silently vanish: 13 monthly or 3 weekly schedules are enough.

**Files:**
- Modify: `src/features/recurring/types.ts` (gateway `loadOverdue`), `supabase-recurring-gateway.ts` (parse, reusing the occurrence-page parser), `src/test/in-memory-recurring-gateway.ts`
- Modify: `src/features/recurring/use-recurring.ts:96-121`. Load overdue pages and window pages, each capped at `MAX_PAGES = 10` of 100 rows. Put overdue rows first.
- Test: `src/features/recurring/use-recurring.test.tsx`, `src/features/recurring/upcoming-page.test.tsx`, `src/features/recurring/supabase-recurring-gateway.test.ts`

**Interfaces:**
- Consumes: the `scheduled_overdue_page` RPC (Task 11).
- Produces: `RecurringGateway.loadOverdue(input: { spaceId: string; afterDueDate: string | null; afterId: string | null; limit: number }, signal?: AbortSignal): Promise<ScheduledOccurrencePage>`.

- [ ] **Step 1: Write the failing tests.**
  - **`use-recurring.test.tsx`, overdue first:** the in-memory gateway holds one overdue occurrence (`overdue: true`, due yesterday) and one upcoming. The loaded rows contain both, overdue first.
  - **`use-recurring.test.tsx`, paging:** the fake returns 100 rows with a next cursor, then 5 rows. The hook shows 105 rows.
  - **`use-recurring.test.tsx`, bound:** the fake always returns a next cursor. The hook stops after 10 pages and shows an alert: "Showing the first 1,000 bills." / "تُعرض أول 1,000 فاتورة."
  - **`upcoming-page.test.tsx`:** choosing the "Overdue" filter shows the overdue row's name.
  - **`supabase-recurring-gateway.test.ts`:** `loadOverdue` calls `scheduled_overdue_page` with `p_space_id`, `p_after_due_date`, `p_after_id` and `p_limit`, and parses rows with the existing occurrence parser.
- [ ] **Step 2: Run them and watch them fail.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring`
  Expected: FAIL (`loadOverdue` missing; only 25 rows; no overdue row).
- [ ] **Step 3: Implement.**
  - **Gateway:** `loadOverdue` calls `planningRpc(client, 'scheduled_overdue_page', { p_space_id, p_after_due_date, p_after_id, p_limit })` and returns the same `ScheduledOccurrencePage` parse used by `loadOccurrences`. Implement it in the in-memory gateway, backed by a public `overdueRows` array.
  - **Hook:** replace the single `loadOccurrences` call in `load` with this helper:

```ts
const MAX_PAGES = 10;
async function loadAll(
  fetchPage: (cursor: ScheduledOccurrencePageCursor | null) => Promise<ScheduledOccurrencePage>,
): Promise<{ rows: ScheduledOccurrenceRow[]; truncated: boolean }> {
  const rows: ScheduledOccurrenceRow[] = [];
  let cursor: ScheduledOccurrencePageCursor | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const page = await fetchPage(cursor);
    rows.push(...page.rows);
    if (!page.nextCursor) return { rows, truncated: false };
    cursor = page.nextCursor;
  }
  return { rows, truncated: true };
}
```

  The hook calls it twice: once for `loadOverdue` and once for `loadOccurrences` over the current window, both with `limit: 100` and the controller's `signal`. It stores `[...overdue.rows, ...windowRows]`, plus `truncated = overdue.truncated || windowResult.truncated` for the alert. If `ScheduledOccurrencePage` names its cursor differently, use the field `use-recurring.ts:103-104` already reads. Remove the now-unused `loadMore` only if nothing else references it.
- [ ] **Step 4: Run everything green.**
  Run: `pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring src/features/control-room && pnpm typecheck`
  Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "fix(recurring): list overdue bills and every upcoming page

Overdue bills vanished from the list while still reducing Available, and
bills past the 25th row were silently dropped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Adding money to a goal after a linked purchase (C1, DB) — added 2026-09-25 at the owner's request

**Root cause (traced; the SQL was re-read by the lead):** the command and the trigger count a linked purchase differently.
- The reserve command allows `target − earmarked − fulfilled` of room (`supabase/migrations/20260914150000_goal_commands.sql:727`). Here `earmarked` comes from `private.goal_financing_state`, which is **net** of linked purchases.
- The deferred check `private.check_goal_earmark_event` (latest definition `…goal_commands.sql:588`, balance block `:648-659`) sums the **gross** earmark lines as `running_balance`, and also subtracts **every** purchase link from the target.
- So each linked purchase is counted twice. Target 1000, reserve 500, link a 400 purchase, reserve 500: the command allows it, but the trigger sees 1000 > 1000 − 400 and raises `23514 goal_earmark_balance_invalid`.
- The same gross sum lets an API-only reverse push the net earmark below zero unnoticed.

**Files:**
- Create: `supabase/migrations/20260925104000_goal_earmark_check_uses_financing_state.sql`
- Create: `tests/db/goal-earmark-check.integration.test.ts`
- Modify: release files (count → 55), `docs/decisions.md`

**Interfaces:**
- Consumes: `private.goal_financing_state(p_goal_id uuid, p_as_of date) returns table(earmarked_minor numeric, fulfilled_minor numeric, head text)` (`…goal_commands.sql:11`), unchanged.
- Produces: the same `private.check_goal_earmark_event(bigint)` signature, so the existing constraint triggers keep calling it.

- [ ] **Step 1: Write the failing tests.** Create `tests/db/goal-earmark-check.integration.test.ts`. Copy the harness (`database`, `actor`, `db()`, `beforeAll`/`afterAll`) and the helpers `freshSpace`, wallet setup, `createGoal`, `reserve` and `linkPurchase` verbatim from `tests/db/goal-funding.integration.test.ts` (helpers start at lines 98, 138 and 182). Then add:

```ts
describe('goal earmark balance check', () => {
  it('allows topping a goal back up after a linked purchase', async () => {
    const { spaceId, expenseEventId } = await fundedSpaceWithExpense('400');   // build from the copied helpers: USD wallet with ≥ 1500 income, one 400 USD expense
    const { goalId } = await createGoal(spaceId, { kind: 'purchase', targetMinor: '1000' });
    await reserve(spaceId, goalId, '500', false);
    await linkPurchase(spaceId, expenseEventId, [{ goalId, amountMinor: '400' }]);
    await expect(reserve(spaceId, goalId, '500', false)).resolves.toMatchObject({ goalId });
  });

  it('still refuses a reserve beyond the remaining room', async () => {
    const { spaceId, expenseEventId } = await fundedSpaceWithExpense('400');
    const { goalId } = await createGoal(spaceId, { kind: 'purchase', targetMinor: '1000' });
    await reserve(spaceId, goalId, '500', false);
    await linkPurchase(spaceId, expenseEventId, [{ goalId, amountMinor: '400' }]);
    await reserve(spaceId, goalId, '500', false);
    await expect(reserve(spaceId, goalId, '1', false)).rejects.toMatchObject({ message: expect.stringContaining('remaining room') });
  });

  it('refuses an over-target earmark written directly, bypassing the command (the trigger alone)', async () => {
    const { spaceId } = await fundedSpaceWithExpense('0');
    const { goalId } = await createGoal(spaceId, { kind: 'reserve', targetMinor: '1000' });
    await reserve(spaceId, goalId, '900', false);
    // As the table owner: copy the goal_earmark_events/goal_earmark_lines column
    // lists from supabase/migrations/20260914140000_goals_schema.sql and insert
    // one 'reserve' event of 200 for goalId in a single transaction.
    await expect(insertRawReserve(spaceId, goalId, '200')).rejects.toMatchObject({ code: '23514', message: 'goal_earmark_balance_invalid' });
  });
});
```

  Write `fundedSpaceWithExpense` and `insertRawReserve` in this file from the copied helpers and the goals schema columns. `insertRawReserve` runs `begin; insert …; commit;`, because the check is deferred and fires at commit. Use exactly the column names the schema declares; do not change any assertion.
- [ ] **Step 2: Run it and watch it fail.**
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm exec vitest run tests/db/goal-earmark-check.integration.test.ts --pool=forks --no-file-parallelism`
  Expected: the first test FAILS with `23514 goal_earmark_balance_invalid`. The other two pass: they are guards for the fix, not reproducers.
- [ ] **Step 3: Write the migration.** Copy the latest `private.check_goal_earmark_event` (`…goal_commands.sql:588` to its `revoke`) into `supabase/migrations/20260925104000_goal_earmark_check_uses_financing_state.sql` as `create or replace`. Change **only** the balance block (`select count(*) into v_bad_balance … ;`) to:

```sql
  -- Same definitions as the reserve command (audit C1): earmark net of linked
  -- purchases plus what those purchases fulfilled must stay within the target,
  -- and the net earmark may never go below zero. UTC "today" matches the
  -- command until the Spec 1 space clock replaces both together.
  select count(*) into v_bad_balance
  from (
    select el.goal_id, sum(el.amount_minor) as event_contribution,
      state.earmarked_minor, state.fulfilled_minor,
      (select target_minor from public.goal_revisions where goal_id = el.goal_id order by id desc limit 1) as target
    from public.goal_earmark_lines el
    cross join lateral private.goal_financing_state(el.goal_id, (now() at time zone 'UTC')::date) state
    where el.event_id = p_event_id
    group by el.goal_id, state.earmarked_minor, state.fulfilled_minor
  ) totals
  where earmarked_minor < 0
    or (v_event.operation <> 'reverse' and event_contribution > 0 and earmarked_minor + fulfilled_minor > target);
```

  Keep the `revoke`, and keep every existing shape check above the block unchanged. The function stays `security definer` with the same `search_path`. This is the deferred-trigger lesson: it fires at COMMIT under the caller's role.
- [ ] **Step 4: Release files and run.** Update the release files (count → 55). Run the new file plus `tests/db/goal-funding.integration.test.ts`, `tests/db/goal-commands.integration.test.ts`, `tests/db/goal-projections.integration.test.ts`, `tests/db/constraint-trigger-names-ratchet.test.ts` and `tests/ops`.
  Expected: PASS, with no failures that are new against the Task 0 baseline.
- [ ] **Step 5: Ledger.** Append "The goal earmark check uses the command's own financing state".
  - **Why:** C1.
  - **If changed:** the command and the trigger must keep one definition of `earmarked` and `fulfilled`. Put any new rule in `goal_financing_state`, never in only one of them.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "fix(goals): allow topping a goal up after a linked purchase

The earmark trigger subtracted linked purchases twice (gross lines against
target minus every link), so any goal with a linked purchase refused new
reserves. It now checks the same net financing state as the command.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Whole-branch verification and handoff

**Files:**
- Modify: `docs/verification/2026-09-25-linking-audit.md`. Mark every finding fixed by this branch as `Fixed in <sha>`.
- Create: `docs/verification/2026-09-25-phase-0-results.md`

- [ ] **Step 1: Run the full gate.**
  Run: `pnpm typecheck && pnpm test:ui && pnpm test:worker && pnpm build && pnpm exec vitest run tests/ops`
  Expected: PASS.
- [ ] **Step 2: Run the DB suite against the baseline.**
  Run: `bash scripts/ops/docker-ssh-bridge.sh run -- pnpm test:db 2>&1 | tee "$TMPDIR/phase0-db-after.log"`
  Compare `grep -E "^ +(×|FAIL) " "$TMPDIR/phase0-db-after.log" | sort -u` with Task 0's list.
  Expected: no new failure names. Any baseline failure this branch fixed is noted as a bonus.
- [ ] **Step 3: Run Playwright.**
  Run: `pnpm test:e2e`
  Expected: 149 or more passed, 0 failed.
- [ ] **Step 4: Live click-through.** Follow the `run` skill and claude-in-chrome. If localhost is unreachable, retry 2–3 times, then fall back and say so. Check each of these:
  - revise an LBP goal: the amounts are unchanged
  - undo an older journal entry: its month nets to zero
  - publish allocation for next month
  - record a bill payment: the "Marked … as paid" notice appears
  - Upcoming shows overdue bills
- [ ] **Step 5: Code review.** Run superpowers:requesting-code-review on the branch diff. Resolve findings with superpowers:receiving-code-review.
- [ ] **Step 6: Write the results doc.** Include SHAs, gate outputs, the DB comparison, the Playwright counts and the click-through notes. Update the audit doc. Update RuFlo: delete `budget-tracking/state/lbp-goal-edit-corruption` once Tasks 1–3 are merged. Commit.
- [ ] **Step 7: Hand off.** Use superpowers:finishing-a-development-branch. Merging locally into `main` is Daniel's call. **No push, no `migrate:live`.**
  Tell Daniel the four new migrations and the catch-up of `20260919100000` are ready for his release run, with the pre-apply query from Task 3.

---

## Not in this plan (next batch candidates, from the audit)

**Needs its own design (Spec 1):**
- One space clock: E1, E2a, A7, D12.
- Plan vs Allocation single source of truth: A10, B9, E5.
- Month copy, close and rollover UI: A5, F9.
- Goal monthly targets into the plan: C3, B6.
- A transaction picker for bills and goal purchases: C4, D4.

**Bugs left for a follow-up batch (not approved into phase 0):**
- MEDIUM, traced: E4, A8, B13 (the Plan loan card's month), A9 (month picker forward), A6, B10 (archived targets), B11, B12, C5–C8, C12–C14, D6 (suspected), D11, D13, F2, F3, F5, F11.
