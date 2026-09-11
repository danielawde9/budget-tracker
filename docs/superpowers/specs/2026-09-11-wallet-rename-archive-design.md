# Wallet Rename, Archive, and Restore Design

## Status and scope

This specification defines how a space member renames, archives, and restores a
wallet. It covers one database migration and the Wallets application/UI that
uses it, delivered as two milestones (database first, then UI). It does not
change posting shapes, balances, reversals that touch only active wallets,
Categories, Household membership, deployment, or production data. Loans changes
are limited to one localized refusal message (see Application and UI). Applying
the migration to a hosted project is a separate, explicitly requested operation.

It closes roadmap item X6 ("Archive a wallet",
`docs/product/2026-09-11-competitor-research-and-roadmap.md`) and adds rename and
restore, which the owner requested on 2026-09-11 after undoing a mistaken income
and asking how to remove the wallet.

Preserved invariants:

- the financial journal stays append-only; no wallet or history row is deleted;
- browser and background roles keep zero direct write privilege on `wallets`;
- every wallet change goes through a request-idempotent protected command;
- balances remain derived only from `public.wallet_balances`.

## Approved product semantics

- **Rename:** an active wallet can be renamed. The trimmed name follows the
  creation rule (1–120 characters). The new name is the only name: it renders
  everywhere the wallet appears, including past journal entries and Loans.
  Renaming to the current name is rejected as a no-op. Archived wallets cannot
  be renamed; restore first.
- **Archive:** an active wallet whose derived balance is exactly zero can be
  archived. Archiving hides it from active balances and every wallet picker;
  its history stays visible. A non-zero balance is refused, and the UI tells the
  manager to undo or move its transactions first.
- **Restore:** an archived wallet can be restored at any time. It returns to
  active balances and pickers unchanged.
- **Archived wallets take no money movements.** No posting, undo (reversal), or
  loan entry may move money in or out of an archived wallet. To undo an old
  transaction on an archived wallet, the manager restores the wallet first.
- **Authorization:** any active member of the space may rename, archive, or
  restore, matching `create_wallet` and `archive_category`.
- **Deletion stays out of scope.** Archive is the only removal path.

## Approaches considered

### 1. In-place wallet state plus an append-only command log — selected

Commands update `wallets.name` and `wallets.archived_at` and append one row to a
new `wallet_command_requests` log recording who changed what, when, and (for
renames) the previous and new name. This mirrors `archive_category` and
`category_command_requests`. Every existing read path (wallets gateway, Loans
gateway, workspace reconciliation, `wallet_balances`, posting validation) keeps
working unchanged because the current state stays on `wallets`.

### 2. Append-only name and archive revision tables

Current state would be the latest revision. It never overwrites, but every
wallet read, `wallet_balances`, and each posting command's active-wallet check
would have to resolve the latest revision. The audit value equals approach 1's
log, at a much larger and riskier change surface. Rejected.

### 3. Client-side table writes

Impossible by design: browser and `service_role` have no `UPDATE` on `wallets`
(decisions ledger, 2026-09-07), and
`tests/db/financial-boundary-coverage.integration.test.ts` enforces it. Rejected.

## Schema changes

One forward-only migration adds:

### `public.wallet_command_requests`

| Column | Rule |
| --- | --- |
| `space_id` | not null, references `public.spaces` on delete restrict |
| `request_id` | not null; primary key is `(space_id, request_id)` |
| `command_kind` | not null, `rename_wallet`, `archive_wallet`, or `restore_wallet` |
| `request_fingerprint` | not null `bytea` (SHA-256 of a versioned JSON payload) |
| `wallet_id` | not null; `(wallet_id, space_id)` references `public.wallets (id, space_id)` on delete restrict |
| `actor_id` | not null, references `auth.users` on delete restrict |
| `previous_name`, `name` | both non-null for `rename_wallet`, both null otherwise (CHECK); `name` obeys the 1–120 trimmed rule |
| `created_at` | not null, default `now()` |

Index `(space_id, wallet_id)`. RLS enabled with no policy (reads go through
`get_wallet_command_result`). Guards, as for `category_command_requests`:
owner-only insert (`private.require_table_owner_write()`), row-level
`BEFORE UPDATE OR DELETE` rejection, and statement-level
`BEFORE DELETE OR TRUNCATE` rejection (so zero-row deletes are refused too).
`INSERT/UPDATE/DELETE/TRUNCATE` revoked from `anon`, `authenticated`, and
`service_role`.

### Guards on `public.wallets`

- `BEFORE UPDATE` row trigger: only the table owner may update; `id`,
  `space_id`, `currency`, and `created_at` must not change; `archived_at` may
  only move between null and non-null (never from one timestamp to another).
- `BEFORE DELETE` row trigger and `BEFORE DELETE OR TRUNCATE` statement trigger
  reject deletion outright, making archive the only removal path.

### Guard on `public.wallet_movements`

`BEFORE INSERT` row trigger: select the referenced wallet by
`(id, space_id)` with `archived_at is null` **`FOR SHARE`**; if no row is
returned, raise `every wallet movement must use an active wallet`. This applies
to every current and future writer, including `reverse_financial_event` and the
loan commands, which do not check wallet activity today.

## Protected commands

All four are `SECURITY DEFINER`, `set search_path = pg_catalog, extensions` (or
`pg_catalog` for the read), `REVOKE ALL … FROM public, anon, service_role`,
`GRANT EXECUTE … TO authenticated`. Mutating commands:

1. require `auth.uid()` and `private.is_active_member(p_space_id)`, else
   `42501 an active space membership is required`;
2. reject null identifiers;
3. take a transaction-scoped advisory lock on
   `'wallet:' || space || ':' || request`;
4. replay: if the request exists with the same kind, fingerprint, and wallet,
   return that wallet ID without re-applying anything (state may have changed
   since); otherwise raise `request ID was already used with different data`;
5. lock the wallet `FOR UPDATE` by `(id, space_id)`, else
   `the wallet does not belong to the requested space`;
6. apply the command rule below, update `wallets`, insert the log row, and
   return `table (id uuid)` with the wallet ID.

| Command | Fingerprint payload | Rule and rejection messages |
| --- | --- | --- |
| `rename_wallet(p_space_id, p_request_id, p_wallet_id, p_name)` | version, command, walletId, trimmed name | Active wallet (`the wallet is archived`); trimmed name 1–120 (`the wallet name must be 1 to 120 characters`); differs from current (`the wallet already has this name`). Logs previous and new name. |
| `archive_wallet(p_space_id, p_request_id, p_wallet_id)` | version, command, walletId | Not archived (`the wallet is already archived`); `coalesce(sum(amount_minor), 0) = 0` over its movements (`the wallet balance must be zero to archive`). Sets `archived_at = now()`. |
| `restore_wallet(p_space_id, p_request_id, p_wallet_id)` | version, command, walletId | Archived (`the wallet is not archived`). Sets `archived_at = null`. |

`get_wallet_command_result(p_space_id, p_request_id)` is `stable`, requires
active membership, and returns at most one `(command_kind, wallet_id,
created_at)` row. It lets an ambiguous transport result reconcile without
repeating the command.

These are metadata lifecycle commands: they insert into no financial table, so
`financialWriterFunctionNames()` stays at six. The command inventory documents
them beside the category lifecycle commands.

## Movement and archive serialization

Posting validation reads wallets without a row lock, and the foreign key's
`FOR KEY SHARE` check does not re-read `archived_at`. Without a guard, a posting
validated just before an archive commits could still insert into the archived
wallet. The movement trigger's `FOR SHARE` lock conflicts with the archive
command's `FOR UPDATE`:

- **Archive first:** the posting's trigger waits; once the archive commits,
  READ COMMITTED re-evaluates `archived_at is null` on the new row version, finds
  no row, and the posting fails with no partial state.
- **Posting first:** the archive's `FOR UPDATE` waits for the posting to commit;
  its balance statement then sees the new movement and refuses a non-zero
  balance.

Each lifecycle command locks exactly one wallet, so it cannot form a lock cycle
with multi-wallet transfers. An archived wallet therefore always has balance 0.

## Application and UI

**Gateway (`supabase-wallets-gateway.ts`).** `WalletsGateway` adds
`renameWallet`, `archiveWallet`, `restoreWallet` (RPC only; no direct table
writes) and `getWalletCommandResult`. The snapshot keeps `wallets` (active) and
adds `archivedWallets` (name, currency, `archivedAt`). Each `JournalMovement`
gains `walletArchived: boolean` from the same bounded wallet read.

**Hook (`use-wallets.ts`).** The three commands reuse the existing pending,
browser-generated request ID, ambiguous reconciliation (lookup by request ID,
then explicit same-request retry), and refresh-after-success rules. No
optimistic state.

**Page (`wallets-page.tsx`).**

- Each active wallet row offers **Rename** and **Archive**.
- **Rename dialog:** name field prefilled; Save disabled while unchanged or
  blank.
- **Archive dialog:** explains that the wallet leaves balances and pickers,
  history stays, and it can be restored. With a non-zero balance it shows the
  balance and "Undo or move its transactions until the balance is 0" and offers
  no archive action. Deliberate confirmation as in the undo dialog.
- **Archived wallets:** a collapsed section, `Archived wallets (n)`, below
  active balances, hidden when empty. Each row shows name, currency, archive
  date, and **Restore**. Restore opens a confirmation dialog with a single
  Restore button and no checkbox, because restoring is harmless and reversible.
- **Undo gating:** an event whose movements touch an archived wallet shows
  "Restore <wallet> to undo this" instead of the Undo button.

A small `src/features/wallets/errors.ts` maps command messages to localized
copy; unknown errors fall back to a generic "not saved" message without raw
database text.

**Loans.** A loan correction whose original event moved money through a
since-archived wallet is now refused by the movement guard. The Loans correction
dialog maps `every wallet movement must use an active wallet` to "This entry's
wallet is archived. Restore it in Wallets first." in English and Arabic. No other
Loans behavior changes; its wallet pickers already exclude archived wallets.

## Error and recovery behavior

| Cause | Manager sees |
| --- | --- |
| Non-zero balance | This wallet still has money in it. Undo or move its transactions until the balance is 0. |
| Wallet archived (rename, undo, posting race) | This wallet is archived. Restore it first. |
| Already archived / not archived | This wallet was already changed. Refresh wallets. |
| Unchanged name / invalid name | Inline field message; form values kept. |
| Membership lost | Existing space-unavailable handling. |
| Ambiguous transport | Reconcile by request ID; otherwise "Retry unchanged". |

## Accessibility, localization, and responsive behavior

Every string ships in English and Arabic. Wallet names render inside `<bdi>`.
Dialogs reuse `DialogShell` (focus trap, Escape, focus restoration, full-screen
on mobile). Buttons carry the wallet name in their accessible name (for example
"Rename Daily USD", "إعادة تسمية Daily USD"). The archived section uses a native
`<details>` disclosure and logical CSS properties so it mirrors in RTL.

## Migration, compatibility, and release

- No backfill: every existing wallet has `archived_at is null` and no archive
  command has existed.
- Existing posting, reversal, loan, and category commands keep their signatures.
  The only observable change for them is the new refusal of movements into an
  archived wallet, which cannot exist before this migration.
- Release order: apply the migration to the hosted project **before** deploying
  the UI milestone; otherwise the new buttons call missing functions. Neither
  step runs without an explicit request.
- `pnpm check:uat:scope` already fails on `main` (auth, household, and category
  changes since its fixed release start), so it is not a live freeze for this
  work.

## Verification requirements

Real-Postgres tests (`BUDGET_TEST_DATABASE_URL` harness) must first fail against
the current schema, then prove:

- rename, archive, and restore success for an active member, including a
  non-owner household member;
- exact replay returns the original wallet without a second log row or rewritten
  timestamp; a changed payload under the same request ID is rejected;
- rejection with no partial state for: non-member, `anon`, `service_role`, null
  identifiers, cross-space wallet, unchanged/blank/over-long name, renaming an
  archived wallet, archiving twice, restoring an active wallet, and archiving a
  non-zero balance (positive and negative);
- the movement guard refuses `record_financial_event`,
  `record_categorized_financial_event`, `reverse_financial_event`,
  `record_cash_loan`, and `record_loan_repayment` into an archived wallet, and
  still refuses a raw owner insert when the command-level check is bypassed;
- `wallets` rejects identity/currency changes, timestamp-to-timestamp archive
  rewrites, non-owner updates after a raw grant is added in a rolled-back
  transaction, row deletes, zero-row statement deletes, and truncate;
- the log rejects update, delete (including zero-row), and truncate even after
  raw grants are added in a rolled-back transaction;
- archive versus posting to the same wallet on two real connections, in both
  orders, yields exactly one success and a zero archived balance;
- empty-journal replay and a seeded upgrade preserve wallets, events, movements,
  loans, categories, balances, and existing command compatibility;
- exact signatures, fixed search paths, `EXECUTE` grants, RLS, constraints, and
  triggers in the live catalog; `financialWriterFunctionNames()` unchanged; and
  `wallet_command_requests` added to both non-writable table ratchets.

UI verification: Vitest coverage for rename, archive at zero and non-zero
balance, restore, undo gating, reconciliation and retry, localized errors in
English and Arabic, and the Loans archived-wallet correction message; Playwright desktop flow (undo income → archive → restore)
and an Arabic mobile screenshot of the archived section.

Final gate per milestone: focused suite, full `test:db`, `test:ui`,
`typecheck`, `check:ops`, `build`, affected Playwright specs, and
`git diff --check`. No live Supabase command is part of verification.

## Delivery milestones

1. **Database:** migration, real-Postgres tests, ratchet updates, command
   inventory, decisions entry. Its own branch and plan.
2. **Application/UI:** gateway, hook, dialogs, archived section, undo gating,
   localized errors, UI and Playwright tests, decisions entry. Starts after
   milestone 1 is merged.

## Decisions to record

In `docs/decisions.md`, in the same commit as the change each describes: wallets
archive and restore instead of delete, at zero balance only; any active member
may rename, archive, or restore; wallet state changes in place with an
append-only command log; archived wallets accept no money movement, enforced by
a movement trigger.
