# Monthly Budgeting Design

## Status and scope

This document specifies the next monthly-budgeting product and database
boundary. It is a design only: it does not authorize or implement migrations,
SQL, gateways, UI, deployment, or changes to `docs/decisions.md`.

The design builds on the verified foundation at commit `59c2cb4`: immutable
`financial_events`, signed `wallet_movements`, derived wallet balances, linked
loan-principal postings, append-only loan target revisions, protected commands,
RLS space membership, and separate USD/LBP projections. Those boundaries remain
authoritative.

This milestone covers manual monthly income plans, expense-category targets,
per-category actual-versus-plan results, unallocated income, overspending, and
integration with existing monthly loan targets. It explicitly defers forecasting,
bank sync, recurring automation, exchange or conversion, savings goals, and a
Reports workspace or report UI. It also does not add household membership,
wallet archival, loan terms, interest, fees, or scheduled payments.

## Product language

The feature uses four distinct concepts:

- **Planned income** is the amount the manager expects to allocate in one
  currency for one calendar month. It is intent, not money received.
- **Category target** is the portion of planned income assigned to an expense
  category and currency for that month. It is an allocation, not an expense.
- **Actual income and spending** are derived only from immutable journal effects.
- **Loan commitment** is the existing loan target already paid this month plus
  its remaining reservation. It is neither ordinary spending nor a second cash
  movement.

The UI must use “planned,” “allocated,” “received,” “spent,” “paid,” and
“reserved” consistently. It must never label a plan as cash, a loan principal
movement as income or ordinary spending, or an expected collection as spendable
money.

## Approaches considered

### 1. Typed append-only plan revisions — recommended

Store income plans and category targets in one narrow revision table with an
explicit `plan_kind`, strong checks, and protected setters. Current values are
the latest revisions for their logical keys. Actuals continue to come from the
journal, while read projections combine the two domains.

This gives one idempotency namespace, one deterministic history cursor, and one
immutable guard without changing any verified financial table or loan command.
The table remains typed: an income revision cannot carry a category, and a
category-target revision must carry one.

### 2. Separate income-plan and category-target revision tables

Separate tables make each row shape slightly simpler and allow independent
evolution. They also duplicate request replay logic, history pagination,
immutability triggers, RLS policies, and current-revision queries. A request UUID
could be accepted once in each table unless a third command-receipt table were
introduced. That added surface does not buy enough for two small plan shapes.

### 3. Whole-month snapshots

Each edit could append a complete month document or a parent revision with all
income and category lines. Reads and “restore this version” would be direct, but
every small edit would rewrite the entire logical plan, create larger bounded
payload and conflict problems, and make concurrent household edits collide even
when they touch unrelated categories. JSON snapshots would also weaken database
constraints and foreign keys.

Using `financial_events` for plans is rejected under every approach. A target or
draft must never create a financial event, wallet movement, loan posting, or
authoritative balance change.

## Required Categories contract

Monthly Budgeting depends on a Categories database milestone that does not yet
exist. The Budgeting implementation must not invent browser-only category IDs or
ship category targets before this contract exists.

That prerequisite must provide:

- a stable, space-owned expense-category identity, proposed as
  `public.expense_categories`, with `(id, space_id)` uniqueness, a bounded name,
  `created_at`, optional `archived_at`, RLS, and no physical deletion;
- protected category creation and archival commands; the Budgeting gateway does
  not write the category table directly;
- immutable category attribution for actual expense events, including the
  currency and minor-unit amount attributed to each category;
- an explicit uncategorized remainder when an expense is not fully attributed;
- linked inverse attribution when a categorized expense is reversed; and
- indexes supporting space, category, event, currency, and effective-month
  lookups.

The proposed journal-side relation is `public.expense_category_postings`. It is
owned by the Categories/journal milestone, not by a planning command. Each row
links an immutable financial event to a category, currency, and signed
`amount_minor`. Original expense classifications are positive; a reversal adds
equal negative postings for the original categories. Per event and currency,
positive category postings may not exceed the magnitude of that event's expense
wallet movements. Any difference is uncategorized. UPDATE, DELETE, and TRUNCATE
are rejected.

Whether the first Categories UI supports one category or bounded splits is a
Categories decision. Monthly Budgeting consumes the normalized postings and is
correct in either case. No category design may edit the financial event or its
wallet movements to change classification.

## Proposed planning table

Add one budget-owned table, `public.monthly_budget_plan_revisions`:

| Column | Type and rule |
| --- | --- |
| `id` | `bigint generated always as identity primary key`; the deterministic revision order and history cursor. |
| `space_id` | `uuid not null`, FK to `spaces(id) on delete restrict`. |
| `request_id` | `uuid not null`; unique with `space_id` across both budget command kinds. |
| `request_fingerprint` | `bytea not null`; hashes the canonical command name and normalized payload. |
| `plan_kind` | enum or checked text: `income` or `expense_category`. |
| `month_start` | `date not null`; constrained to the first day of its month. |
| `currency` | existing `public.currency_code not null`. |
| `category_id` | nullable UUID with a composite FK `(category_id, space_id)` to the Categories contract. |
| `amount_minor` | `bigint not null check (amount_minor between 0 and 999999999999999)`. |
| `expected_revision_id` | nullable bigint recording the optimistic-concurrency precondition supplied by the caller. |
| `actor_id` | authenticated user UUID, server-derived, FK to `auth.users`. |
| `created_at` | `timestamptz not null default now()`; UTC audit time, not revision order or month attribution. |

The row-shape constraint is exact:

- `income` requires `category_id is null`;
- `expense_category` requires `category_id is not null`.

The logical current-value keys are:

- income: `(space_id, month_start, currency, plan_kind)`;
- category target: `(space_id, month_start, currency, plan_kind, category_id)`.

The highest `id` for a key is current. `created_at` must not decide which
concurrent revision wins because `now()` is transaction-stable and transaction
start order is not commit order.

Required indexes are:

- unique `(space_id, request_id)` for replay lookup;
- `(space_id, month_start, currency, plan_kind, category_id, id desc)` for latest
  values and monthly summaries;
- `(space_id, id desc)` for keyset history; and
- an index beginning with `category_id` if the chosen composite index does not
  support the category FK/archive lookup measured by the final query plans.

RLS is enabled and filters through the existing indexed active-membership
lookup. `anon`, `authenticated`, and `service_role` receive no INSERT, UPDATE,
DELETE, or TRUNCATE privileges. Authenticated raw SELECT is unnecessary if all
reads use the bounded projection commands below. A statement-level immutable
guard rejects UPDATE, DELETE, and TRUNCATE even if a privilege is granted by
mistake.

## Protected planning commands

### `public.set_monthly_income_plan`

Inputs:

`p_space_id uuid`, `p_request_id uuid`, `p_month date`,
`p_currency currency_code`, `p_amount_minor text`, and
`p_expected_revision_id bigint default null`.

The command sets the manual planned-income amount for one currency/month by
appending an `income` revision.

### `public.set_monthly_category_target`

Inputs:

`p_space_id uuid`, `p_request_id uuid`, `p_category_id uuid`, `p_month date`,
`p_currency currency_code`, `p_amount_minor text`, and
`p_expected_revision_id bigint default null`.

The command sets the allocation for one expense category/currency/month by
appending an `expense_category` revision.

### Shared command behavior

Both functions are `SECURITY DEFINER` with a fixed trusted search path, revoke
execution from `PUBLIC`, grant only the intended capability role, derive the
actor from `auth.uid()`, and check active membership themselves. They do not
rely on RLS to authorize a write.

Each command:

1. Requires an authenticated active member of `p_space_id`.
2. Parses `p_amount_minor` only from the canonical string regex
   `^(0|[1-9][0-9]{0,14})$`; whitespace, signs, decimals, exponent notation,
   leading zeroes, numbers, and values outside the bound are rejected.
3. Normalizes `p_month` to its first calendar day before fingerprinting and
   storage.
4. Acquires transaction advisory locks in one documented order: request key,
   then logical plan key. Transactions contain no network or other external work.
5. Checks an existing `(space_id, request_id)` before mutable category or
   concurrency validation. An identical accepted replay returns its original
   revision even if the category was archived later; different canonical data
   is a request-conflict error.
6. Locks and reads the current logical revision. `p_expected_revision_id` must
   match it; null means the caller observed no current revision. A stale
   precondition rejects rather than silently overwriting another household
   member's edit.
7. For a category target, verifies that the category belongs to the requested
   space. A positive target is rejected for an archived category; zero remains
   allowed so an existing current or future target can be explicitly cleared.
8. Appends exactly one revision and returns its ID and normalized month.

A different request that submits the same value still appends a revision. This
keeps every accepted user action attributable and gives its request a durable
idempotency receipt. The UI should suppress no-op submissions to reduce noise,
but correctness does not depend on it.

These commands are planning commands, not financial posting commands. They must
be documented beside `set_loan_monthly_target` as non-posting entry paths and
must be proved incapable of writing journal or loan-principal tables.

## Editing, clearing, carry-forward, and archive rules

- A plan is never updated in place. Editing means appending a revision.
- The exact string `"0"` is the clear operation for planned income and category
  targets. A zero revision remains visible in history and makes the current
  value zero; no row is deleted.
- Past, current, and manually selected future months may be revised. A future
  manual plan is not a forecast because the system makes no prediction or
  automatic propagation.
- No value carries forward automatically. A month with no revision starts at
  zero even when the prior month had unused allocation, overspending, or a loan
  shortfall. An explicit bounded “copy prior month” command is not part of the
  first milestone.
- Archiving a category never rewrites plan or actual history. Historical months
  continue to show its sourced name and archived state. Current/future positive
  targets already recorded remain counted until a member appends zero; the
  archived row stays visible whenever it has a nonzero target or actual. New
  positive revisions for it are rejected. Reversals may continue to create
  inverse actual attribution for it.
- Category names are sourced through the stable category ID. Renaming behavior,
  if later supported, must preserve an attributable category-name history or a
  documented “current label on old facts” rule before it is implemented.

## Month and clock semantics

`month_start` and `financial_events.effective_date` are calendar `date` values,
not UTC instants. An actual belongs to the selected month when its effective
date is in `[month_start, next_month_start)`. No timezone conversion is applied
inside this predicate.

`created_at` remains a server-generated UTC `timestamptz` used for audit display.
It never moves an event or plan between budget months and does not determine the
latest plan revision. A late-entered August expense with a September UTC
creation time belongs to August; a reversal effective in September adjusts
September.

The browser passes canonical `YYYY-MM-01` month strings and treats them as plain
calendar values. It must not round-trip them through JavaScript UTC `Date`
parsing that can shift the visible day. The initial “current month” selection may
use the device's local calendar, but it is only a presentation default and the
manager can select another month. Space timezone configuration and scheduled
month rollover are deferred with automation/forecasting.

## Actual-value derivation and reversal rules

Actuals are reconstructed from immutable event effects. The projections must
resolve a reversal through `financial_events.reversal_of` to the original
economic kind, while using the reversal's own signed movements and effective
date.

For each space, selected month, and currency:

- `income` movements contribute their signed amount to actual income;
- a reversal of income contributes the inverse amount in the reversal's
  effective month;
- expense movements contribute their magnitude to actual spending, while an
  expense reversal contributes a negative amount in the reversal month;
- opening balances and their reversals are excluded from income and spending;
- transfers and their reversals are excluded from income and spending;
- all loan opening, lend, borrow, repayment, and linked reversal principal
  effects are excluded from ordinary income and spending; and
- expected loan collections never contribute to planned or actual income until
  a separate product decision says otherwise. Posted principal received remains
  labeled loan repayment, not income.

The category actual projection uses the immutable category postings. Reversing a
categorized expense must create equal inverse postings for the original
categories in the reversal transaction. It must not merely hide the original
row or subtract every event that has ever been reversed, because that would
rewrite a closed month's history and mishandle cross-month corrections.

An expense with no category posting contributes to `uncategorized_spent_minor`.
If category postings cover only part of a bounded split, only the remainder is
uncategorized. The projection fails loudly if postings exceed the event's
currency-specific expense magnitude.

## Budget arithmetic

All database arithmetic uses `bigint`; API and browser boundaries use canonical
integer minor-unit strings. USD cents and LBP whole pounds are never converted
or added together.

For one category/currency/month:

```text
remaining_minor = max(target_minor - net_actual_spent_minor, 0)
overspent_minor = max(net_actual_spent_minor - target_minor, 0)
```

`net_actual_spent_minor` may be negative when this month contains a reversal of
an earlier-month expense. In that case remaining may exceed the target; the UI
labels the negative actual as a credit/reversal rather than silently clamping it
away.

For one currency/month:

```text
loan_commitment_minor = actual_loan_repayment_minor
                      + remaining_loan_reservation_minor

raw_unallocated_minor = planned_income_minor
                      - category_target_total_minor
                      - loan_commitment_minor

unallocated_minor  = max(raw_unallocated_minor, 0)
overallocated_minor = max(-raw_unallocated_minor, 0)
```

`actual_loan_repayment_minor` and `remaining_loan_reservation_minor` come from
the existing loan monthly projection. Their sum counts the month’s executed and
still-reserved portions once. For example, a 6,000 target with 2,000 paid and
4,000 remaining contributes 6,000—not 8,000. An extra payment above target
contributes the actual amount because it has already consumed cash. A future
target that now exceeds repayable principal contributes only the existing
projection's capped remaining reservation.

Unallocated is a planning value. Actual income does not automatically expand it,
and category spending within a target does not return allocation to it. Category
overspending and uncategorized spending are reported separately instead of
silently reallocating another category. The database permits over-allocation and
overspending so it can describe reality; projections surface them as explicit
nonnegative warnings.

Loan principal never appears in category actual spending. Loan repayments are
shown only as actual paid plus remaining reservation. Likewise, expected money
owed to the space does not increase unallocated income.

## Read projections and bounds

Use ordinary indexed Postgres aggregation first. Do not add a materialized view,
cache, queue, or precomputed mutable balance without measured evidence.

### `public.monthly_budget_currency_summary`

Takes `p_space_id` and `p_month`. It validates membership and returns at most one
row per supported currency, never a grand-total row. A row is returned when that
currency has a wallet, plan revision, category target/actual, journal actual, or
loan amount for the month.

Fields include:

- currency;
- planned and actual income;
- category target total and net actual category spending;
- uncategorized net spending;
- category overspent total;
- actual loan repayment, remaining loan reservation, and loan commitment;
- unallocated and overallocated; and
- current revision ID for the income plan.

Owed principal, expected collections, wallet balances, and cash-flow totals may
be displayed in their owning Loans/Wallets surfaces but are not folded into the
budget arithmetic.

### `public.monthly_budget_category_page`

Takes `p_space_id`, `p_month`, a keyset cursor, and `p_limit`. The hard maximum is
100 and the normal UI page is 50. Ordering and cursor use
`(category.created_at, category.id, currency)` so pagination is deterministic.
OFFSET is not used.

It cross-joins every active category with the two supported currencies so a
zero-value row is available as the starting point for either target. Archived
categories return only currency rows that have a nonzero target or actual in the
selected month. Each category/currency row includes sourced name, archive state,
target, net actual, remaining, overspent, and current target revision ID. The
uncategorized amount is a separate summary row, not a fake category ID and not
targetable.

### `public.monthly_budget_revision_history`

Takes `p_space_id`, optional normalized `p_month`, `p_before_revision_id`, and
`p_limit`. It returns at most 50 revisions ordered by `id desc`, with actor,
kind, category reference, currency, amount, and UTC creation time. It uses
keyset pagination and never returns fingerprints.

All functions fail closed for non-members, cap client-provided limits inside the
database, select only required columns, and use indexes with equality columns
before range/order columns. Query-plan tests must use realistic selective data
and `VACUUM ANALYZE` before treating `EXPLAIN` as evidence.

## RLS, privileges, and invariants

The implementation must preserve these invariants at the database boundary:

1. A revision, category, actual classification, event, movement, loan, and loan
   target all belong to the same space when joined.
2. The only source of actual money is immutable financial events and wallet
   movements. Planning functions have no insert path to those relations.
3. Category actuals reconcile to expense movements per event and currency and
   never classify openings, transfers, income, or loan principal as expense.
4. USD and LBP stay separate in storage, calculations, API rows, and UI.
5. A zero plan value is a current clear revision, not absence of history.
6. Latest-value selection is deterministic by identity revision ID.
7. Every mutation is attributable to the authenticated actor and accepted at
   most once for its space/request/payload.
8. Application and background roles cannot write planning or actual-history
   tables directly.
9. RLS defaults to no visibility when active membership is absent. Membership,
   space, logical-key, category FK, and month-range columns are indexed.
10. No loop, payload, response, or history read is unbounded.

## Failure and recovery states

Database commands return stable, user-safe classifications for:

- missing authentication or space membership;
- malformed/out-of-bound amount or month;
- request ID reused with different canonical data;
- stale `expected_revision_id` after a concurrent household edit;
- missing, cross-space, or archived category;
- invalid read limit/cursor;
- category attribution that does not reconcile to an expense event; and
- unexpected database failure.

The later UI must preserve safe entered values after a deterministic rejection.
For a concurrent edit it refreshes the current projection, explains that another
change is newer, and asks the manager to review before submitting a new request.

For an ambiguous transport result, the UI performs one bounded reconciliation
read by selected space and the original request ID. A visible revision completes
the save. If none is visible, it offers an explicit retry with the identical
request ID, payload, and expected revision. Editing any field invalidates that
retry and creates a new request ID. There is no automatic mutation retry.

Changing user, space, or month synchronously clears the old budget projection
and pending command. Late responses are sequence-checked and cannot repopulate a
new context. The UI has explicit loading, no-categories, zero-plan, empty-actual,
read-error/retry, save-error, ambiguous-save/reconcile, concurrent-edit,
category-archived, overallocated, overspent, and uncategorized states in English
and Arabic. Database-sourced category names use `<bdi>` and layouts use logical
properties for RTL. These are acceptance requirements for a later UI plan, not
UI implementation in this design.

## Real-Postgres acceptance tests

Tests run against the real Budget PostgreSQL version and start red before the
corresponding migration or command is written. They must prove:

1. Income and category commands accept canonical zero/nonzero string amounts,
   normalize the month, append revisions, and change no wallet or loan balance.
2. Decimal, signed, whitespace-padded, leading-zero, numeric-JSON, over-bound,
   null, malformed-month, and cross-space-category inputs fail atomically.
3. Identical request replays return one revision; changed-payload and
   cross-command reuse reject; concurrent identical replays have one effect.
4. Concurrent edits with the same expected revision allow one winner and reject
   the stale writer; latest selection and history order are deterministic.
5. Zero appends a clear revision and preserves all prior values and actors.
6. No month inherits a prior value automatically, including after underspend,
   overspend, or a missed loan target.
7. Archival preserves old plan/actual rows, rejects new positive targets, allows
   explicit zero clearing, and keeps archived nonzero rows visible.
8. Members can read their space; another memberless user and anonymous role see
   nothing and cannot call commands. A cross-space category is rejected even if
   table privileges are deliberately granted in the test.
9. UPDATE, DELETE, and TRUNCATE fail through immutable guards after temporary
   test grants. Catalog tests prove authenticated and service roles have no
   direct planning/history writes.
10. Opening balances, transfers, and their reversals do not change income or
    spending. Income/expense reversals adjust the reversal's effective month
    with the original economic classification.
11. Loan openings, lending, borrowing, repayments, and reversals never enter
    ordinary category spending or income.
12. A 6,000 loan target with 2,000 actually repaid yields a 4,000 remaining
    reservation and a 6,000 loan commitment. Extra repayment and outstanding-
    principal capping cases also count once.
13. Planned income minus category targets minus loan commitment yields separate
    unallocated or overallocated values; actual overspending yields category
    overspent without mutating another target.
14. Uncategorized and partially categorized expense amounts reconcile exactly
    per event/currency. Over-attribution fails loudly. A categorized reversal
    creates matching inverse category postings atomically.
15. USD and LBP return separate rows under mixed-currency plans, actuals,
    reversals, and loans; no aggregate cross-currency total exists.
16. History and category reads enforce hard limits, stable keyset cursors, no
    duplicates across pages, and correct empty/end pages. Selective query plans
    use the intended indexes after `VACUUM ANALYZE`.
17. The financial-writer catalog inventory remains exactly classified, and the
    new planning commands are proven not to write `financial_events`,
    `wallet_movements`, `loans`, or `loan_postings`.

Migration verification must apply the forward-only journal to both an empty
Budget database and a seeded copy containing existing wallet, reversal, loan,
and loan-target history. No production or Sandooq database operation is part of
this work.

## Delivery sequence and explicit deferrals

1. Design and implement the Categories contract, protected category lifecycle,
   immutable actual attribution, reversals, and rejection tests.
2. Add the monthly plan revision table, guards, indexes, and protected setters.
3. Add bounded monthly summary/category/history projections and real-Postgres
   arithmetic, RLS, concurrency, reversal, and query-plan tests.
4. Only then design the typed gateway and bilingual UI recovery flows. Update
   the financial/planning command inventory and decisions ledger in that later
   implementation change, not in this design-only commit.

Forecasting, bank synchronization, recurring or scheduled automation, currency
conversion, exchange rates, savings goals, automatic carry-forward, bulk month
copying, report generation, and the Reports UI remain separate future designs.
They must not be approximated through this schema or implied by the first
Budgeting UI.
