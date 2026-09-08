# Reporting read-model design

## Status and delivery boundary

This document defines the reporting read-model contract for Budget. It is a
design-only deliverable based on repository commit
`59c2cb4f3cb7b6e20e32cc77dcb343db558bedba`.

This design does not implement SQL, migrations, application code, categories,
budgets, charts, exports, or UI. It does not change the protected financial
command inventory or `docs/decisions.md`. A later implementation must use
forward-only migrations, real-Postgres tests, and the existing protected
posting boundary.

The reporting scope is deliberately limited to:

- monthly ordinary income and ordinary expense;
- current-month versus previous-month comparisons;
- separately labelled loan-principal cash flows;
- bounded wallet activity;
- a future category actual-versus-budget projection;
- archived-category history; and
- reconciliation back to immutable wallet movements.

It does not define exchange rates, cross-currency totals, profitability,
net-worth totals, forecasts, accrual accounting, or export formats.

## Existing facts the design preserves

The current database is the source of truth:

- `financial_events` provides the event kind, space, effective local date,
  server-created UTC timestamp, and optional `reversal_of` link.
- `wallet_movements` provides signed exact minor-unit wallet effects.
- `wallet_balances` is the sum of wallet movements; balances are not editable.
- `loan_postings` provides signed outstanding-principal changes and a separate
  signed repayment effect.
- `loan_balances` is the sum of principal postings.
- `loan_monthly_target_revisions` is append-only planning history and creates
  no financial event, wallet movement, or loan posting.
- `loan_monthly_plan` and `loan_monthly_currency_summary` are the existing loan
  planning projections.
- USD is stored in cents. LBP is stored in whole pounds. Database money values
  are `bigint`; application boundaries expose them as integer strings.
- Every exposed space-owned relation is subject to membership-based RLS.
- The browser and background roles have no direct financial-table write path.

Reports must derive actual money only from posted journal rows. No report table
or category/budget table may become an alternative authoritative cash balance.

## Approaches considered

### 1. Direct public views

Security-invoker views would compose naturally with the existing RLS policies
and would be easy to inspect. They cannot, however, force a caller to provide a
date window, cap the number of months, or use keyset pagination. A client could
accidentally request an unbounded ledger or category history.

### 2. Bounded security-invoker RPCs — chosen

Small, read-only SQL functions can validate every bound, expose stable result
columns, and run with the authenticated caller's privileges so base-table RLS
still applies. They can also fail closed when the requested space is not visible.
This matches the current Supabase integration without adding an authorization
bypass.

The implementation should expose three report RPCs:

- `public.report_monthly_cash_summary`
- `public.report_wallet_activity`
- `public.report_category_actual_vs_budget` after category and budget posting
  contracts exist

All three are read-only projections. None belongs in the financial command
inventory because none writes money, principal, or planning history.

### 3. Materialized or cached summaries

Materialized views would reduce repeated aggregation but introduce refresh,
staleness, correction, RLS, and operational-recovery behavior. They are deferred
until production measurements show that indexed live queries do not meet a
defined latency target. Redis, a warehouse, and a second reporting database are
also out of scope.

## Shared reporting semantics

### Calendar and time boundaries

`financial_events.effective_date` is the only field that decides the reporting
period. It is already a local calendar `date`; it must not be converted through
UTC or the browser timezone.

- A month is the half-open date interval `[month_start, next_month_start)`.
- Every supplied month is normalized to its first day.
- `created_at` remains a UTC `timestamptz` used only for audit display and stable
  ordering. It never moves an event between reporting months.
- "Current month" means the explicit `p_anchor_month` supplied by the selected
  application calendar. The database must not infer it from `now()` because no
  authoritative space timezone exists.
- "Previous month" is exactly one calendar month before that normalized anchor,
  including January-to-December year rollover.
- A future-dated posted event is actual activity in its effective future month.
  Its presence is not a forecast.
- A backdated correction restates the month named by the correction's own
  `effective_date`. This design does not provide an "as known at" historical
  snapshot based on `created_at`.

If a later product decision adds an authoritative timezone per space, that
timezone may choose the default anchor in the UI. It must not reinterpret stored
effective dates.

### Currency boundary

Every aggregate key includes one `currency` value. USD and LBP are returned as
separate rows even when one row contains all zeroes. The server and client must
never add, subtract, compare, rank, or chart one currency against the other as
if their minor units were commensurate.

No exchange-rate parameter exists in these contracts. A future cross-currency
feature requires explicit linked exchange postings and its own design.

### Reversal normalization

A reversal is an immutable correction event, not a separate business category.
For every reportable movement, normalize these fields before classification:

| Field | Original event | Reversal event |
| --- | --- | --- |
| semantic event | the event itself | the event referenced by `reversal_of` |
| semantic kind | the event's kind | the referenced original event's kind |
| semantic movement amount | current movement amount | negative of the current movement amount |
| report multiplier | `1` | `-1` |
| reporting date | current event's `effective_date` | reversal event's `effective_date` |

`semantic movement amount * report multiplier` must equal the current immutable
wallet movement amount. The extra semantic fields exist so a reversed expense
still adjusts the expense bucket rather than becoming income, and a reversed
transfer reverses its original source/destination buckets.

The original and reversal remain separately visible in wallet activity. Summary
metrics net them in the periods where their respective effective dates fall:

- same-month reversal: the metric nets to zero;
- later-month reversal: the original remains in its original month and a
  negative correction appears in the reversal month; and
- backdated reversal: the effective month explicitly chosen for the reversal is
  restated.

Report metrics must allow negative net values. Clamping a reversal-only month's
income, expense, loan cash flow, or category actual to zero would break
reconciliation.

### Event-kind classification

The following matrix is exhaustive for the current enum. "Activity" means the
event appears in `report_wallet_activity` when it has a movement matching the
requested wallet/currency filters. Reversals use the referenced original row in
this matrix and the negative multiplier above.

| Semantic event kind | Monthly metric | Category actual | Wallet activity | Loan-planning actual |
| --- | --- | --- | --- | --- |
| `opening_balance` | `opening_net_minor` only | excluded | included | excluded |
| `income` | `income_net_minor` only | future explicit income allocation, otherwise uncategorized income | included | excluded |
| `expense` | `expense_net_minor` only | future explicit expense allocation, otherwise uncategorized expense | included | excluded |
| `transfer` | transfer-in/out audit buckets only | excluded | included | excluded |
| `loan_opening` | excluded because it has no wallet movement | excluded | excluded from wallet activity | excluded |
| `loan_lend` | `loan_lent_net_minor` only | excluded | included | excluded |
| `loan_borrow` | `loan_borrowed_net_minor` only | excluded | included | excluded |
| `loan_receive_repayment` | `loan_repayment_received_net_minor` only | excluded | included | excluded |
| `loan_repay_borrowing` | `loan_repayment_paid_net_minor` only | excluded | included | included by the existing loan planning projection |
| `reversal` | bucket of its original semantic kind with multiplier `-1` | bucket of the original allocation with multiplier `-1` | included and linked | net repayment effect is handled by the existing loan projection |

No event kind has an implicit fallback to ordinary income or ordinary expense.
Adding an enum value must make report classification tests fail until this matrix
and every report function classify or explicitly exclude it.

## Projection 1: monthly cash summary

### Purpose and bound

`public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date)`
returns exactly four rows: previous/current month crossed with USD/LBP. There is
no pagination because the result cardinality is fixed.

The fixed two-month contract serves the requested comparison without creating a
general unbounded time-series endpoint. A later chart endpoint may accept a
period count between 1 and 24; values outside that range must be rejected rather
than silently truncated.

### Result contract

Each row returns:

| Field | Database type | Definition |
| --- | --- | --- |
| `period_month` | `date` | normalized first day of the row's month |
| `period_role` | text | exactly `previous` or `current` |
| `currency` | `currency_code` | exactly USD or LBP |
| `income_net_minor` | `bigint` | multiplier times the positive semantic amounts of `income` movements |
| `expense_net_minor` | `bigint` | multiplier times the absolute semantic amounts of `expense` movements |
| `opening_net_minor` | `bigint` | multiplier times semantic opening amounts |
| `transfer_in_net_minor` | `bigint` | multiplier times positive semantic transfer movements |
| `transfer_out_net_minor` | `bigint` | multiplier times absolute negative semantic transfer movements |
| `loan_lent_net_minor` | `bigint` | multiplier times absolute semantic `loan_lend` movements |
| `loan_borrowed_net_minor` | `bigint` | multiplier times semantic `loan_borrow` movements |
| `loan_repayment_received_net_minor` | `bigint` | multiplier times semantic `loan_receive_repayment` movements |
| `loan_repayment_paid_net_minor` | `bigint` | multiplier times absolute semantic `loan_repay_borrowing` movements |
| `wallet_delta_net_minor` | `bigint` | sum of every wallet movement in the period and currency |

All metric columns are signed net values, despite names such as "expense" or
"paid". For example, reversing a prior expense in the current month can produce
a negative `expense_net_minor`.

Ordinary income is only `income_net_minor`. Ordinary expense is only
`expense_net_minor`. Opening balances, transfers, lending, borrowing, principal
returned, and principal repaid are never included in either field.

The future UI may derive these two convenience values per row without storing
them:

- principal cash in = `loan_borrowed_net_minor +
  loan_repayment_received_net_minor`;
- principal cash out = `loan_lent_net_minor +
  loan_repayment_paid_net_minor`.

It must not label either result as income, expense, profit, loss, wealth, or net
worth.

### Monthly reconciliation identity

For every returned `(space, period_month, currency)` row, this identity must
hold exactly in integer arithmetic:

```text
wallet_delta_net_minor
= opening_net_minor
 + income_net_minor
 - expense_net_minor
 + transfer_in_net_minor
 - transfer_out_net_minor
 - loan_lent_net_minor
 + loan_borrowed_net_minor
 + loan_repayment_received_net_minor
 - loan_repayment_paid_net_minor
```

Across an entire space and currency,
`transfer_in_net_minor = transfer_out_net_minor`. They are retained as separate
audit fields because per-wallet activity does not net to zero and because their
equality is a useful invariant.

The left-hand side must also equal the direct sum of `wallet_movements.amount_minor`
joined to events and wallets in the same date/currency window. A missing or new
event kind therefore breaks a test instead of leaking into an "other" bucket.

## Projection 2: bounded wallet activity

### Purpose and inputs

`public.report_wallet_activity` is the report-facing replacement for loading a
page of events and then issuing separate movement, loan-posting, and reversal
queries in application code.

Inputs:

- required `p_space_id`;
- required inclusive `p_from_date` and exclusive `p_to_date`;
- optional `p_wallet_id` that must belong to the same space;
- optional `p_currency`;
- cursor parts `p_after_effective_date`, `p_after_created_at`, and
  `p_after_event_id`, which must be either all null or all present; and
- `p_event_limit`, default 50, valid from 1 through 100.

The date window must contain at least one day and no more than 366 days. A user
can browse older history by selecting another bounded date window. Invalid
ranges, partial cursors, foreign wallets, and out-of-range limits fail closed.
When both wallet and currency filters are present, the currency must match the
wallet or the request is rejected instead of returning a misleading empty page.

### Pagination and result shape

The RPC first selects at most `p_event_limit + 1` event IDs in descending
keyset order:

```text
(effective_date DESC, created_at DESC, id DESC)
```

For the next page, all three values must compare strictly below the last visible
event tuple. `OFFSET` pagination is prohibited because concurrent appends and
deep pages can create duplicates, gaps, and increasing scan cost.

Only after selecting the event page does the function join movements. The
current posting command caps an event at 20 movements, so the maximum returned
movement-row count is 2,000 for a 100-event page. The look-ahead event is used
only to set `has_more`; its movements are not returned.

Each movement row returns:

- event ID, stored event kind, effective date, created UTC timestamp;
- `reversal_of` and `reversed_by` event IDs;
- semantic event kind and report multiplier;
- wallet ID, current wallet name, wallet currency, and signed amount minor;
- optional loan ID and direction when the event has a loan posting;
- event ordinal within the page; and
- `has_more`, repeated consistently across the page.

The future gateway groups movement rows by event ordinal and exposes the cursor
as an opaque string. It accepts database `bigint` only as an integer string or a
safe integer and exposes all minor amounts as strings. It rejects a row whose
space, wallet currency, event link, or loan link disagrees with the selected
space.

Archived wallets remain resolvable by stable wallet ID and name so their old
activity never disappears. Archival affects new posting eligibility, not report
history.

`loan_opening` has no wallet movement and is intentionally absent. The Loans
workspace remains the source for obligation-only history.

## Projection 3: future category actual versus budget

### Prerequisite contract

The repository does not yet contain categories, category allocations, category
budgets, or archive commands. This report RPC must not be implemented ahead of
those write-side designs.

A future category milestone must first establish:

- stable, space-owned category IDs with RLS;
- one immutable category `flow_kind`, exactly `income` or `expense`; changing a
  used category's flow requires a new category rather than reclassifying history;
- archive-not-delete behavior and an `archived_at` timestamp;
- immutable category allocations linked to a financial event;
- exact positive minor-unit allocations whose sum equals the corresponding
  semantic income or expense amount for that event and currency;
- append-only monthly budget revisions keyed by space, category, flow kind,
  currency, and normalized target month; and
- protected commands, rejection tests, privileges, and reconciliation tests for
  every write path.

Category allocations and budget revisions are metadata and planning state.
They must never create, change, or replace a wallet movement. Category names,
notes, and wallet names must never be parsed to infer an allocation.

### Historic uncategorized rule

Existing income and expense events predate categories. An applicable event with
no allocation is reported under one of two reserved synthetic buckets,
`uncategorized:income` or `uncategorized:expense`, for its currency. It is not
silently omitted. Synthetic buckets cannot receive budgets or new allocations.

Once category allocation commands exist, a newly posted event must be either:

- fully allocated, with allocations exactly reconciling to the event amount; or
- deliberately uncategorized, with no allocation rows.

Partial allocation is an invalid state and must be rejected at the write
boundary. The report must fail a reconciliation assertion rather than filling a
partial residual into `uncategorized`.

### RPC bound and result contract

`public.report_category_actual_vs_budget` accepts:

- `p_space_id`;
- normalized `p_from_month`;
- `p_period_count` from 1 through 12;
- an optional opaque category keyset cursor; and
- `p_category_limit`, default 20 and maximum 25.

The maximum result is 25 category buckets x 12 months x 2 currencies = 600
rows. Pagination is by stable category bucket key, never by `OFFSET`. The two
uncategorized buckets have reserved stable keys and participate in the same
ordering only when they have actual activity in the selected window.

Each row returns:

| Field | Meaning |
| --- | --- |
| `category_key` | stable category UUID key or a reserved uncategorized key |
| `category_name` | current display name or localized uncategorized UI key |
| `archived_at` | category archive timestamp, null for active/uncategorized |
| `flow_kind` | exactly `income` or `expense` |
| `currency` | exactly USD or LBP |
| `period_month` | normalized month start |
| `actual_net_minor` | signed, reversal-netted actual allocated amount |
| `budget_minor` | latest nonnegative budget revision for the exact key |
| `remaining_minor` | `budget_minor - actual_net_minor`, allowed below zero |
| `has_more_categories` | whether another category page exists |

An active category is returned even if all selected actual and budget values are
zero, so the UI can plan it. An archived category is returned only when it has
actual activity or a budget revision in the selected window. This preserves
historical reports without filling current planning screens with irrelevant
archived rows. Archived categories remain unavailable to new allocations.
Reports use the category's current display name; historical label revisioning is
not invented by this scope.

The "latest budget" is the final revision by
`(created_at DESC, id DESC)` for the exact space/category/flow/currency/month.
A zero revision explicitly clears the budget. Budget revisions do not count as
actuals and do not appear in wallet activity.

Actuals use only semantic `income` and `expense` events and their reversals.
Opening balances, transfers, all loan-principal events, loan openings, and loan
monthly targets are excluded. A reversal reuses the original event's allocation
with multiplier `-1` and is assigned to the reversal's effective month.

### Loan repayment planning remains separate

The report UI must not merge category budgets with loan monthly targets.

- Actual ordinary expense comes only from semantic `expense` wallet movements.
- Actual borrowing repayment comes from `loan_repay_borrowing` wallet movements
  and the linked `loan_postings.repayment_effect_minor`.
- Planned borrowing repayment comes only from the existing latest monthly target
  revision as exposed by `loan_monthly_plan` and
  `loan_monthly_currency_summary`.
- Remaining loan reservation is planning availability, not spending, a category
  budget, a wallet debit, or a forecasted cash movement.
- Expected collection from "they owe me" is not income and is not available cash
  until a repayment event is posted.

The future Reports screen should request the existing loan summary separately
for the same explicit anchor month. It may place the blocks near each other but
must preserve their separate labels and types. In particular, the existing loan
planning projection may clamp repayment progress for planning presentation; it
must not be reused as the signed cash-reconciliation metric.

## Authorization and database-object rules

Every report RPC must:

- be `SECURITY INVOKER` so reads remain subject to base-table RLS;
- additionally verify `private.is_active_member(p_space_id)` and fail closed;
- be executable only by `authenticated`, with execution revoked from `PUBLIC`
  and `anon`;
- use a fixed trusted search path and schema-qualified object references;
- constrain every joined space-owned table by `space_id`, not merely by an ID
  that happens to be globally unique;
- perform no writes, acquire no advisory transaction locks, and call no posting
  command;
- return no request fingerprints, personal notes, reusable credentials, or
  fields unrelated to presentation/reconciliation; and
- preserve the existing prohibition on direct financial writes by
  `authenticated` and `service_role`.

Future category/allocation/budget tables must enable RLS before exposure and use
the same indexed membership policy shape as current space-owned tables. Granting
read access to a report function is not permission to broaden write privileges.

If implementation evidence later requires a `SECURITY DEFINER` function, that
is a design change: it must include an explicit caller and membership check,
fixed search path, least-privilege grants, cross-space rejection tests, and a
written reason that an invoker function could not satisfy the query.

## Index strategy

Indexes are candidates to verify with real data distributions, not permission to
add all of them blindly.

Existing useful indexes include:

- `financial_events_space_date_idx` for space/date range scans;
- `financial_events_one_reversal_idx` for reversal lookup;
- `wallet_movements_event_idx` for event-to-movement joins;
- `wallet_movements_wallet_created_idx` for wallet filtering;
- `loan_postings` primary key on event ID and existing loan/space indexes; and
- the current monthly target lookup index.

The likely monthly/activity improvement is a composite event index ordered as
`(space_id, effective_date DESC, created_at DESC, id DESC)`, with equality on
space first and range/order columns after it. Whether it replaces or supplements
the current space/date index must be decided from `EXPLAIN (ANALYZE, BUFFERS)`;
do not retain redundant indexes without a measured reason.

The wallet-filtered activity plan must be measured before adding an index. If
the existing wallet/created and event indexes cannot efficiently select event
IDs for a wallet/date window, evaluate a composite `(wallet_id, event_id)` index.

Future category objects should begin with the access paths their constraints and
queries require:

- allocations: event lookup plus category lookup, both including `space_id`;
- budget revisions: equality on space/category/flow/currency/month followed by
  `(created_at DESC, id DESC)` for latest-revision selection; and
- categories: a space/stable-ID reporting path plus a partial active-category
  index only for new-allocation selectors.

Every foreign-key referencing column needs an index unless an existing composite
index has it as a usable left prefix. Covering `INCLUDE` columns are allowed only
after measurements show heap fetches are material. Partitioning is not justified
for the current dataset or this milestone.

## Future UI data contract

The application layer should add one isolated `ReportsGateway`; it must not
extend the Loans or Wallets mutation allowlists.

The gateway contract should expose three read methods matching the projections:

- load the fixed current/previous monthly cash rows for one visible space;
- load a bounded keyset page of wallet activity; and
- after the prerequisite milestone, load a bounded category actual/budget page.

At the adapter boundary:

- all database `bigint` money values become exact integer strings;
- unsafe numeric values are rejected rather than rounded;
- dates remain `YYYY-MM-DD` calendar dates;
- timestamps remain ISO UTC audit timestamps;
- enum values are allowlisted;
- USD and LBP rows remain separate arrays/records;
- a space mismatch, unknown event kind, unknown currency, incomplete cursor, or
  response over its documented cap is a hard data error; and
- changing the selected space clears old report state before a new request and
  ignores stale responses, matching the existing shell isolation behavior.

The eventual UI may calculate percentage changes only when the denominator and
sign semantics are explicitly designed. This contract supplies exact absolute
minor-unit values. It does not define percentages, chart scales, colors, or
empty-state copy.

## Real-Postgres validation requirements

Implementation is not accepted with mocked queries or TypeScript-only fixtures.
Tests must run on the repository's real PostgreSQL/Supabase engine and prove the
following.

### Classification and date tests

1. Each current event kind lands in exactly the matrix bucket above.
2. Opening balances and transfers affect wallet reconciliation but never income,
   expense, category actuals, or loan planning.
3. Lending, borrowing, repayment received, and repayment paid remain distinct
   from ordinary income/expense and reconcile through their separate fields.
4. `loan_opening` changes principal without appearing in cash activity.
5. Same-month reversal nets the original metric to zero while preserving two
   activity events.
6. Later-month reversal creates a signed negative adjustment in the later month.
7. Backdated reversal follows its effective date, not its creation timestamp.
8. Current/previous selection handles year rollover, leap February, and months
   of different lengths.
9. Future-dated posted activity appears as future actual, while a target/budget
   with no posting leaves actual at zero.

### Reconciliation tests

10. For each space/month/currency, the monthly identity in this document equals
    a direct sum of wallet movements.
11. Transfer-in equals transfer-out at the space/currency level, including
    reversals.
12. The sum of category income actuals equals ordinary income and the sum of
    category expense actuals equals ordinary expense for the same window, after
    category prerequisites exist.
13. Fully categorized, deliberately uncategorized, and reversed events all
    reconcile; partial allocation is rejected rather than patched by reports.
14. Report queries do not change wallet balances, loan balances, event counts,
    posting counts, or planning revision counts.

### Security and boundary tests

15. A member can read only a visible space; another member's space, a removed
    membership, an anonymous caller, and a foreign wallet cursor are denied.
16. Cross-space joins cannot leak wallet names, category names, loan IDs, event
    IDs, counts, or zero/nonzero existence signals.
17. `PUBLIC` and `anon` cannot execute report RPCs.
18. Report objects own no table and confer no financial or planning write
    privilege.
19. Adding an unclassified financial event enum value makes the report coverage
    ratchet fail.

### Bounds and performance tests

20. Monthly summary always returns exactly four rows, including zero USD/LBP
    rows.
21. Invalid date spans, period counts, page limits, and partial cursors fail.
22. Wallet activity returns no more than 100 events and 2,000 movement rows.
23. Keyset paging with identical effective dates and created timestamps produces
    no duplicate or missing events.
24. Category reporting returns no more than 25 category buckets, 12 months, and
    1,200 rows per call.
25. Archived categories with in-window history remain visible; archived
    categories without in-window actual/budget are absent; active categories
    remain available with zero values.

After realistic bulk fixtures, run `VACUUM ANALYZE` before trusting query plans.
Use `EXPLAIN (ANALYZE, BUFFERS)` for selective and high-match probes under an
authenticated RLS context. Assert realistic behavior: a selective activity page
should use the intended bounded index path, while a sequential scan may be
correct for a high-match summary. Never disable sequential scans to force a
desired plan.

Migration verification must apply the forward-only journal to both an empty
database and a seeded copy. No database, hosted project, deployment, or
production mutation is authorized by this design.

## Acceptance boundary

This reporting design is ready for an implementation plan only when the reviewer
agrees that:

- ordinary income/expense, opening adjustments, transfers, and every current
  loan-principal cash kind are classified exactly once;
- reversals net by original semantic kind while using the reversal's effective
  date;
- USD and LBP never aggregate together;
- loan targets and category budgets remain planning, not actual money;
- current/previous and pagination bounds are explicit;
- category reporting remains blocked on its write-side prerequisite design; and
- every reported cash value can be reconstructed from immutable wallet
  movements without an exchange rate or mutable report total.

Implementation, charts, exports, and UI remain separate later deliverables.
