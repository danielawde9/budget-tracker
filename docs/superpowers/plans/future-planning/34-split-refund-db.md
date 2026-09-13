# 34 — Expense allocation facts and linked refunds

**Layer:** DB. **Depends on:** 27; 34a before 29; 34b/34c after 34a. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Execute one substep at a time

34a semantic allocations;34b split command;34c refunds. Separate tests/migrations/
commits. This breaks the dependency cycle:34a does not depend on mixed purchases.

### 34a Unified semantic expense allocation

Create `_expense_allocations.sql`, `tests/db/expense-allocation.integration.test.ts`.
`expense_allocation_sets(event_id uuid PK,space_id uuid,currency currency_code,
line_count int1…20,total_minor bigint positive 15 digits,actor_id,created_at)`.
`expense_allocation_lines(event_id uuid,space_id uuid,ordinal int1…20,
category_id uuid nullable,amount_minor bigint positive 15 digits,
PK(event_id,ordinal))`, FKset(event,space), category same-space expense-kind.
Exact child count, sum=total, no late child insertion and no legacy category
association concurrently with a new allocation set. Explicit uncategorized line
uses NULL category, never an invented category seed. Category archival blocks new
selections but retains historical display. An event that was already posted with
a legacy category cannot be silently transformed by INSERT; only specialised
new posting commands may create allocation sets atomically.

`private.planning_expense_facts(space,from,to)` returns one row per semantic
allocation with originalEventId,eventId,effectiveDate,currency,categoryId,rootId,
signedExpenseMinor. Union legacy ordinary expense once, new allocation facts once,
and inverse facts with negative original amounts on inverse date. Mixed purchase
support enabled when29adds kind. No double-source branch. Forward-update task 02,
06,10purchaseeligibility,14settlement,17available to consume the helper. Existing
category correction path must reject reallocating specialised events until a
separate immutable allocation-revision command is specified; UI uses Undo/new
for these. Do not quietly allow legacy categorization to override split facts.

### 34b Split expense

`record_split_expense(p_space_id uuid,p_request_id uuid,p_wallet_id uuid,
p_amount_minor text,p_effective_date date,p_lines jsonb)` →TABLE(id uuid).
Lines exact categoryId nullable,amountMinor text,ordinal;2…20, contiguous ordinal,
positive values sum to amount. One cash movement−amount; one allocation set.
Same category may occur twice? Selected default reject duplicate nonnull category
and merge in draft; allow at most one NULL line. Reuse expense kind with explicit
shape validator distinguishing legacy/new set. Ordinary total is cash amount;
root rollup includes children once. Undo negates all facts, not a fresh mutable set.

### 34c Cash refunds (not Undo)

New kind expense_refund, table `expense_refund_details(event_id uuid PK,space_id,
original_event_id uuid,currency,refund_minor bigint>0,line_count1…20)` plus
`expense_refund_lines(event_id,space_id,original_ordinal,amount_minor>0)` with
PK(event_id,original_ordinal), exact sums/counts. Original legacy expense has ordinal1;
new set uses fixed original ordinals. Link via same-space event FK and validator.
`record_expense_refund(p_space_id uuid,p_request_id uuid,p_original_event_id uuid,
p_wallet_id uuid,p_amount_minor text,p_effective_date date,p_lines jsonb)` →TABLE(id uuid).
Same currency as original semantic expense and receiving wallet; amount per original
line≤original amount−net prior refunds. Lines originalOrdinal,amountMinor.

Lock original expense FOR UPDATE before refund sum check, then wallets in canonical
order. Receipt replay first. Deferred cap validation must also run when reversing
a refund or original event. Reject Undo of original while any net refund exists;
reverse the linked refunds first. Otherwise original Undo would restore all cash
while leaving returned cash and negative net expense. Refund reversal restores
refundable capacity; no recursion beyond one original→refund→inverse relationship.
Refund is current cash income but **not ordinary income**; net original-category
expense decreases on refund date. For purchase-goal links restore fulfilled/earmark
in proportion to explicitly refunded original allocation eligible for that goal;
when ambiguous across multiple goal links, require `p_goal_refunds jsonb` lines
(goalPurchaseLinkId,amountMinor), exact≤refunded amount and per-link capacity.
Therefore final refund RPC includes this required last arg (empty[] when no links).
Update35 mapping to include it. No automatic proportional rounding or goal guessed
from merchant. If restored funds exceed coverage, needsReview rather than hiding.

Fixtures expense10000 split6000/4000 → refund2000 first line yields4000/4000 net;
income0,cash+2000. Further refund5000 first line rejects. Undo refund restores6000/
4000; original undo with live refund rejects. Goal purchase10000,refund2000 restores
2000earmark and reducesfulfilled2000 without new contribution. Cross-month refunds,
concurrent refunds cap, reverse-vs-refund, category archive, malformed count and
common security tests. Store credit and household reimbursement are separate
future economic events, not fake cash refunds.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.

## 34c required goal-refund relation and projection extension

Create `goal_purchase_refund_links` with `refund_event_id uuid NOT NULL`,
`goal_purchase_link_id uuid NOT NULL`, `space_id uuid NOT NULL`,
`amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999999999)`,
`actor_id uuid NOT NULL REFERENCES auth.users(id)`, `created_at timestamptz NOT NULL
DEFAULT now()`, PK(refund_event_id,goal_purchase_link_id), same-space FK to refund
and original goal purchase link. Add composite UNIQUE(id,space_id) to the original
link table forward if needed. Add declared `goal_refund_line_count int0…20` to
expense_refund_details; deferred exact count and per-link cumulative net cap.
Require original purchase link's expense event matches refund's original event.
Common immutable/insert guards, RLS and revokes apply. This relation has no wallet
movement of its own.

Extend task 10 financing state: a refund link effective on refund event date adds
amount to earmarked and subtracts it from fulfilled; reversal of the refund does
the opposite on its own date. Monthly net contribution remains unchanged. Extend
funding-head hash with latest refund link identity and relevant refund reversals.
Verify timeline nonnegativity and current goal state after both directions. These
updates and existing goal/recurring/available-cash regressions are required in34c,
not deferred to a future gateway fix.
