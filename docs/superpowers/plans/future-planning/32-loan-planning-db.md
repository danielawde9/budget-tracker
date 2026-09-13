# 32 — Loan people, schedules and non-cash forgiveness

**Layer:** DB. **Depends on:** 27,14. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Execute one SQL step per request

32a people/due projections;32b instalment revisions;32c forgiveness. Separate
migrations/tests/commits and evidence suffix. Interest/fee posting is excluded
until the explicit numerical contract at the end is resolved, not silently
implemented as principal or spending.

### 32a Stable person identities

Create `_loan_persons.sql`, `tests/db/loan-persons.integration.test.ts`.
`loan_people(id uuid PK,space_id uuid,name_en text nullable1…120,name_ar text
nullable1…120,actor_id,created_at)` at least one label; immutable identity.
`loan_person_link_revisions(id bigint identity,loan_id,space_id,person_id,
expected_revision_id nullable,request_id,actor_id,created_at)` standard stream.
No automatic merge by normalized name: existing identical strings may be different
humans. `create_loan_person(space,request,person UUID,name_en,name_ar)` →{personId};
`link_loan_person(space,request,loan,person,expected_revision)` →{revisionId}.
Use explicit public p_ prefixes, UUID IDs and bigint expected head. Authorize space.
`loan_due_page(space,currency,as_of_date,after_due_is_null boolean nullable,after_due_date nullable,after_id nullable,
limit1…100)` returns id,personId nullable,legacyPersonName,direction,dueDate nullable,
outstandingMinor,overdue. NULL due dates sort last with full isNull/date/id cursor;
name the actual cursor fields afterDueIsNull,afterDueDate,afterId to preserve ties.
`loan_person_summary(space,person,currency)` → borrowedOutstandingMinor,
lentOutstandingMinor,netMinor. Do not net opposite directions without displaying
both. Tests same-label distinctpeople, partial repayment/inverse, cancelled membership.

### 32b Instalment intent

Reuse task 14 debt schedules per loan for recurring same-value instalments. For
unequal dated amounts add `loan_instalment_revisions` parent (loan,space,currency,
expectedhead,line_count1…120,audit) and children(parent,ordinal1…120,due_date,
amount_minor positive 15 digits), exact count and sum≤current outstanding at save.
`set_loan_instalments(space,request,loan,expectedhead,lines jsonb)` →{revisionId}.
Lines ordinal/date/amountMinor; no interest inference. Materialize into the same
occurrence system through a stable per-loan-instalment identity; do not keep a
second paid/unpaid balance. Superseding an already-settled instalment requires
explicit retained settlement mapping; v1 rejects editing materialized instalments
and permits only not-yet-materialized future dates. DB due totals derive from
remaining linked payments, cap principal, flag schedule mismatch after forgiveness.
Tests 5000+5000 against10000;10001reject; partial/reversal; no duplicate obligations.

### 32c Forgiveness / write-off

Create new kind loan_forgiveness; event+loan posting principal−amount,
repayment_effect0, **zero wallet movements**. `forgive_loan_principal(space,request,
loan,amount_text,effective_date,reason text1…500)` →{eventId}. Current loan lock,
positive amount≤outstanding, immutable reason metadata, exact shape. Both debtor
and creditor directions allowed, clear display labels debt forgiven/claim written
off. Reversal restores principal and is rejected if domain invariants would break.
Paid-this-month and cash-income/expense stay0. Debt goal progress based on reduced
principal can improve, but no claim “you paid this much.” Test classification and
old repayment race. New no-wallet event needs explicit shape allowance only for
this kind, never relaxing generic posting to accept empty movements.

### Remaining fee/interest decision packet

Write `docs/product/loan-fees-interest-evidence.md` only if requested: one real
sanitized agreement specifying fixed/compound fee, accrual timing, currency,
rounding, payment waterfall, late fee and reversal. Derive ten numerical fixtures
and ask only unresolved contractual facts. Until supplied there is no defensible
SQL for interest; smaller model must not invent terms from the word “loan.”

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

## 32b exact occurrence adapter

Each instalment ordinal has a stable UUID derived from loan ID and ordinal and
owns a task 14 schedule with starts_on=ends_on=instalment due date, monthly cadence,
interval1, kind debt_payment, loan reference and its explicit amount. This yields
one occurrence without adding another settlement registry. Store schedule_id on
instalment child with a same-space FK. Updating an unmaterialized instalment appends
a schedule revision under the same space/request transaction. If its old date is
already materialized, reject edit; never silently move a paid bill. Creating120
schedules still obeys task 14's200 active-schedule cap; reject complete operation
if space capacity would be exceeded. Duplicate ordinal and schedule reuse reject.

## Canonical public signatures for32a–c

These names/types supersede shorthand signatures above; all return JSONB.
- `create_loan_person(p_space_id uuid,p_request_id uuid,p_person_id uuid,p_name_en text,p_name_ar text)`.
- `link_loan_person(p_space_id uuid,p_request_id uuid,p_loan_id uuid,p_person_id uuid,p_expected_revision_id bigint)`.
- `loan_due_page(p_space_id uuid,p_currency currency_code,p_as_of_date date,p_after_due_is_null boolean,p_after_due_date date,p_after_id uuid,p_limit int)`.
- `loan_person_summary(p_space_id uuid,p_person_id uuid,p_currency currency_code)`.
- `set_loan_instalments(p_space_id uuid,p_request_id uuid,p_loan_id uuid,p_expected_revision_id bigint,p_lines jsonb)`.
- `forgive_loan_principal(p_space_id uuid,p_request_id uuid,p_loan_id uuid,p_amount_text text,p_effective_date date,p_reason text)`.

Due-page response is `{rows,hasMore,nextCursor}`. Cursor fields are
`dueIsNull,dueDate,id`; initial cursor all SQL NULL. A supplied cursor requires
isNull and id, with dueDate NULL exactly when isNull=true. Sort ascending
`(due_date IS NULL,coalesce(due_date,DATE '9999-12-31'),id)` and use the identical
predicate. Limit1…100; asOf date≤today. Outstanding uses postings whose event
business date≤asOf. Summary does not expose another space's same-name person.
