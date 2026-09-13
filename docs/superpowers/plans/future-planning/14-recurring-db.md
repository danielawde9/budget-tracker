# 14 — Recurring schedules and settlement DB

**Layer:** DB only. **Depends on:** 03,10. **Own:** new timestamped
`_recurring_schedules.sql`, `tests/db/recurring-schedules.integration.test.ts`,
`tests/db/recurring-settlement.integration.test.ts`, command inventory,
decisions and evidence14. Read 01 SQL contract and test recipes first.

## 1. Schema and immutable identities

Implement the following relational shape. `audit` below means the explicit
columns `request_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
created_at timestamptz NOT NULL DEFAULT now()`; expand them in the migration.
All identities have space FKs and composite UNIQUE(id,space_id). Every revision
has a same-stream predecessor FK and the initial/successor indexes from task 04.
All history tables have the common guards, RLS, revokes and FK indexes.

| Table | Exact columns and constraints beyond audit |
| --- | --- |
| `schedules` | id uuid PK; space_id uuid FK; currency currency_code; kind text CHECK income/expense/debt_payment; UNIQUE(id,space_id,currency). Immutable kind/currency. |
| `schedule_revisions` | id bigint identity PK; schedule_id uuid; space_id uuid; currency currency_code; expected_revision_id bigint nullable; state active/paused/ended; name_en/name_ar nullable1…80 at least one; expected_minor bigint1…999999999999999; starts_on date; ends_on nullable date≥starts; cadence weekly/monthly/yearly; interval_count int1…12; category_id uuid nullable; loan_id uuid nullable; funding_goal_id uuid nullable; preferred_wallet_id uuid nullable; CHECK kind-specific references via deferred validator. Composite FK schedule+space+currency. |
| `scheduled_occurrences` | id uuid PK; schedule_id uuid; source_revision_id bigint; space_id uuid; currency; due_date date; expected_minor positive 15 digits; category_id/loan_id/funding_goal_id/preferred_wallet_id copied nullable UUIDs; UNIQUE(schedule_id,due_date); composite FK(source_revision_id,schedule_id,space_id,currency) to revisions. |
| `occurrence_events` | id bigint identity PK; occurrence_id uuid; space_id uuid; expected_event_id bigint nullable; action text CHECK skip/reopen/link/confirm; linked_event_id uuid nullable; link_amount_minor bigint nullable; CHECK (action in link/confirm) iff both link fields nonnull and amount>0; composite event+space and occurrence+space FKs. |

Add `UNIQUE(id,schedule_id,space_id,currency)` on schedule revisions and
`UNIQUE(id,occurrence_id,space_id)` on occurrence events for the stream FKs.
Every non-audit column above is NOT NULL unless described nullable. Occurrences
are created with their own derived request IDs, not a shared batch UUID subject
to a per-row unique(space,request) conflict. Their unique(schedule,date) is the
business dedup key. Revision ID is deliberately **not** part of that key.

Create a deferred validator that reads immutable schedule.kind and requires:
expense → category optional expense-kind in this space, loan NULL; income →
category optional income-kind, loan/goal NULL; debt_payment → category/goal NULL,
loan same space/currency with direction i_owe_them. A funding goal must be an
active purchase goal in the same currency. Wallet optional, same space/currency.
Labels never default to an account's private email. Max 200 active schedules per
space; max 500 occurrences per materialization, with overflow rejecting the whole
request rather than silently dropping the rest.

Occurrences already materialized retain the original amount/date/references.
Schedule editing changes only not-yet-materialized dates. To replace an existing
bill, skip it explicitly and create a new schedule; no hidden bill revisions or
double materialization after an edit. Add a warning in the gateway/UI for this
policy. No job posts money or sends reminders in this task.

## 2. Command contracts and transitions

All functions return JSONB, follow 01 lock/replay and use planning receipts.
All arguments listed are required, with nullable expected heads explicitly
passed as SQL NULL. Common first args: p_space_id uuid,p_request_id uuid.

| RPC | Remaining exact arguments | Result fields |
| --- | --- | --- |
| `save_schedule` | p_schedule_id uuid,p_expected_revision_id bigint,p_definition jsonb | scheduleId,revisionId |
| `materialize_schedule_occurrences` | p_from_date date,p_to_date date | createdCount integer,existingCount integer,fromDate,toDate |
| `set_occurrence_state` | p_occurrence_id uuid,p_expected_event_id bigint,p_action text | occurrenceId,eventId |
| `confirm_scheduled_occurrence` | p_occurrence_id uuid,p_expected_event_id bigint,p_actual_amount_minor text,p_effective_date date,p_wallet_id uuid | occurrenceId,occurrenceEventId,financialEventId |
| `link_scheduled_payment` | p_occurrence_id uuid,p_event_id uuid,p_amount_minor text,p_expected_event_id bigint | occurrenceId,occurrenceEventId,financialEventId |

Definition exact keys: `currency,kind,state,nameEn,nameAr,expectedMinor,startsOn,
endsOn,cadence,intervalCount,categoryId,loanId,fundingGoalId,preferredWalletId`.
Unknown keys, malformed UUIDs/dates, noncanonical money and payload>64KiB reject.
Creating requires expected NULL and a new caller UUID; editing requires matching
current revision and unchanged currency/kind. Receipt returns precede head checks.

Materializer: inclusive from/to ≤90 days. Weekly dates are start+n*7*interval;
monthly dates are start month+n*interval using min(original day,last day of that
month); yearly retains original month/day, Feb29 clamps to Feb28. Derive n from
range start, then generate at most92 candidate dates per schedule, not from an
unbounded ancient start date. Filter start/end and current active revisions.
Count eligible unmaterialized candidates first under the space lock; >500 rejects.
Insert using stable schedule/date identity derivation and verify existing rows;
ON CONFLICT is only for the known schedule/date collision, never a blanket catch.
No duplicate at Jan31→Feb28→Mar31. Changing a schedule must not resurrect a skipped
occurrence or produce another bill for the same date.

Current occurrence state is the latest occurrence action combined with effective
settlements. skip allowed only when net settled=0; reopen only a skipped row;
link/confirm reject skipped rows. An inverse financial event makes that link's
net settlement zero from the inverse's effective date onward. Reversal does not
append a fictional occurrence event; history/read derives it. Fully settled
means net settlement≥expected; partial means >0 and <expected; pending otherwise.
Overdue is a separate boolean due_date<asOf and remaining>0 and not skipped.
Allow confirmed overpayment: settled may exceed expected; remaining=max(expected−
settled,0). Never silently modify expected amount to match the payment.

Confirmation algorithm: authorize/space/request lock → receipt replay → occurrence
head comparison → validate active referenced identities → invoke existing
record_financial_event for uncategorized income/expense or the existing
record_categorized_financial_event when a category is selected or record_loan_repayment for debt,
using the derived child request and explicit confirmed amount/date/wallet → append
one settlement event → if goal-funded expense, allocate min(available goal earmark,
confirmed amount) through task 10 link_goal_purchase in the same transaction →
append parent receipt. Zero available earmark leaves the bill paid but unfunded;
show this in projection. No auto-reserve or new goal contribution. Any failure
rolls back financial event, links and receipt together.

Uncategorized posting uses the existing five-argument RPC with movements JSON.
Categorized posting calls `record_categorized_financial_event(space,request,kind,
effective_date,movements,category_id)`; category is the sixth argument, not a
movement JSON field. Movements contain wallet_id and signed amount_minor text.
Loan repayment uses its existing six-argument RPC. Do not invent an amount overload.
The goal child call can link the newly inserted original event reentrantly.

Link-existing algorithm locks the original financial event FOR UPDATE before
checking its kind, currency, loan identity, effective date and remaining eligible
amount. Sum allocations across **all occurrences** for that original event;
new total must be≤eligible event amount. For loan events use debt repayment amount,
not opening principal. Reversed events cannot receive new links. Link-existing
also performs any goal fulfillment in the same transaction, subtracting existing
goal links so the same spending is never fulfilled twice. If another feature has
already fulfilled this event, reuse the eligible existing goal portion or reject
an incompatible goal; do not debit earmarks twice. Serialize with reverse command
on the original financial event; prove both race orderings.

## 3. Protected read

`scheduled_occurrence_page(p_space_id uuid,p_from_date date,p_to_date date,
p_after_due_date date DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit int DEFAULT25)`
returns JSON `{rows,hasMore,nextCursor,asOf}`. Range≤90 days, limit1…100, tuple
(due_date,id) ascending, fetch limit+1, all-or-none cursor. Row fields:
`id,scheduleId,sourceRevisionId,currentEventId,currency,kind,nameEn,nameAr,dueDate,
expectedMinor,settledMinor,remainingMinor,state,overdue,categoryId,loanId,
fundingGoalId,preferredWalletId,fundingShortfallMinor,asOf`.
IDs from bigint are text; currentEventId nullable; copied UUID references nullable;
state pending/partial/settled/skipped. Name comes from source revision. asOf is
UTC database date; sums use one statement snapshot. Read authorizes membership.

## 4. Red tests and acceptance

1. Jan31 monthly materialize90days twice → one row per due date, same IDs.
2. Schedule edit expected50000→60000 retains existing50000 occurrence; next new
   date is60000. Same-date new revision cannot insert duplicate occurrence.
3. Expected50000, pay20000 → partial/30000; pay40000 → settled/0, settled60000;
   reverse40000 next day → partial/30000, prior-day report remains settled.
4. One50000 expense link30000 to A then30000 to B rejects second; link20000 passes.
5. Goal50000 + bill50000 confirmation → cash−50000, earmark−50000, fulfilled+50000,
   monthly contribution unchanged; reverse restores cash/earmark and unpaid bill.
6. Same UUID after timeout produces one money event. Stale occurrence expected head
   produces none. Two concurrent confirm commands with same head yield one success.
7. Skip partially paid rejects; reversed fully unpaid can skip. Debt confirmation
   uses loan principal and repayment accounting, never ordinary expense.
8. Active schedule cap,90day/500row cap, NULLs, foreign references, all ACL/guard and
   seeded-upgrade checks from 01. Plan materialization changes no financial digest.

Run focused test files with env loaded per01, full `pnpm check`, record evidence,
commit `feat(recurring): add immutable schedules and payment settlement`; stop DB.
