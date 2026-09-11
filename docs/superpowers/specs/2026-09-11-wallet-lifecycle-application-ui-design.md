# Wallet Lifecycle Application and UI Design

## Status and scope

This specification activates the already-merged
`20260911100000_wallet_lifecycle_commands.sql` contract
(`public.rename_wallet`, `public.archive_wallet`, `public.restore_wallet`,
`public.get_wallet_command_result`) in the existing Wallets application and UI.
It is milestone 2 of `docs/superpowers/specs/2026-09-11-wallet-rename-archive-design.md`,
whose "Application and UI" section this document expands into implementation
detail; nothing here changes an already-approved product decision. It stays
inside the application/UI layer: no migration, database object, ledger
command, authentication, Household, Categories, deployment, or production-data
change is authorized. The one cross-feature touch is a single localized error
case added to the existing Loans correction dialog (below).

Wallets v2 adds rename, archive, and restore to the existing Wallets
workspace. It preserves the existing projection-first read model (balances
derived only from `wallet_balances`), request-idempotent protected commands,
append-only journal, and the existing responsive bilingual visual language.

## Product behavior

- Every active wallet row offers **Rename** and **Archive** actions.
- **Rename:** opens a dialog with the current name pre-filled. Save is
  disabled while the trimmed value is blank or unchanged from the current
  name. On success the new name is the only name — it renders everywhere the
  wallet appears, including past journal entries.
- **Archive:** opens a dialog that explains the wallet leaves active balances
  and every wallet picker, its history stays visible, and it can be restored.
  - At a zero balance, a single confirmation checkbox gates one **Archive
    wallet** action, mirroring the existing Undo and Archive-category
    confirmation pattern.
  - At a non-zero balance, the dialog shows that balance and explains "Undo
    or move its transactions until the balance is 0" and offers no archive
    action at all — not a disabled button, no control to submit.
- **Archived wallets:** a collapsed `<details>` section, `Archived wallets
  (n)`, renders below the active balances list and is absent entirely when
  there are none. Each row shows the wallet's name, currency, the date it was
  archived, and a **Restore** action.
- **Restore:** opens a confirmation dialog with a single **Restore** button
  and no checkbox — restoring is harmless and always reversible by archiving
  again.
- **Undo gating:** a journal entry whose movements touch an archived wallet
  renders "Restore `<wallet>` to undo this" instead of the Undo button; the
  wallet name is DB-sourced and rendered inside `<bdi>`.
- **Loans:** correcting a loan entry whose original event moved money through
  a since-archived wallet is refused by the database's movement guard. The
  existing Loans correction dialog shows "This entry's wallet is archived.
  Restore it in Wallets first." instead of the raw database message. No other
  Loans behavior changes; its wallet pickers already exclude archived wallets
  (`archivedAt === null` filters in `loan-dialogs.tsx`, unchanged).
- Deletion is never offered anywhere. Archive is the only removal path.

## Architecture and data flow

### Types (`src/features/wallets/types.ts`)

`WalletsSnapshot` gains `archivedWallets: readonly WalletProjection[]`
alongside the existing (active-only) `wallets`. `JournalMovement` gains
`walletArchived: boolean`, derived from the same bounded wallet read used to
compose the movement — no new query.

New input and result types:

```ts
export interface RenameWalletInput {
  spaceId: string;
  requestId: string;
  walletId: string;
  name: string;
}

export interface WalletLifecycleInput {
  spaceId: string;
  requestId: string;
  walletId: string;
}

export type WalletCommandKind = 'rename_wallet' | 'archive_wallet' | 'restore_wallet';

export interface WalletCommandRecord {
  commandKind: WalletCommandKind;
  walletId: string;
}
```

`WalletsGateway` adds:

```ts
renameWallet(input: RenameWalletInput): Promise<CommandResult>;
archiveWallet(input: WalletLifecycleInput): Promise<CommandResult>;
restoreWallet(input: WalletLifecycleInput): Promise<CommandResult>;
getWalletCommandResult(spaceId: string, requestId: string): Promise<WalletCommandRecord | null>;
```

`CommandResult` is unchanged (`{ id?: string; eventId?: string }`); the three
new commands resolve `{ id: <walletId> }`, matching `create_wallet`.

### Gateway (`supabase-wallets-gateway.ts`)

- `loadWalletRows` already selects `archived_at`; `loadSnapshot` currently
  returns every row as `wallets`. It changes to partition the same rows into
  `wallets` (`archivedAt === null`) and `archivedWallets`
  (`archivedAt !== null`, sorted by `archivedAt` descending — newest archived
  first) — one extra `Array.prototype.filter`/`sort` pass over data already
  read, no new query or read-bound change.
- `composeEvents` already builds a full `wallets` map (active and archived)
  to resolve movement names; each `JournalMovement` gains
  `walletArchived: wallet.archivedAt !== null` alongside the existing
  `walletName`/`currency`.
- `MutationName` gains `'rename_wallet' | 'archive_wallet' | 'restore_wallet'`.
  `commandResult` already special-cases `create_wallet` to return `{ id }`
  (every other mutation returns `{ eventId }`); it extends that branch to the
  three new names, since all four return a bare wallet id.
- Three new command functions call `rename_wallet`, `archive_wallet`,
  `restore_wallet` through the existing `runCommand` helper with
  `p_space_id`, `p_request_id`, `p_wallet_id`, and (rename only) `p_name`.
- `getWalletCommandResult` is a new bounded read (not `runCommand` — it's a
  `stable` function, called directly through `client.rpc` and parsed like a
  single-row read): selects `command_kind`, `wallet_id` and validates
  `command_kind` against the three known values before returning
  `{ commandKind, walletId }`, or `null` when Postgres returns zero rows.

### Hook (`use-wallets.ts`)

- `RetryCommand` gains `{ kind: 'rename'; requestId; input: RenameWalletInput }`,
  `{ kind: 'archive'; requestId; input: WalletLifecycleInput }`,
  `{ kind: 'restore'; requestId; input: WalletLifecycleInput }`.
- `reconcileCommand` gains three branches calling the matching gateway
  method. Its existing ambiguous-transport catch already retries via a
  command-specific lookup for `record`/`reverse`
  (`findEventByRequestId`/categorized lookup); the three new kinds add a
  lookup through `gateway.getWalletCommandResult(spaceId, requestId)` —
  present and matching `commandKind` means reconciled success; absent means
  genuinely ambiguous, offering the existing explicit "Retry unchanged"
  affordance. This mirrors, not duplicates, the existing pattern; no new
  concept.
- Three new callbacks (`renameWallet`, `archiveWallet`, `restoreWallet`)
  generate one browser request ID each and call `withPending(() =>
  reconcileCommand(command))`, identical in shape to the existing
  `reverseEvent`.
- The hook's returned `archivedWallets` passes through from `view` exactly
  like `wallets` does today. No optimistic state anywhere — every command
  refreshes the full snapshot on success, per the existing rule.

### Errors (`src/features/wallets/errors.ts`, new file)

Mirrors `src/features/categories/errors.ts`'s exact shape
(`classifyWalletError(cause): WalletErrorView`, `localizeWalletError(error,
locale)`, an EN object built inline and an AR lookup keyed by code) so a
maintainer who knows one reads the other immediately. Codes and their exact
triggering database message:

| Code | Message match | EN message | EN recovery |
| --- | --- | --- | --- |
| `missing_membership` | `active space membership` / `permission denied` | You no longer have access to this space. | Refresh the visible spaces, then choose one you can still access. |
| `already_has_name` | `the wallet already has this name` | This wallet already has this name. | Choose a different name, or close without saving. |
| `invalid_name` | `the wallet name must be 1 to 120 characters` | Enter a name between 1 and 120 characters. | Shorten or complete the name and try again. |
| `wallet_archived` | `the wallet is archived` | This wallet is archived. | Restore it first, then try again. |
| `already_archived` | `the wallet is already archived` | This wallet is already archived. | Refresh the wallet list to see its current state. |
| `not_archived` | `the wallet is not archived` | This wallet is not archived. | Refresh the wallet list to see its current state. |
| `non_zero_balance` | `the wallet balance must be zero to archive` | This wallet still has money in it. | Undo or move its transactions until the balance is 0. |
| `request_collision` | `request ID was already used with different data` | This request no longer matches the original details. | Review the current values and submit them as a new request. |
| `unknown` | (fallback) | This wallet request was not accepted. | Check the details and try again. If the problem continues, refresh the selected space. |

The `non_zero_balance` recovery text is reused verbatim as the Archive
dialog's non-zero-balance explanation (Product behavior, above) so the same
sentence appears whether the rejection is server-confirmed or pre-empted by
the dialog reading the wallet's own balance.

### Undo-gating helper (`wallets-page.tsx`)

A pure function `archivedMovementWallet(event: JournalEvent): string | null`
returns the first archived wallet's name among an event's movements, or
`null`. `canCorrect`'s existing boolean guards whether the Undo button can
render at all (kind/loan/reversal checks, unchanged); when `canCorrect` is
true but `archivedMovementWallet(event)` is non-null, the footer renders the
gating message instead of the button. Both states are mutually exclusive with
the existing `event.loanLinked` "Manage in Loans" footer button, which
already excludes loan-linked events from `canCorrect`.

### New dialogs (mirroring existing single-purpose dialog files)

| File | Mirrors | Props (beyond `locale`, `pending`, `onClose`) |
| --- | --- | --- |
| `rename-wallet-dialog.tsx` | `wallet-dialog.tsx` | `wallet: WalletProjection`, `ambiguous`, `onClearAmbiguous()`, `onRetry()`, `onSubmit(name: string)` |
| `archive-wallet-dialog.tsx` | `archive-category-dialog.tsx` | `wallet: WalletProjection`, `ambiguous`, `onClearAmbiguous()`, `onRetry()`, `onSubmit()` |
| `restore-wallet-dialog.tsx` | `archive-category-dialog.tsx` (no checkbox) | `wallet: WalletProjection`, `ambiguous`, `onClearAmbiguous()`, `onRetry()`, `onSubmit()` |

Each follows the existing shell/pending/success/ambiguous-retry/refresh-not-
required pattern already used by every wallet and category dialog — these
commands need no `refresh-required` branch (unlike `createWallet`) because
their reconciliation lookup (`getWalletCommandResult`) is itself the bounded
read the existing pattern falls back to, so the hook always resolves a
definite outcome before the dialog needs to show anything beyond the existing
ambiguous/ retry states.

`wallets-page.tsx`'s `OpenDialog` union gains `{ rename: WalletProjection } |
{ archive: WalletProjection } | { restore: WalletProjection }` alongside the
existing `'wallet' | 'transaction' | { correction: JournalEvent }`.

## Error and recovery behavior

| Cause | Manager sees |
| --- | --- |
| Non-zero balance | This wallet still has money in it. Undo or move its transactions until the balance is 0. (shown in the Archive dialog before any submission is possible, and again if the server rejects) |
| Wallet archived (rename target, or Loans correction through it) | This wallet is archived. Restore it first. / (Loans) This entry's wallet is archived. Restore it in Wallets first. |
| Already archived / not archived | This wallet was already changed. Refresh the wallet list. |
| Unchanged / invalid name | Inline, field-level; form values kept, Save stays disabled rather than submitting and failing. |
| Membership lost | Existing space-unavailable handling (unchanged). |
| Ambiguous transport | Reconcile via `getWalletCommandResult`; otherwise "Retry unchanged". |

## Accessibility, localization, and responsive behavior

Every new string ships in English and Arabic. Wallet names render inside
`<bdi>` everywhere, including inside button accessible names ("Rename Daily
USD", "إعادة تسمية Daily USD" — built the same way `Correct
${label.toLowerCase()}` already is, just with the wallet name substituted for
the event kind label). Every new dialog reuses `DialogShell` unchanged
(focus trap, Escape, focus restoration, full-screen on mobile — no new CSS
needed there). The archived-wallets `<details>` reuses the existing
`.account-menu`-style native disclosure already in the codebase
(`application-shell.tsx`); its `<summary>` is a real interactive element with
no additional ARIA. New list rows (`archived-wallets` section) reuse
`.wallet-list`'s existing grid layout class rather than inventing new CSS,
with one added modifier class for the muted archived-date text; on narrow
viewports it inherits the existing `.wallet-list li { gap: 12px }` mobile
rule.

## Verification requirements

Unit tests (Vitest + Testing Library, English and Arabic), extending the
existing suites rather than duplicating their setup:

- `rename-wallet-dialog.test.tsx`: pre-filled name; Save disabled while blank
  or unchanged, enabled once changed; submits the trimmed name; every
  `errors.ts` code renders its exact copy; ambiguous retry reuses the same
  request.
- `archive-wallet-dialog.test.tsx`: zero-balance wallet shows the checkbox and
  submit path (mirrors `archive-category-dialog.test.tsx`'s confirmation
  test); non-zero-balance wallet shows the balance and explanation with no
  submit control present at all (queried by role, not just visually hidden);
  already-archived rejection surfaces its exact copy.
- `restore-wallet-dialog.test.tsx`: single Restore button, no checkbox,
  present from first render; not-archived rejection surfaces its exact copy.
- `wallets-page.test.tsx` additions: Rename/Archive buttons render per active
  wallet and open the right dialog; the archived section is absent with zero
  archived wallets and renders exactly `n` rows with Restore actions when
  non-empty; an event touching an archived wallet renders the gating message
  instead of an Undo button and vice versa; a full rename → archive →
  restore round trip through `InMemoryWalletsGateway` ends with the wallet
  back in the active list under its new name.
- `use-wallets.test.tsx` additions: each of the three new hook methods posts
  the exact gateway call shape, refreshes on success, and reconciles an
  ambiguous transport failure via `getWalletCommandResult` the same way
  `reverseEvent`'s existing tests prove for `findEventByRequestId`.
- `supabase-wallets-gateway.test.ts` additions: `loadSnapshot` partitions
  active and archived wallets from one wallet read; each new command maps its
  RPC name and args exactly; `getWalletCommandResult` parses a present row
  and returns `null` for an empty result.
- `loans/errors.test.ts` addition: the new `archived_wallet` code classifies
  the exact `every wallet movement must use an active wallet` message; its
  Arabic pair is asserted the same way every other `ErrorNotice` case already
  is in `loans-page.test.tsx` / `loan-dialogs` coverage.

Playwright (extends `e2e/wallets.visual.spec.ts`, desktop + one Arabic mobile
screenshot, following existing fixture and screenshot-path conventions):

- Rename a wallet and see the new name everywhere, including in one already-
  posted journal entry.
- Archive a zero-balance wallet, see it leave the active list and the
  transaction-dialog wallet picker, see it appear under "Archived wallets",
  and see its history stay visible with the existing Undo action replaced by
  the gating message.
- Attempt to archive a wallet with a balance and confirm no archive action is
  offered.
- Restore an archived wallet and confirm it returns to the active list, its
  history's Undo action returns, and a new transaction can be posted to it.
- Arabic mobile: the archived-wallets disclosure and its restore flow render
  correctly right-to-left.

Final gate, run once per delivery task rather than only at the end: focused
suite for the files just touched, full `pnpm test:ui`, `pnpm typecheck`,
`pnpm build`, the affected Playwright specs, and `git diff --check`. No
database, migration, or deployment command is part of this milestone's
verification — the protected commands are already live in the local/dev
database from milestone 1.
