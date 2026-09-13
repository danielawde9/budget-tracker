# Remaining roadmap: technical direction and execution gates

> **Execution update, 2026-09-13:** Use the [actionable task index](../superpowers/plans/future-planning/00-start-here.md)
> and [all-roadmap coverage map](../superpowers/plans/future-planning/40-roadmap-coverage.md)
> for later implementation. These split the proposal into SQL, gateway, UI and
> evidence tasks. Their explicit contracts refine the earlier shorthand below;
> they remain documentation, not applied SQL or permission to deploy.

2026-09-13 proposal. This preserves every identifier in the
[September 11 research](2026-09-11-competitor-research-and-roadmap.md).
The [master plan](2026-09-13-future-planning-master.md) routes the detailed
allocation/goals work. Source-present does not mean tested here, deployed, or
accepted. “Design gate” means a smaller model must not implement that item from
this register alone; it names the unresolved financial or external boundary.

## Core and daily-entry roadmap

| ID | Current source / future outcome | SQL and application direction | Exit evidence / gate |
| --- | --- | --- | --- |
| N1 | Monthly amount SQL present; editor planned | Keep monthly revisions; A1 adds percentage snapshots; A2 gateway; A3 Plan UI | Exact money, concurrent edits and monthly history matrix |
| N2 | Simple monthly report UI present; deeper reports remain | V0 proves classification; bounded new reads return text money and complete cursors; extend typed Reports boundary | Category and root totals reconcile; reversals and permissions tested as authenticated |
| N3 | Household/invitation modules present; delivery state not checked | Separate member-profile revisions and member-only projection; reuse Worker invitation boundary | No browser `auth.users` reads; live sends only when requested; profile visibility decision before schema |
| X1 | Notes/payees SQL and gateway present | Reuse immutable metadata; no duplicate note column on event | Refresh existing tests before extending editing/search |
| X2 | USD→LBP command present; broader exchange/UI partial | Reuse existing exchange RPC for this direction; reverse direction is a new reviewed command/shape | Four-way ordinary income/expense exclusion + inverse reversal + exact amounts |
| X3 | Repeat-as-new and payee suggestions present for loaded history | Persist preferences in member/space-scoped metadata only if requested; manifest and installable shell separate from offline writes | Confirm draft before posting; stale/archived defaults and new request IDs |
| X4 | Loaded-history filtering exists | `journal_search_page(space, from, to, wallet?, root?, payee?, min?, max?, query?, cursor?, limit)`; max 366 days per page, query≤120 chars, limit≤100, keyset(date,created,id); index scoped date/payee/category reads | Search beyond loaded page, apostrophes, Arabic, keyset tie cases and isolation; full text index only after measurement |
| X5 | Loaded-history export exists | Full-space export uses authorized bounded journal pages and streaming CSV; expose snapshot high-water id/date and exact filters; cap one job at 100k events and 20 MiB, split requested ranges when larger | CSV formula injection neutralized, exact money, bilingual headers, no browser secrets; exported totals reconcile to snapshot; explicit download action |
| X6 | Rename/archive/restore code present | Reuse wallet lifecycle commands, zero-balance archive contract | No new wallet lifecycle subsystem |
| X7 | Actor stored; human attribution not fully exposed | Member-display projection from N3; paginated activity read keyed(created_at,id); actor deactivated label preserves history | No email leaks to nonmembers; private-space boundary remains intact |
| X8 | Owner-specific Essentials setup decision exists; no universal pack | Versioned static bilingual suggestion definitions; preview then existing create-category commands with request receipts; recover partial command sequence visibly | Explicit opt-in, normalized duplicate handling, no migration seeds or existing-account mutation without request |

## Planning depth

| ID | Desired behavior | SQL/code contract | Dependency and gate |
| --- | --- | --- | --- |
| P1 / B1 | Bills/income schedules become reviewable occurrences | `schedule_revisions`, immutable `scheduled_occurrences` keyed(schedule,revision,due_date), `occurrence_events` (skip/reopen/link/confirm); materialize max 90 days/500 occurrences on demand; monthly 31st clamps to month-end by explicit default; timezone is space-configured for reminders, UTC audit | Separate draft spec before implementation; confirmed occurrence must call existing posting command atomically with settlement link; never auto-post |
| P2 / C1 | Optional rollover, including overspending | `budget_month_close_revisions` stores source snapshot, source event high-water mark and signed carry; `budget_carry_lines` links source and destination month/currency/root; preserve negative carry; no cash entry | Explicit change to no-carry decision; late/backdated events require reopen/restatement revisions; carry belongs in resources once and must not duplicate earmarked goals |
| P3 / C1 | Copy last month's plan | New `copy_allocation_month` command previews all active roots and targets, maps archive omissions explicitly, applies once with expected destination head and source snapshot | No overwrite of destination targets without reviewed diff; idempotent command; does not copy actual events |
| P4 / G1–G3 | Sinking funds and savings goals | Separate goal and earmark histories, current coverage, deadline contributions, milestone revisions | Fully specified in goals design; no dependency on automatic category rollover because goals retain their own earmark history |
| P5 / B2 | Available after commitments + daily guide | One read transaction deduplicates group remainder, unpaid bills, loan remaining reservations and goal earmarks/remaining contributions; signed shortage retained | Requires P1 and goals contracts; unavailable with incomplete state; see allocation formula |
| P6 / A1–A3 | Editable percentage lens, actual comparisons | Basis points, deterministic integer allocation, saved monthly mappings and normalized group relations | Fully specified; supersedes earlier “small tag” sizing because persistence, concurrency and money semantics matter |
| P7 | Split a purchase across categories | New `record_split_expense` protected command + immutable allocation lines; 2…20 lines, positive line values sum exactly to expense movement; compatible union projection treats old single association as one line | New spec for partial refunds, category archival and inverse allocation; ratchet prevents old association and split lines both classifying one event |
| P8 / B2 | 30–60 day cash outlook | `cash_outlook(space,currency,start_date,days≤60)` returns opening current cash and separate expected income/obligation series; posted links replace their predictions exactly once | Scenario only, never a posted balance; include conservative no-unconfirmed-income view and warn about negative projected days |
| P9 | Pay-date planning | `income_schedule_revisions` plus `plan_paycycle_assignments` from existing plan lines to cycle IDs; sum cycle allocations equals monthly line; dates do not create salary events | Design gate: irregular pay, biweekly three-pay months, overlapping months and bills before payday; no separate duplicate budget ledger |

### B1/B2 settlement contract to carry into their own spec

Each occurrence has expected amount, due date, currency, category/loan/goal
identity and settlement links. Partial payments sum toward the occurrence;
one event may settle multiple occurrences only when the allocated amounts do
not exceed its eligible movement. Loans remain linked to the loan RPC and its
reservation rather than a generic expense RPC. Reversing a linked payment
reopens the unpaid amount by projection. Skipping an occurrence removes that
expected obligation but preserves its history. Duplicate matching is only a
suggestion until a member confirms the association.

Expense group commitments use max(group remaining, unpaid obligations in
group), not their sum. For a $500 goal earmark funding a $500 annual bill,
reserve $500 once: the goal covers the bill and uncovered bill amount is zero.
If earmark is $300 and bill $500, reserve $300 + $200. When it is paid, the
expense reduces cash and fulfillment reduces the earmark in the same projected
state. Monthly historical contributions do not become a second cash deduction.

## Lebanon-native money

| ID | Feature | SQL/code direction | Design gate |
| --- | --- | --- | --- |
| L1 | Purchase paid in USD with LBP change | New protected event with explicit expense currency/value and linked exchange legs; existing generic transfer cannot represent this | Allocation of paid amount between purchase and change, fee treatment and reversal all require one reviewed numerical example and red tests |
| L2 | Dated reference exchange rate | `exchange_rate_quotes` append-only pair, numerator/denominator, quote_date, source, actor; no hardcoded current rate; display-only conversion labelled rate/date | Do not auto-fill 89,500 indefinitely from old research; manual quoted amounts remain facts; no conversion of canonical balances |
| L3 | Repay loan from other-currency wallet | One atomic loan principal reduction in loan currency plus wallet movement in payment currency and stored rational rate | Rounding, excess repayment, fee and reversal contract; never use two unrelated ordinary events |
| L4 | Loan planning upgrades | Due/overdue read and per-person aggregation first; debt goal links existing principal; later `loan_schedule_revisions` and distinct write-off/fee/interest event types | A write-off is not a payment; debt reduction and cash outflow separate; separately approve each event kind and classification |
| L5 | Count physical cash | `cash_reconciliation_sessions` record observed count, expected ledger high-water mark, difference; confirmed adjustment is a dedicated reversible event | Stable snapshot and concurrent-entry detection; no direct wallet balance edit; adjustment is not salary/ordinary spending |

## Household rituals and insight

| ID | Feature | SQL/code direction | Exit/gate |
| --- | --- | --- | --- |
| H1 | Weekly check-in | Per-member/space acknowledgement cursor, bounded checklist from uncategorized, overspent and due reads | Acknowledgement never recategorizes or changes the journal; member privacy tests |
| H2 | Explainable insight cards | Pure predicates over bounded report data; stable insight key(type,period,entity,revision); dismiss/restore metadata | Show input facts and deterministic threshold; no AI needed; fixed bills exempt from uniform daily pace |
| H3 | Mine/theirs/ours | Versioned wallet ownership labels and authorized read filters | Label is presentation only unless a new privacy/RLS spec changes visibility; selecting “mine” must not imply private |
| H4 | Hide amounts | UI preference scoped to user/device initially, applied consistently to charts/tooltips/accessible labels | No change to permissions; keyboard and screen reader checks; no accidental amounts in tab title |
| H5 | Monthly recap | User opt-in preference + delivery outbox keyed(member,space,month,recap_revision), minimal payload, existing Worker provider | Content/privacy review and explicit send authorization; never attach private-space details to household recap |

## Research-gated extensions

These remain visible future possibilities. Their SQL boundaries are identified,
but **they are not implementation packets** because the inputs or owner decisions
are missing. This avoids a smaller model inventing data formats or policies.

| ID | Idea | Bounded technical direction | Evidence needed before detailed implementation plan |
| --- | --- | --- | --- |
| E1 | Paste SMS → draft | Local parser with amount/date/payee confidence; no posting; strip sensitive identifiers | Sanitized real examples, supported senders, ambiguous currency/date policy |
| E2 | Receipt → draft | Private attachment record/storage first; optional extraction service behind explicit consent; drafts only | Provider/data-retention approval, Arabic number accuracy sample, file caps/types and access rules |
| E3 | CSV import | Versioned fixed template, parsed staged rows, preview errors, duplicate fingerprints, confirmation batches≤100 | Actual input file formats, duplicate policy, whether imported opening balances are allowed |
| E4 | Offline entry | Versioned local outbox with request UUIDs, bounded queue, explicit sync; reauthorize every replay | Device/browser persistence tests, private-device policy, conflict/stale category handling and capacity |
| E5 | Bilingual quick add | Text → typed validated draft using approved money/date grammar; provider only if chosen | Measured entry time and ambiguity set; fail rather than guess amounts/currencies |
| E6 | Savings circles | Circle schedule + member obligations, links to existing loans only after cash-flow mapping | Real circle rules, organizer role, defaults/missed installments and privacy |
| E7 | Assets/net worth | Non-cash asset register, quantity+unit, append-only valuations; separate locked/nonspendable status | Valuation sources, gold units, liability inclusion; any zakat estimator requires separate domain review |
| E8 | Household settle-up | Explicit attribution lines + per-currency balances, settlements reference loan/transfer commands | Ownership versus payer distinction, split rules, dispute/correction behavior |
| E9 | Pricing | Entitlements and subscription events in a separate boundary; no financial ledger privileges | Whether product is public and payment/provider/access policy |

## Additional day-to-day gaps retained explicitly

Refunds/reimbursements: distinguish genuine returned cash from Undo. A refund
should link the original expense, cap cumulative refunded value, keep merchant
cash as a current-date event, preserve currency and category allocation, and
exclude it from ordinary income. Full refunds, partial refunds, store credit,
and reimbursing another household member need a dedicated event spec before
SQL. This is a prerequisite for accurate sophisticated net-spend charts once
those user flows are exposed.

Unexpected income, missed salary, overspending, zero-income months, backdated
corrections, shared plans, upcoming annual costs and goal shortfalls are already
covered by A/G/B packets. AI, more infrastructure, automatic rates and bank sync
are not prerequisites for those human needs.

The earlier “won't do for now” boundary remains: no silent conversion, editable
posted history, unconfirmed posting, shared-login design, or bank-sync build
without a new viability assessment. Source inspection here did not revalidate
the old market-wide claim about Lebanese provider coverage.
