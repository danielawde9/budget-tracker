# 10 — Goal commands implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Make every goal/milestone/funding change atomic, authorized and
request-idempotent. **Layer:** DB. **Depends on:** 09. **Tech Stack:** PostgreSQL.
Create timestamped `_goal_commands.sql`, `tests/db/goal-commands.integration.test.ts`,
`tests/db/goal-funding.integration.test.ts`; inventory/decisions/evidence10.

## Task 1 — Exact command interfaces

All return JSON with the result shape below and follow task 03's actor/space-lock,
canonical fingerprint, replay, head comparison, validate, append, receipt order.
All public money arguments are text. No optional-field defaults beyond those
listed here; SQL NULL is required explicitly where the first head is absent.

| RPC | Exact arguments after `(p_space_id uuid,p_request_id uuid)` | Result |
| --- | --- | --- |
| `create_goal_plan` | `p_goal_id uuid,p_definition jsonb,p_milestones jsonb` | goalId,revisionId |
| `revise_goal_plan` | `p_goal_id uuid,p_expected_revision_id bigint,p_definition jsonb,p_milestones jsonb,p_state text` | goalId,revisionId |
| `record_goal_earmark` | `p_goal_id uuid,p_action text,p_amount_minor text,p_expected_head text,p_accept_underfunded boolean` | eventId,goalId |
| `move_goal_earmark` | `p_from_goal_id uuid,p_to_goal_id uuid,p_amount_minor text,p_expected_from_head text,p_expected_to_head text,p_accept_underfunded boolean` | eventId |
| `reverse_goal_earmark` | `p_event_id bigint,p_expected_heads jsonb` | eventId |
| `link_goal_purchase` | `p_expense_event_id uuid,p_lines jsonb` | linkIds[] |
| `set_goal_monthly_target` | `p_goal_id uuid,p_month date,p_amount_minor text,p_expected_revision_id bigint` | revisionId |
| `set_goal_milestone_state` | `p_milestone_id uuid,p_action text,p_expected_event_id bigint` | eventId |

Definition exact keys: `kind` reserve/purchase, `currency` USD/LBP, `nameEn`,
`nameAr`, `note` nullable strings, `targetMinor` positive text, `deadline` date
string/null, `contributionMode` manual_monthly/by_deadline, `monthlyAmountMinor`
nonnegative text/null, `priority` integer0…999. Existing kind/currency cannot be
changed in a revision. Initial state active; revisions may active/paused/closed.
At least one name, ≤120 chars; note≤1000. Real-date validation precedes cast.

Milestone exact keys: `id` UUID, `kind` amount/checklist, `labelEn`,`labelAr` nullable1…120 chars (at least one),
`thresholdMinor` positive text/null, `dueDate` date/null, `ordinal`0…19. Full
snapshot≤20; omitted IDs become inactive, old definition/history stays intact.
Amount thresholds/date order checked in DB, not only UI. Existing milestone
identity cannot move to another goal or change amount/checklist kind once
checklist events exist; otherwise create a new milestone identity.

Expected-head objects for reverse: array of `{goalId,head}` for exactly the
original event's goals. Purchase lines: `{goalId,amountMinor,expectedHead}`;
1…20 unique goals; same-space/currency as the expense. Unknown/missing keys,
SQL/JSON null required fields and payload>64KiB are rejected.

## Task 2 — Goal definitions and monthly targets

- [ ] `create_goal_plan`: count current active/paused goals under space lock;
  reject >100 per currency and relevant including restored closed >200. Insert
  immutable identity, initial revision, milestone identities/definition lines,
  and receipt in one transaction. No wallet/event/posting mutation.
- [ ] `revise_goal_plan`: identical replay precedes head validation; compare
  current head, validate full definition/milestones and state transition;
  closing requires current remaining earmark0. Target reductions retain old
  history and show overfunding. Paused goals allow release/fulfillment but not
  new positive funding or new positive monthly targets. Reopening is explicit.
- [ ] `set_goal_monthly_target`: normalized month, current active goal for
  positive amount, same goal/currency stream predecessor; zero permitted to
  clear a target. Do not write a category expense target for savings.
- [ ] `set_goal_milestone_state`: current checklist milestone only; alternate
  complete/reopen, disallow duplicate state with a new request; initial reopen
  is invalid. Completion never changes goal money.

## Task 3 — Effective earmark balance and stale token

Implement private `goal_financing_state(p_goal_id uuid,p_as_of date)` returning
one row `(earmarked_minor numeric,fulfilled_minor numeric,head text)`.
Current command callers use server UTC date; they never accept a client cash
balance. Formula per goal:

```text
earmarked = sum(signed goal_earmark_lines on/before as_of)
          - sum(link amounts whose original expense date <= as_of)
          + sum(link amounts whose linked reversal date <= as_of)
fulfilled = original-linked amount - reversal-linked amount
```

SQL must join each purchase link once; an original can have at most one
reversal, as enforced by the existing journal. Reversal date may precede or
follow original date; preserve both business dates and test that case. Do not
use “not exists any reversal” to erase the expense from every historical month.

`head` is SHA-256 of canonical JSON containing current goal revision ID,
latest goal earmark event ID, latest purchase link's `(created_at,id)`, count of
linked reversals effective on/before date, earmarked amount and fulfilled amount.
It is an opaque 64-lowercase-hex stale token, not a bigint revision. This refines
the old `expected_earmark_head`: financial reversals affect goal balance even
when no new planning event was inserted. Query these aggregates in one statement.

Implement private `goal_cash_pool(space,currency,as_of)` as signed sum of all
same-space/currency wallet movements with event effective_date≤as_of. Include
negative wallets and all original/inverse movements. No bank account exclusions
or non-cash assets in v1. No float or per-wallet max(0) before summing.

## Task 4 — Funding operations and constraints

`record_goal_earmark`: action reserve/release only. Under the common space lock,
load financing state and compare expected head before validating amount.
Release≤earmarked. Reserve≤max(target−earmarked−fulfilled,0). A reserve into
paused/closed rejects. For `accept_underfunded=false`, reject if total remaining
earmarks plus proposed net increase exceeds max(current cash pool,0), message
`goal_underfunded_confirmation_required` with SQLSTATE22023. A later ordinary
cash posting can still make it underfunded; no binding hold is promised.
Insert one event with server date and one signed line; receipt follows.

`move_goal_earmark`: different goals, same currency/space; validate both heads,
source balance and destination target/state. Insert one move event and exactly
two opposite lines, same amount. Underfunding flag acknowledges changed priority
coverage, but moving claims creates no new aggregate claims. No cash transfer.

`reverse_goal_earmark`: original in same space; not itself reverse; no prior
reversal; exact expected-head set; insert inverse lines with current server date.
Reject if any current or intermediate effective balance would become negative.
Allow reversal to restore previously released funding even into a paused/closed
goal; expose needs-review without silently editing its state. A reverse can
exceed a subsequently reduced target because it corrects history, not new intent.

`link_goal_purchase`: space lock → lock original financial event FOR UPDATE →
goal IDs in sorted order. Require kind expense, no reversal record, date≤today,
all movements one currency, no loan postings. Validate total existing+new links
≤`-sum(expense movement amounts)`. Validate each head and spendable earmark from
the expense date through today. Add **links only**, no extra negative earmark
lines. Current balance alone is insufficient for a backdated expense: construct
the signed effective goal timeline and ensure running sum≥0 after the new link.
Reject linking an old purchase to funds reserved only later.

Use transaction constraints and event lock to prevent concurrent over-linking.
Existing reversal locks original event too; race proof must show either link
commits before reversal (later restored by projection), or reversal commits
first and linking rejects. No financial reversal function change is required
for these associations; if source has changed, verify this premise before code.

## Task 5 — Exact tests and closure

Use disposable setup/test recipes. Assert unchanged financial table digests for
every command. Numerical cases:

| Test | Expected |
| --- | --- |
| cash70000; reserve emergency60000 and laptop30000 with acknowledgement | claims90000; coverage later60000/10000 |
| reserve20000; release5000 | earmarked15000; monthly net contribution15000 |
| move5000 between goals | source−5000/destination+5000, combined claims unchanged |
| purchase reserve100000; link expense40000 | earmark60000, fulfilled40000, no new cash rows |
| reverse that expense | earmark100000, fulfilled0 as of reversal date |
| link40000 twice to expense50000 | second rejects; no partial links/receipt |
| release same60000 twice concurrently | first succeeds; second stale; nonnegative balance |
| close after full fulfillment, then expense reversal | current closed definition retained; restored earmark visible/needs-review |
| identical replay after goal later changed | old result returned to same authorized actor |
| new actor reuses request UUID | idempotency conflict, no result disclosure |

Also test all null/discriminator/tenant/FK/count/constraint-trigger cases from 09,
ordinary spend race with a funding preview (advisory coverage may change),
same-request two-connection replay, late expense history, date of inverse before
original, target reduction, milestone amount independence and zero-row deletes.

Run focused two files, empty/seeded upgrades and full DB check; commit
`feat(goals): add protected goal funding and milestone commands`. Exit before 11.
