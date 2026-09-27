# W3A settlement gaps (D3, D4, D7)

**Date:** 2026-09-27. **Worktree:** `/Users/daniel/Desktop/Daniel/budget-tracking/.worktrees/w3a-settlement`
**Branch:** `ws/w3a-settlement`. **Method:** TDD (failing test first, then the minimal fix), per
`docs/verification/2026-09-25-linking-audit.md` rows D3 (rank 7), D4, D7 and §3.4, and `docs/decisions.md`.

**Scope:** D3 (partial/over-payment matching), D4 (manual picker + a settleable debt occurrence),
D7 (automatic retry + unlink UI). **Same currency only** — cross-currency settlement is out of scope.
No SQL applied, nothing pushed, no full Playwright e2e run, `routes.tsx` read but not edited.

Owned paths only: `src/features/recurring/**` (+ colocated tests), `docs/decisions.md`,
this file. `src/features/control-room/routes.tsx` and all `OFF LIMITS` paths were not touched.

## 1. Red → green

### Red (new tests against the pre-change implementation)

The implementation files were stashed (`git stash push -u -- <the changed impl files>`) while the
new/changed test files stayed, so the new assertions ran against the old code:

```
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/recurring/auto-settle.test.ts \
  src/features/recurring/settle-notice-banner.test.tsx \
  src/features/recurring/confirm-payment-dialog.test.tsx \
  src/features/recurring/occurrence-detail.test.tsx \
  src/features/recurring/link-with-retry.test.ts \
  src/features/recurring/linkable-events.test.ts \
  src/features/recurring/unlink-settlement.test.ts
```

Result: `Test Files 7 failed (7)` / `Tests 19 failed | 52 passed (71)`. The three new modules
(`link-with-retry`, `linkable-events`, `unlink-settlement`) fail to load; the 19 assertion
failures are exactly the new D3/D4/D7 behaviors (partial/over matching, the picker, the debt
dialog, the notice wording, the unlink button).

### Green (implementation restored)

```
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/recurring/auto-settle.test.ts \
  src/features/recurring/settle-notice-banner.test.tsx \
  src/features/recurring/confirm-payment-dialog.test.tsx \
  src/features/recurring/occurrence-detail.test.tsx \
  src/features/recurring/link-with-retry.test.ts \
  src/features/recurring/linkable-events.test.ts \
  src/features/recurring/unlink-settlement.test.ts \
  src/features/recurring/settle-loan-repayment.test.ts
```

Result: `Test Files 8 passed (8)` / `Tests 93 passed (93)`.

Whole feature dir: `src/features/recurring/` → `Test Files 19 passed (19)` / `Tests 205 passed (205)`.

## 2. D3 — auto-settle settles partial and over-payments

**Files.** `src/features/recurring/auto-settle.ts` (+ `auto-settle.test.ts`),
`src/features/recurring/settle-notice-banner.tsx` (+ `.test.tsx`). Rule recorded in
`docs/decisions.md` (2026-09-27, "Auto-settle settles partial and over-payments (D3)").

**Change.** `findSettleableOccurrence` keeps the exact-remaining look-alike rule and adds a
fallback for when **zero** schedules are exact look-alikes: the schedules it already filtered
(kind/currency/category/date, `remainingMinor > 0`, oldest unpaid occurrence per schedule) become
candidates — exactly one candidate settles it, two or more stay `ambiguous`. `autoSettleRecordedEvent`
links `min(entry, remaining)`: a smaller entry is a partial payment (`remainsDue: true`), a larger
entry settles the bill and reports the surplus as `unallocatedMinor` (+ `currency`).
`SettleNoticeBanner` words both honestly.

**Money rule (the one judgment call).** The surplus of an over-payment is **not** credited to the
bill beyond its remaining amount and is **not** assigned to another bill — it is reported. This
matches the existing `settleLoanRepayment` per-instalment cap (`min(remaining, left)`). The DB
permits `settled > expected` (2026-09-14 recurring DB plan: "Allow confirmed overpayment"), so the
alternative (link the full entry, show the overage on the occurrence) was available; it was rejected
because it would attribute money the matcher cannot place. Cross-currency is untouched. If the owner
wants the alternative, it is a one-line change to the link amount in `autoSettleRecordedEvent`.

**Preserved behavior (final review I4).** A payment larger than a schedule's oldest unpaid
remaining is *not* settled while that schedule also has an older unpaid occurrence — the existing
`none` result for that case is unchanged (one look-alike whose oldest occurrence is not the exact
one still returns `none`).

## 3. D4 — picker over existing wallet events + a settleable debt occurrence

**Files.** `src/features/recurring/linkable-events.ts` (new, + `.test.ts`),
`src/features/recurring/confirm-payment-dialog.tsx` (+ `.test.tsx`),
`src/features/recurring/occurrence-detail.tsx` (+ `.test.tsx`),
`src/features/recurring/upcoming-page.tsx`.

**Change.**
- The pasted "Transaction reference id" is gone. "Link an existing transaction" now shows a
  `<select>` of existing wallet events, loaded read-only through the wallets gateway
  (`loadLinkableEvents` → `searchJournal`, `src/features/recurring/linkable-events.ts`). It offers
  only a same-kind, single-currency, positive, unreversed event (`expense`/`income`/`loan_repay_borrowing`
  for a `debt_payment`), and picking one pre-fills the amount.
- The dialog's `allowConfirm` gate is removed, so a `debt_payment` occurrence offers "Record payment"
  as well as "Link an existing transaction". "Record payment" posts through the existing
  `confirm_scheduled_occurrence` → `record_loan_repayment` server path (already supported; no new
  loan-posting path). A debt occurrence can therefore be settled directly — the D4 dead end is closed.

**Interpretation note.** "a single posting path, so a debt occurrence can be settled" was read as:
use the dialog's one posting command (`confirm_scheduled_occurrence`) for every occurrence kind,
including debt, rather than keeping debt link-only. The picker is additive. (The alternative reading —
drop the "Record payment" mode entirely — would break `e2e/recurring.visual.spec.ts`, which drives
"Record payment" from the same dialog, and `e2e/` is not an owned path.)

## 4. D7 — automatic retry and unlink

**Files.** `src/features/recurring/link-with-retry.ts` (new, + `.test.ts`),
`src/features/recurring/settle-loan-repayment.ts`, `src/features/recurring/auto-settle.ts`,
`src/features/recurring/unlink-settlement.ts` (new, + `.test.ts`),
`src/features/recurring/occurrence-detail.tsx` (+ `.test.tsx`).

**Automatic retry (done).** Every settlement link now goes through
`linkScheduledPaymentWithRetry`: on an ambiguous transport failure (a timeout/connection drop, what
`planningRpc`'s 15s abort produces) it first reconciles through `findCommand`, then retries **once**
with the same request id (idempotent under its request id, so it can never double-post). A second
uncertain failure is rethrown; a non-transport (domain) failure is never retried.

**Unlink UI (implemented for the case the UI can know).** `OccurrenceDetail` captures the linked
financial event id from a confirm/link command's own result and shows "Unlink payment", which reverses
that transaction through the wallets gateway (`unlinkSettlementPayment` → `reverseEvent`). Settlement
is append-only and a reversal nets the link out, so the bill reopens. No new RPC.

## 5. Migration / RPC needs

| Item | Needs a migration or RPC? |
| --- | --- |
| D3 matching + notice | **No.** Client-side rule + existing `link_scheduled_payment`. |
| D4 picker | **No.** Read-only `journal_search_page` (existing) + existing `link_scheduled_payment`. |
| D4 debt settle | **No.** Existing `confirm_scheduled_occurrence` → `record_loan_repayment`. |
| D7 retry | **No.** Existing `find_planning_command` + request-id replay. |
| D7 unlink, **durable** | **YES — HARD STOP, not added.** |

**The exact ask (D7 durable unlink).** A mistaken match made *earlier* — e.g. by auto-settle when the
entry was recorded — cannot be unlinked from the screen, because the occurrence row never carries the
linked financial event id. `scheduled_occurrence_page` / `scheduled_overdue_page`
(`supabase/migrations/20260914170000_recurring_schedules.sql:1197`,
`supabase/migrations/20260925103000_scheduled_overdue_page.sql:55`) return
`currentEventId` = `max(id)` of `occurrence_events`, **not** `occurrence_events.linked_event_id`.
To let the detail reverse it, expose the latest `link`/`confirm` row's `linked_event_id` per
occurrence — either add a field to those two read functions, or add one bounded
"occurrence settlement events" read — and the `OccurrenceDetail` unlink affordance already accepts
that id (`onUnlink`). That is a migration and belongs to the coordinator. Until then, a person can
still unlink by reversing the expense in the Wallets journal (the same mechanic), just not from the
bills screen.

## 6. Coordinator wiring needed (`src/features/control-room/routes.tsx` — not edited)

The picker and unlink stay inert until `routes.tsx` supplies two props to `UpcomingPage`
(rendered inside `UpcomingBillsSection`). Add `walletsGateway={gateways.wallets}` to the
`<UpcomingBillsSection …>` at `routes.tsx:704-714`, thread it through `UpcomingBillsSection`'s props
(`routes.tsx:431-441`), and on the `<UpcomingPage …/>` at `routes.tsx:467-470` add:

```tsx
import { loadLinkableEvents } from '../recurring/linkable-events.js';
import { unlinkSettlementPayment } from '../recurring/unlink-settlement.js';
// …
loadLinkableEvents={(query) => loadLinkableEvents(props.walletsGateway, props.spaceId, query)}
onUnlink={(eventId) => unlinkSettlementPayment(props.walletsGateway, props.spaceId, eventId, todayIso())}
```

Until this lands: the "Link an existing transaction" mode shows
"Linking a transaction is unavailable right now." (`confirm-payment-dialog.tsx`), the debt
"Record payment" path works, and the unlink button is hidden. `gateways.wallets` is non-null
(`routes.tsx:777` already uses it directly).

## 7. `pnpm check:ui` result

```
pnpm check:ui
```

(`typecheck` = `check:worker-types && tsc --noEmit && tsc -p tsconfig.worker.json`;
`test:ui` = `vitest run --config vitest.ui.config.ts`; `build` = `tsc --noEmit && vite build`.)

Result: **pass.**

- `Test Files 109 passed (109)` / `Tests 1405 passed (1405)`.
- `tsc` clean; `vite build` → `✓ 2051 modules transformed` / `✓ built in 1.58s` (only the existing
  chunk-size advisory).

Not run (per instructions): the full Playwright e2e suite, any SQL, any push/deploy. The
`--config vitest.ui.config.ts` form is required in this worktree: the repo's default
`vitest.config.ts` excludes `**/.worktrees/**`.

## 8. Remaining limitations / notes

- **D7 durable unlink** needs the linked-event read above (§5). The implemented unlink covers only a
  link made in the same occurrence-detail view (the command result carries the event id).
- **D4 picker is recent-first.** It shows the 50 most recent matching events
  (`LINKABLE_EVENT_LIMIT`) from `journal_search_page`; older events are not listed. A search/filter
  over the journal could replace it later.
- **D3 mixed-candidate ambiguity.** A partial payment that could belong to more than one unpaid bill
  (no exact match) is reported `ambiguous` rather than guessed — deliberate, per "do not invent
  financial rules".
- **D3 over-payment surplus** is reported, not assigned (§2). Not a defect; a recorded product choice.
- **D4 debt picker filter** is by event kind + currency only: `JournalEvent` carries no loan id, so the
  picker cannot pre-filter to the occurrence's own loan. The server rejects a wrong loan
  (`the referenced event must be a repayment on the occurrence's own loan`), surfaced through
  `classifyRecurringError`.
- **D4 "single posting path"** is interpreted as §3 (one posting command for every kind). If the owner
  meant removing the Record-payment mode entirely, that is a larger change that also touches
  `e2e/recurring.visual.spec.ts`.
- **Debt "Record payment"** now posts a real loan repayment from the bills screen. The 2026-09-14
  decision discouraged that ("do not invent a new loan-posting path"); this reuses the existing
  `record_loan_repayment` path rather than inventing one, and the task explicitly requires a debt
  occurrence to be settleable.
