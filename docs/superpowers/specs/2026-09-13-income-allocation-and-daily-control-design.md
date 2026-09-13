# Income allocation and daily control — proposed design

**Status:** owner-review proposal, 2026-09-13. No application or database change
is authorized by this document. Read the [master](../../product/2026-09-13-future-planning-master.md)
and execute only a subsequently requested packet in the [plan](../plans/2026-09-13-future-planning-implementation.md).

## 1. Domain and UX contract

Keep these independent:

| Object | Answers | Example |
| --- | --- | --- |
| Space | Whose shared plan and permissions? | Personal, Household |
| Wallet | Where is the money? | USD cash, LBP cash |
| Income category | Where did income come from? | Salary, freelance |
| Expense root/child | What was the spending for? | Essentials → Rent |
| Allocation group | What priority does this serve? | Essentials 56%, Lifestyle 24%, Future 20% |
| Goal | What future outcome is being funded? | Emergency reserve, laptop |

Groups are an optional layer above the existing one-level category tree, not
another category nesting level. Members can use an existing Essentials root
as the sole root of an Essentials group. Do not force them to rename or
recreate their categories. Multiple expense roots may belong to one group.
Income categories do not belong to spending groups.

Setup sequence: select space/currency → enter expected income → choose manual
amounts or percentage mode → edit groups → map roots → preview amounts and
unallocated remainder → confirm. Group/category suggestions are opt-in UI
drafts. A skipped setup must still permit ordinary entry and basic actuals.
An existing account is configured by the same editor without onboarding again.

Default preset is a preview of Essentials/Lifestyle/Future with 50/30/20. It
creates nothing until accepted and every percentage is editable (56% is valid).
Labels are bilingual when supplied; at least one trimmed label is required.
Keep fixed-amount monthly planning available.

## 2. Amounts and allocation algorithm

Money: decimal integer strings over the API, `bigint` for stored individual
amounts, `numeric` for SQL products and aggregate intermediate values, `BigInt`
for pure TypeScript arithmetic. USD is cents, LBP whole pounds. Never sum or
compare USD and LBP without a separate explicit conversion presentation.
Individual targets are 0…999999999999999 minor units, matching current plans.
Return aggregate monetary fields as text to avoid JSON precision loss.

Percentages: integer basis points, 0…10000; 56% = 5600. Up to two decimal
places in the percentage input; reject excess precision rather than silently
rounding. A monthly split sums to at most 10000. The missing percentage forms
an implicit Unallocated row. No negative percentages or groups that push the
total beyond 100%.

Use largest-remainder apportionment across **all groups plus Unallocated**:

```text
numerator[i] = expected_income_minor * basis_points[i]
base[i]      = floor(numerator[i] / 10000)
fraction[i]  = numerator[i] mod 10000
remainder   = expected_income_minor - sum(base[i])
Give +1 to the first remainder rows sorted by:
  fraction descending, display_order ascending, stable group UUID ascending.
Unallocated sorts last for ties. Return saved integer amounts and their basis.
```

At most 12 groups + Unallocated; remainder is strictly less than that row count.
All loops are therefore bounded. Examples: $2,000 × 56% = $1,120; 101 cents
at 56/24/20 gives 57/24/20; 1 LBP at 50/30/20 gives 1/0/0. A zero income
plan has zero targets; comparison ratios with zero/negative actual income
return null and display an explanation.

**A saved percentage is intent; its monetary snapshot is the month's plan.**
The default denominator is expected net income. A new income entry changes
actuals but does not silently change targets. “Apply percentages to received
income” is a preview using `max(actual_income, 0)` and creates a revision only
after confirmation. Do not use a negative income correction as a negative plan.

## 3. Group, category, loan and goal accounting

Each group has `purpose = spending | future`. Spending groups contain root
expense category targets. Future groups contain allocations for the space's
`i_owe_them` loan commitment and savings goals. They do not contain synthetic
expense categories called “Savings.” A loan repayment remains a loan event.

The group target is a **parent envelope**, not another charge. Children describe
its composition. Example: Essentials $1,120 contains Rent $700, Food $300 and
group headroom $120; total commitment is $1,120, not $2,120. Child targets may
sum below their group target. Above it is shown as an internal allocation
conflict and blocks publishing that percentage snapshot until reviewed.
Zeroing an old child target is explicit in the publish preview.

Future example: $400 contains $150 expected loan commitment, $200 goal targets
and $50 future headroom. Loan repayments exceeding $150 consume that headroom
before creating a Future-group shortfall. Loans and goals outside a group are
shown as standalone commitments, never silently ignored or added twice.
The `they_owe_me` direction is receivable and is never an outgoing commitment.

In fixed-amount mode there are no parent envelopes: expense roots, loan
commitment and goal targets are the plan lines. Zero target differs from no
target: the first can be intentionally zero, the latter is “Not planned.”

## 4. SQL design and integration boundary

Reuse `monthly_budget_plan_revisions`, `set_monthly_income_plan`,
`set_monthly_category_target`, categories, `loan_monthly_currency_summary`,
financial events and movements. Existing RPC signatures remain valid.
Do not replace the journal or add direct browser writes. Add new timestamped
migrations only when A1 is requested.

### Proposed normalized relations

All rows carry space identity. All composite references use `(id, space_id)`
or the corresponding composite key; add required referenced UNIQUE constraints
in a forward migration. Identity rows are immutable, changes are revisions.

| Relation | Required fields and invariants |
| --- | --- |
| `allocation_groups` | `id uuid`, `space_id`, `created_at now()`, `created_by`; PK id, UNIQUE(id,space_id); max 12 active groups enforced under a space planning lock |
| `allocation_group_revisions` | identity revision `id bigint`, group+space FK, `name_en/name_ar` ≤80 chars, `purpose` allowlist, `display_order` 0…11, `archived bool`, request receipt, expected revision, actor/time; immutable |
| `allocation_template_revisions` | `id bigint`, space, currency, `expected_revision_id`, request receipt, actor/time; max 1 current head per space/currency resolved by id |
| `allocation_template_lines` | template+space FK, group+space FK, `basis_points int CHECK 0…10000`; UNIQUE(template,group); sum≤10000 enforced by deferred constraint trigger |
| `allocation_template_roots` | template+space FK, root category+space+expense-kind FK, group+space FK; UNIQUE(template,root); root parent must be null; group must have purpose spending |
| `allocation_month_snapshots` | `id bigint`, space, month_start first-of-month, currency, template revision, base income amount, `income_plan_revision_id`, expected snapshot id, request receipt, actor/time; index(space,month_start,currency,id desc) |
| `allocation_month_groups` | snapshot+space FK, group+space FK, copied names/purpose/order/bps, exact target; UNIQUE(snapshot,group); cross-row sum + unallocated = base income |
| `allocation_month_roots` | snapshot+space FK, root+space FK, group+space FK, `category_target_revision_id`; UNIQUE(snapshot,root); captures the mapping and exact category-plan revision used |
| `allocation_month_commitments` | snapshot+space FK, future group+space FK, `source_kind = loan_pool`, amount; at most one loan_pool per snapshot; shape CHECK uses `IS TRUE` |
| `planning_command_receipts` | PK(space_id,request_id), sequence_id bigint identity UNIQUE, command name, canonical nonnull fingerprint, bounded typed result JSON, actor/time; common recovery receipt for the new planning commands only |

G1 adds the separate `allocation_month_goal_lines` relation with validated
goal and monthly-target FKs. Until G1, commands reject goal lines. A1 does not
create a free text goal ID column, a dangling FK or a goal discriminator with
unenforced identity. Receipt result JSON has an allowlisted schema per command
so UUID entity IDs and bigint revision IDs retain their distinct types.

Month snapshots store copied group labels and mappings; renaming a group or
mapping a root next month cannot recategorize an old month's report. A member
may deliberately revise a prior month, creating a new snapshot with visible
history. Default reads use latest snapshot; history reads use a specified id.
Actuals remain live by event effective date; backdated corrections may restate
actuals. Plan history is not a promise of frozen actuals.

### Cross-row constraints and access

Row CHECK constraints cover required values and union shapes; composite FKs
enforce tenancy and entity identity. A deferred constraint trigger validates
group sums, line counts, one mapping per root, and category/commitment totals
at commit. Do not use a CHECK containing a lookup into other rows. PostgreSQL's
[constraint documentation](https://www.postgresql.org/docs/current/ddl-constraints.html)
explains the boundary between row checks and relational constraints.

Enable RLS; grant no direct INSERT/UPDATE/DELETE/TRUNCATE to PUBLIC, anon,
authenticated or service_role. Every revision/association/receipt table rejects
UPDATE, DELETE and TRUNCATE with statement triggers, including zero-row writes.
Keep any privilege-probe test transactional. Internal helpers have no public
EXECUTE. Expose authenticated protected commands/read projections with fixed
search paths and active-member authorization. A DEFINER read checks membership
itself; do not broaden table SELECT merely to make an invoker read work.
RLS does not replace command authorization; see [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

Create indexes for current heads, ordered history and referencing composite FKs.
Avoid FORCE RLS on an owner-backed command without checking the repository's
role arrangement; follow its existing explicit protected-command pattern.

### Commands (new public contract)

All names below are proposed, not existing callable RPCs.

```text
save_allocation_template(space, request, currency, expected_revision_id,
                        groups_json, root_mappings_json) -> template_revision_id
publish_allocation_month(space, request, month, currency, expected_snapshot_id,
                         template_revision_id, expected_income_revision_id,
                         income_minor, root_targets_json, commitment_lines_json)
  -> snapshot_id, income_revision_id
allocation_month_state(space, month, currency, snapshot_id?)
  -> one header + bounded groups + head tokens + totals + stale-child flag
allocation_category_page(space, month, currency, group_id?, after_root_id?, limit)
  -> up to 100 roots, complete next cursor, has_more
allocation_history_page(space, month, currency, before_id?, limit)
  -> up to 50 revisions, complete next cursor
find_planning_command(space, request) -> null or command + typed result + sequence_id
```

Payload caps: 64 KiB, 12 groups, 200 mapped roots per publication, 100 goals
after G1. Reject unknown JSON fields, duplicates, wrong types and oversized
input before looping. Roots beyond 200 require a separately reviewed limit
change; the rest of the account remains usable in fixed-amount mode.

Publish in **one transaction**: authorize → required-input validation → canonical
fingerprint → request lock → identical replay lookup → planning-scope lock →
recheck active membership → compare snapshot/template/income/root head tokens →
validate categories and all child totals → call protected/internal monthly
setters → insert snapshot and children → persist receipt → return. Root updates
are ordered by UUID; deterministic UUIDs derived from parent request + operation
+ root identity provide distinct child requests. Use a documented server-side
derivation and never recycle an unrelated client UUID. Replaying the same
request returns the original result even if a later plan exists, provided the
actor is still authorized. Changed-payload replay is rejected.

For consistency, existing monthly setters must participate in the same
space/month/currency planning lock through a forward change when A1 executes.
Retain their signatures and acceptance semantics except any separately proved
V0 defect. Compare-and-swap uses `IS DISTINCT FROM`, including initial null.
Lock category lifecycle rows and membership using the established stable
ordering so concurrent archive/removal cannot invalidate validation mid-write.
Unknown transport outcome: lookup receipt, then retry same request/payload if
absent; an accepted write followed by read failure offers **refresh**, not repost.

If another client changes a fixed category target after a snapshot is saved,
return `child_plan_changed = true`. Show the saved snapshot values and a
review-and-republish action; never quietly present a hybrid as the saved plan.

## 5. Actuals: one classification, no duplicate money

Create/reuse a private normalized activity projection for the new bounded
reads. Classify a reversal by its original event kind, but retain the already
signed movement amount. Ordinary expense actual = `-sum(amount_minor)` for
expense-classified movements; ordinary income = `sum(amount_minor)` for
income-classified movements. Do not negate an inverse movement a second time.
Use the reversal's own effective date. Keep negative net correction months.

Join category association for the event, or its original where applicable,
and resolve root as `coalesce(category.parent_category_id, category.id)` only
after verifying the actual column name in the subcategories migration. The
current code uses `parent_category_id`; do not infer deeper ancestry. One
movement enters exactly one root aggregate. Roots plus Unmapped plus
Uncategorized must reconcile to ordinary expenses per currency.

| Activity | Income | Ordinary expense | Cash delta | Extra planning treatment |
| --- | --- | --- | --- | --- |
| Ordinary income/expense | Signed income only | Signed expense only | Signed movement | Category/group attribution |
| Opening wallet cash | 0 | 0 | Signed movement | Available cash, never salary |
| Same-currency transfer | 0 | 0 | Legs net to 0 across space | No new saving or spending |
| Exchange | 0 | 0 | Per-currency legs | No income inflation |
| Borrow/lend principal | 0 | 0 | Signed movement | Dedicated lending/borrowing buckets |
| Repay own debt | 0 | 0 | Outgoing movement | Debt commitment used once |
| Receive repayment | 0 | 0 | Incoming movement | Not salary |
| Plan/earmark command | 0 | 0 | 0 | Intent/reservation only |
| Reversal | Original classification, inverse signed amount | Same | Same | Recompute associated usage |

Every new event enum value requires a classification and rejection ratchet.
Refunds and split purchases stay separate roadmap work; never fake them with
income or altered old associations.

## 6. Exact numbers and labels

Per currency, let I be ordinary received income, E ordinary net spending,
D actual own-debt cash repayment, and L remaining loan reservation.

| Label | Formula and interpretation |
| --- | --- |
| Planned income | Saved expected income; intent |
| Received income | I, from posted ordinary income |
| Income difference | I − planned income; negative is a shortfall |
| Income after spending | I − E; includes no loan principal |
| Income after spending and debt payments | I − E − D; show alongside the first metric |
| Left to allocate, manual mode | planned income − sum(root targets) − (D + L) − sum(goal targets) |
| Left to allocate, percentage mode | implicit unallocated − standalone commitments − sum(Future-group excess); definitions immediately below |
| Group remaining | group target − group actual; negative is overspent |
| Actual share of income | actual × 10000 / I when I > 0; may exceed 100% |
| Share of spending | group ordinary expense / E when E > 0; different chart and label |

Spending-group actual means ordinary expenses. Future-group used means
own-debt repayments + net earmark additions for its goals in the month;
it must be labelled “Allocated/paid” and shown separately from expense bars.
Goal fulfillment/release details are defined in the goals spec. Neither a
cash transfer nor an unspent budget automatically qualifies as goal funding.

Standalone commitments are root targets not mapped to a spending group, own-debt
commitment not assigned to a Future group, and goal monthly targets not assigned
to a Future group. For each Future group, excess is
`max(assigned debt actual + assigned remaining debt reservation + assigned goal
monthly targets - group target, 0)`. Child expense targets are not additional
standalone commitments when mapped. Only one group can own the loan pool and
only one group can own a goal within a snapshot. Use current debt consumption
and saved goal-target revision values; a changed goal target marks the snapshot
stale just like a changed category target. A3 before G1 uses zero goal terms.

**Available after commitments is B2, not A3.** It requires reconciled obligation
and goal data. When B2 is built, let C be current eligible wallet cash; R the
outstanding current goal earmarks; Q all remaining expense allocations/obligations
and debt reservations (deduplicated); U remaining new goal contribution targets.
Also let H be unassigned Future headroom, calculated per Future group as
`max(group target - full debt commitment - saved goal monthly targets, 0)`.
Then available-after-commitments = C − R − Q − U − H. Keep a signed shortfall;
display zero spendable with the separate shortage when negative. Expected
future income is excluded. A daily guide is floor(max(available,0)/days left
including today), labelled an estimate and unavailable with incomplete data.

Within each spending group reserve `max(group remaining, total unpaid scheduled
obligations assigned there, 0)`, not their sum. A bill without a group is a
separate reservation. Own-loan dues use the loan reservation, not another bill
copy. A goal-funded bill uses its earmark first; reserve only the uncovered
portion again. The B2 packet must prove these intersections before release.
U is `sum(max(monthly_goal_target - net_goal_contribution_this_month, 0))`.
Paid debt has already reduced C, so Q includes only unpaid reservations, not
the actual paid amount again. Releasing a goal earmark decreases R and may
increase U; reducing the monthly target is a separate reviewed change.

## 7. Visual contract

An amount remains readable without interpreting a chart. Use labelled horizontal
plan-versus-actual bars, a target marker, and an overflow segment plus “$60 over.”
Never clip the underlying value at 100%. Zero plan with spending says “No target”
or “$0 target” according to revision presence. Net-negative correction rows use
a zero-baseline signed bar and “Net correction”; no negative CSS widths.

Current-month comparisons align elapsed calendar days against the equivalent
previous-month range; offer full-month comparison with a clear label. February
and 31-day months clamp comparison endpoints; never compare a partial month to
a full previous month without saying so. Trends are bounded 1–12 months; a
month with no entries is zero, a failed load is unknown. Daily pace only applies
to explicitly variable spending groups; fixed rent and annual bills have no
uniform-daily alarm. Incomplete classification shows a separate review row.

Chart series: `period, currency, groupId, plannedMinor, actualMinor, varianceMinor,
hasPlan, coverageState`. Monetary values stay strings; convert only bounded
ratios/coordinates for rendering. SVG/CSS is sufficient initially; no chart
dependency chosen here. Provide a table equivalent, keyboard drilldown, labels
independent of color, reduced motion, 200% zoom, 320px width, and EN/AR RTL.
Use logical CSS and `<bdi>` for every account/category/amount string.

Route placement follows the approved shell when A3 begins. In Control Room,
Plan owns configuration and Home shows a compact result with drilldown. This
proposal does not authorize another navigation redesign or global CSS rewrite.

## 8. Acceptance examples

| Scenario | Expected result |
| --- | --- |
| Expected $2,000, split 56/24/20 | $1,120 / $480 / $400, no rounding loss |
| Received $1,800, Essentials $1,180, Lifestyle $430 | Essentials $60 over; lifestyle $50 under; ordinary income after spending $190 |
| Same example, own-debt payment $150 | Income after spending and debt $40; debt not in ordinary expenses |
| Allocate $200 to goal in that example | Income-based use exceeds income by $160; cash coverage depends on existing wallet cash; not an invented expense |
| $50 expense and same-date inverse reversal | Net expense zero, including root and group reports |
| $50 expense in August, inverse in September | August +50, September −50 ordinary expense |
| Parent Essentials with $30 grocery child spend | Root and group each +30; overall total +30 |
| Receive borrowed $500 with no salary | Received income zero; cash +500 |
| Late salary | Plan stays fixed; received-income comparison changes; no invented available cash |
| New unmapped root, or uncategorized event | Included in total and visible review row; no lost expenses |
| Two simultaneous plan saves from same head | Exactly one succeeds; other reports stale revision |
| Save groups with total 100.01% | Rejected by database and gateway; no partial revisions |
| Membership removed before retry | Replay denied; no receipt information leaked |
| Set next month's Essentials to 60% | Prior month's saved 56% snapshot stays intact |

See implementation packets V0 and A1–A3 for file ownership and commands.
