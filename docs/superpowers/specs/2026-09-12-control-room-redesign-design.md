# Control Room redesign — design spec

**Date:** 2026-09-12
**Status:** Approved direction (brainstorming session, direction C chosen by user)

## Context and goal

The current UI (light, sidebar-led, sparse) is being redesigned ground-up, as if
the only thing that existed were the SQL schema. The database layer — protected
posting commands, read models, migrations, RLS — **stays untouched**. This is a
frontend rebuild on top of the existing Supabase backend.

Chosen direction: **C · Control Room** — a dark, data-dense, phone-first
dashboard for people who *manage* money. Analysis leads; recording is one tap
away. Bilingual English/Arabic (RTL) from day one.

Decisions locked in during brainstorming:

- Ground-up: new information architecture **and** new visual language
- Scope: the **full SQL surface**, including capabilities that have no UI today
  (monthly budget planning, USD→LBP exchange, reporting read models, wallet
  archive/restore, payee/note descriptions)
- **Phone-first**; desktop must still work well (responsive, centered column or
  side rail at wide breakpoints)
- **Bilingual EN/AR with true RTL layouts**, not an afterthought

## Architecture

- Keep the existing stack: React + Vite + TypeScript, Supabase JS, the gateway
  modules in `src/features/*/supabase-*-gateway.ts`. Gateways already map
  one-to-one onto the protected commands and are covered by real-Postgres
  tests — they are reused, not rewritten.
- Rebuild the UI layer: `src/features/shell`, `src/features/workspace`, and the
  screen components of each feature are replaced with the new design. Feature
  gateways and their integration tests stay.
- No new financial writers. Every write goes through the commands already
  classified in `docs/financial-command-inventory.md`. If a screen needs a write
  that does not exist, that is a database milestone, not a UI workaround.
- State: server data via the existing gateway calls; local state for the record
  sheet draft, filters, and selected month. No new state library.

## Information architecture

Phone-first bottom tab bar (5 destinations), with the record sheet on a raised
center button. On desktop, the tab bar becomes a left rail with the same five
destinations in the same order.

1. **Home** — the dashboard (default after sign-in)
   - Net position for the current space, with per-currency chips (USD, LBP)
   - Budget vs actual for the selected month
     (`public.monthly_budget_currency_summary`,
     `public.report_category_actual_vs_budget`)
   - Spending trend (`public.report_monthly_cash_summary`)
   - Loans snapshot (`public.loan_monthly_currency_summary`,
     `public.loan_monthly_plan`)
   - Recent journal entries preview (`public.report_wallet_activity`)
   - Month selector (defaults to current month)
2. **Journal** — the immutable ledger
   - Full chronological feed for the current space
   - Filters: wallet, category, event kind, currency
   - Entry detail: payee and note (`describe_financial_event` data), linked
     wallet movements and loan postings, reversal action where eligible
     (`reverse_financial_event` with its existing guards)
3. **+ Record** — the single write surface (modal sheet, not a tab screen)
   - Type-first flow: expense · income · transfer · exchange (USD→LBP) ·
     lend · borrow · repay
   - Then: amount + currency → wallet(s) → category (income/expense only,
     root + optional subcategory) → optional payee/note
   - Maps to `record_financial_event`,
     `record_categorized_financial_event`, `record_usd_to_lbp_exchange`,
     `record_cash_loan`, `record_loan_repayment`, then
     `describe_financial_event` for payee/note after the posting returns
4. **Plan** — monthly budget planning
   - Planned income per currency (`set_monthly_income_plan`)
   - Category targets with subcategory rollup
     (`set_monthly_category_target`, `monthly_budget_category_page`)
   - Left-to-allocate per currency (from `monthly_budget_currency_summary`)
   - Loan monthly commitments (`set_loan_monthly_target`)
   - Plan revisions are immutable appends; the UI always shows latest and
     supports optimistic-revision retry via `p_expected_revision_id`
5. **Manage** — metadata and space administration
   - Wallets: create, rename, archive (refused at non-zero balance), restore
     (`create_wallet`, `rename_wallet`, `archive_wallet`, `restore_wallet`)
   - Categories & subcategories: create, archive
     (`create_category`, `create_subcategory`, `archive_category`)
   - Loans: people list, outstanding principal, history
   - Household: members, invitations, owner commands (existing worker +
     household commands)
   - Space switcher (personal ↔ household), language toggle (EN/العربية),
     account/sign-out

## The record sheet (the core flow)

One bottom sheet, stepped, thumb-friendly:

1. **Type grid** — seven entry types with distinct icons; exchange and loan
   types clearly separated from income/expense (they are not P&L)
2. **Amount pad** — numeric keypad, currency selector constrained to the
   wallet's currency (exchange shows both legs: USD out, LBP in)
3. **Wallet picker** — active wallets only; transfers and exchanges pick
   source and destination
4. **Category picker** (income/expense only) — roots, expandable to
   subcategories; optional
5. **Details** — optional payee (free text, reused per space) and note
6. **Confirm** — summary of the exact posting about to happen, then submit

Submission uses the gateway's request-id/receipt pattern so a transport retry
is safe. Payee/note is attached only after the posting command returns the
event id.

## Visual language

- **Theme:** dark-first. Deep neutral background (`#101418` family), raised
  surface cards, one accent green for positive/active, amber for
  over-budget warnings, red reserved for destructive actions (reversal) and
  negative-overspend states. A light theme is out of scope for this milestone;
  colors are tokens so one can be added later without touching components.
- **Typography:** system stack, tabular numerals for every amount; amounts are
  the visual heroes. Compact density — this is a dashboard, not a brochure.
- **Currency display:** minor-unit-safe formatting per currency (USD 2dp,
  LBP 0dp), with the Arabic-Indic digit and ل.ل rendering already established
  in the app's i18n layer.
- **RTL:** logical CSS properties throughout (`margin-inline-start` etc.),
  mirrored tab bar and navigation in Arabic, Arabic copy for every string.
- **Charts:** small inline bar/sparkline components (no chart library
  dependency; the read models return small bounded series).

## Error handling

- Every command call carries a client-generated request id; on ambiguous
  failure (timeout, 5xx), the UI reconciles via the existing
  `get_*_command_result` read functions before retrying.
- Rejected commands (archived wallet, non-eligible reversal, over-cap loan
  reservation) surface the server message inline in the sheet — no silent
  failures, no generic toasts for financial writes.
- Read-model failures render an empty state with retry, never a crash.
- Reversal entries appear in the journal linked to their original event;
  original events are never hidden or edited (immutability is visible in UI).

## Testing

- Existing real-Postgres command tests (`tests/db`) are untouched — the
  backend contract does not change.
- New component tests for the record sheet flow and tab screens (Testing
  Library), following the existing `src/app.test.tsx` patterns.
- Playwright visual specs are rewritten for the new shell: the five tabs,
  record sheet per entry type, budget over/under states, loan flows, Arabic
  RTL snapshots, mobile and desktop viewports — replacing the current
  `e2e/*.visual.spec.ts` snapshots.
- Private UAT scope checks (`scripts/check-private-uat-scope.sh`) must keep
  passing.

## Non-goals

- No database changes (new event shapes, refunds, installments, etc. remain
  deferred per the command inventory)
- No light theme, no desktop-specific layout system beyond the responsive rail
- No offline sync, import, or external integrations
- No chart library, no new runtime dependencies
