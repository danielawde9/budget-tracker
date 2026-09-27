# w2b onboarding / first-run fixes — source verification

**Date:** 2026-09-27. **Base:** `d464a52` (`main` via `ws/w2b-onboarding` worktree). **Branch:** `ws/w2b-onboarding`.
**Audit:** `docs/verification/2026-09-25-linking-audit.md` §3.6, findings F1, F2, F3, F5 (F4 = reported only).
**Owned paths:** `src/features/workspace/**` (plus colocated `*.test.tsx`). `src/app.tsx` is coordinator-owned and was not edited.

Single delivery task; one commit. Every item below started from a failing (red) test against the
pre-change implementation and ends green. The red test names were captured by restoring the
original `src/features/workspace/{onboarding-dialog,use-workspace,types}.ts` and deleting the new
`onboarding-progress.ts` while keeping the new tests.

## Commands and results

| Gate | Command | Result |
| --- | --- | --- |
| RED | `pnpm exec vitest run --config vitest.ui.config.ts src/features/workspace` (original implementation, new tests) | **FAIL** — 2 files failed / 1 passed; **14 failed / 18 passed (32)** |
| GREEN | `pnpm exec vitest run --config vitest.ui.config.ts src/features/workspace` | **PASS** — 3 files passed; **32 passed (32)** |
| `pnpm check:ui` (`pnpm typecheck && pnpm test:ui && pnpm build`) | as printed | **PASS** — `typecheck`: worker types current, both TS projects clean; `test:ui`: **104 files, 1362 tests passed**; `build`: **2047 modules transformed, built in 1.13s** (pre-existing >500 kB chunk-size advisory only). Exit 0. |

RED failing tests (exact names):

```
onboarding-dialog.test.tsx > OnboardingDialog > cancels an additional space from the close control and from Escape
onboarding-dialog.test.tsx > OnboardingDialog > records the setup progress after creating the first space
onboarding-dialog.test.tsx > OnboardingDialog > resumes an unfinished first run at the wallet step
onboarding-dialog.test.tsx > OnboardingDialog > adds a starting-balance step that reuses one request id across retries
onboarding-dialog.test.tsx > OnboardingDialog > resumes at the starting-balance step with the persisted request id
onboarding-dialog.test.tsx > OnboardingDialog > lets a person finish setup without a starting balance
use-workspace.test.tsx > useWorkspace > recovers an ambiguously-created wallet from a newly visible wallet of the same name and currency
use-workspace.test.tsx > useWorkspace > does not recover an ambiguous space from a same-named space that was already visible
use-workspace.test.tsx > useWorkspace > does not recover an ambiguous wallet from a same-named wallet that was already visible
use-workspace.test.tsx > useWorkspace > resumes an unfinished first run at the wallet step
use-workspace.test.tsx > useWorkspace > resumes at the starting-balance step and clears progress when finished
use-workspace.test.tsx > useWorkspace > persists progress for the first run and drops it once no space can match
use-workspace.test.tsx > useWorkspace > ignores malformed or foreign-user setup progress
use-workspace.test.tsx > useWorkspace > never invokes the create_wallet mutation when the visible-wallet baseline is unknown
```

## Per-item changes

### F1 — resumable first-run progress + recovery path

**Finding (verified):** onboarding showed only when there were zero spaces and stored no progress, so
abandoning after the space step landed on Home with no wallet.

- **New:** `src/features/workspace/onboarding-progress.ts` — a per-user, localStorage-scoped record
  `budget:onboarding:<userId>` = `{ spaceId, balanceRequestId }`. Reading is defensive: malformed JSON,
  empty fields and another user's key are ignored.
- **`use-workspace.ts`:** new `WorkspaceStatus` value `'onboarding'`. After `listSpaces`, if stored
  progress names a visible space, the hook exposes `onboardingSetup` (`{ spaceId, balanceRequestId }`,
  plus `wallet` when a wallet already exists) and sets status `'onboarding'` instead of `'ready'`.
  Stale progress (space no longer visible) is dropped. New methods `saveOnboardingProgress` (persist
  after the space step) and `finishOnboarding(spaceId)` (clear progress and refresh).
- **`onboarding-dialog.tsx`:** accepts `setup` (resume) and `onProgress`; starts at the wallet step
  when a space is pending, or the starting-balance step when the wallet already exists; calls
  `onProgress({ spaceId, balanceRequestId })` after the space step.

### F2 — cancel/close for "Add another space"

**Finding (verified):** Escape was swallowed and there was no close control.

- **`onboarding-dialog.tsx`:** new optional `onClose`. When present, the header renders a `×`
  `icon-button` (`aria-label` = existing **Close**/**إغلاق**), Escape calls `onClose` (guarded by
  `pending`), and each step's actions render a secondary **Cancel**/**إلغاء** button — the same
  conventions as `DialogShell` (`src/features/wallets/dialog-shell.tsx`). First-run passes no
  `onClose`, so it stays a required dialog and Escape is still swallowed (existing Arabic test).

### F3 — starting-balance step, idempotent

**Finding (verified):** no starting-balance step (Home showed $0.00), and entering a balance twice
double-counted.

- **`onboarding-dialog.tsx`:** new third step `'balance'` (only for `mode === 'first'` when
  `recordOpeningBalance` is provided). The amount is parsed with the existing
  `parsePositiveMinorAmount` (`src/features/wallets/money.ts`, not edited). One `requestId` is
  generated per wizard run and reused for every attempt, including across a resumed session, matching
  the `record_financial_event` idempotency key `(space_id, request_id)`. On success `onComplete`
  runs; a secondary **Skip**/**تخطَّ** finishes without a balance.
- **`types.ts`:** new `OpeningBalanceInput { spaceId, walletId, amountMinor, requestId }`.
- The opening-balance `effective_date` is supplied by the caller's wiring (see below), using the same
  UTC `new Date().toISOString().slice(0, 10)` as `transaction-dialog.tsx`.

### F5 — recovery accepts only the exact created entity

**Finding (traced):** recovery accepted any existing space or wallet with the same name
(`use-workspace.ts:95,114`).

- **`use-workspace.ts`:** `createFirstSpace` now matches a recovered space only when its id was **not**
  in the last loaded visible set (`spacesRef`) and name/kind match. `createFirstWallet` now performs a
  pre-mutation `listWallets` snapshot and matches a recovered wallet only when its id is **not** in that
  snapshot and name/currency match. If the pre-read cannot establish the baseline, the wallet command
  is refused rather than retried blind. This mirrors the already-shipped `useWallets.createWallet`
  convention (`!knownWalletIds.has(wallet.id)`).

### Behavior change (needed by F1/F3): onboarding completion owns the refresh

`createFirstWallet` no longer calls `load(false)` itself. The wizard stays mounted through the
starting-balance step and the caller's `onComplete` now performs `finishOnboarding` (clear progress +
refresh). The additional-space flow is unchanged in effect because its `onComplete` already refreshes.

## `src/app.tsx` wiring needed (coordinator)

Not edited here; without it the new behavior is inert in the running app.

1. **Route the resume state to the wizard** (currently only `status === 'empty'`, `src/app.tsx:183-185`):

```tsx
if (workspace.status === 'empty' || workspace.status === 'onboarding') {
  return <OnboardingDialog
    locale={props.locale}
    setup={workspace.onboardingSetup}
    createSpace={workspace.createFirstSpace}
    createWallet={workspace.createFirstWallet}
    onProgress={workspace.saveOnboardingProgress}
    recordOpeningBalance={async (input) => {
      await props.walletsGateway.recordEvent({
        spaceId: input.spaceId,
        requestId: input.requestId,
        kind: 'opening_balance',
        effectiveDate: new Date().toISOString().slice(0, 10),
        movements: [{ walletId: input.walletId, amountMinor: input.amountMinor }],
      });
    }}
    onComplete={(spaceId) => { void workspace.finishOnboarding(spaceId); }}
  />;
}
```

2. **Let the additional-space dialog cancel** (`src/app.tsx:189-198`): add
   `onClose={() => setAddingSpace(false)}`.

3. **F4 language persistence (coordinator-owned):** `ConfiguredApp` initializes `locale` to `'en'` on
   every load (`src/app.tsx:252`) and toggles it only in memory (`src/app.tsx:271` for the auth
   screen, `:298` for the workspace). The exact change: persist the chosen locale
   (e.g. `localStorage.setItem('budget:locale', next)`) in both `onLocaleChange` handlers, and
   initialize with `useState<Locale>(() => readStoredLocale())` at `:252`. Nothing in the owned
   workspace paths depends on this.

## Copy and starter-category decisions deferred to the owner

No user-facing copy text was changed and no starter categories were added. The new step reuses
existing application strings rather than inventing copy — these are the only literals added to the
dialog's local `copy` object:

- Step/title: **Opening balance** / **رصيد افتتاحي** (already in `wallets-page.tsx`, `transaction-dialog.tsx`, `home-screen.tsx`).
- Amount field: **Amount** / **المبلغ** (already in `transaction-dialog.tsx`).
- Primary action: **Record opening balance** / **تسجيل رصيد افتتاحي** (composed in `transaction-dialog.tsx` as `Record` + `opening balance`).
- Validation: **Enter a valid positive amount.** / **أدخل مبلغًا موجبًا صالحًا.** (already in `transaction-dialog.tsx`).
- Skip: **Skip** / **تخطَّ** (already in `record-sheet.tsx`; `occurrence-detail.tsx` uses the variant **تخطٍ**).
- Close / Cancel: **Close**/**إغلاق**, **Cancel**/**إلغاء** (already in `dialog-shell` callers).

Decisions left to the owner: (a) whether the starting-balance step is mandatory or skippable
(this branch makes it skippable); (b) the Arabic spelling of **Skip** (**تخطَّ** vs **تخطٍ**);
(c) whether to add an intro paragraph on the balance step (omitted to avoid new copy);
(d) the deferred roadmap items still open in the audit (§4): persisted language, starter-category
suggestions, and a per-space timezone/payday.

## Remaining limitations

- **`app.tsx` not wired in this branch.** A step-by-step red→green proof runs at the hook/dialog
  level; the end-to-end browser flow (resume, cancel, starting balance) is **not** exercised here and
  must be re-checked after the wiring above. No Playwright/e2e run was performed (per instructions),
  and no DB/ops suite was run.
- **F5 residual ambiguity.** `create_space`/`create_wallet` still accept no request id (out of scope:
  `supabase/**` is frozen and no migration was added). Recovery proves "new since the last read"
  rather than cryptographic exactness. The space baseline is the last loaded visible set (not a fresh
  pre-read), so a space created by another client in the same window could be treated as new; wallets
  use a fresh pre-read.
- **Cross-device/browser resume.** Progress lives in the browser's localStorage per user. A returning
  user with a cleared store, or on another device, is not recovered by the stored-progress path.
- **Resume wallet selection.** When a wallet already exists, resume advances to the balance step using
  the first active wallet; a space with several wallets created outside the wizard is an edge case.
- **Opening-balance date.** The balance is dated the caller's UTC "today", matching the existing
  wallet dialog; it does not use a per-space clock (the phase-1 one-clock work is still open).
- **`pnpm check:ui` scope.** It is `typecheck + UI unit tests + build` only; it does not include DB,
  worker, ops or e2e suites.
