# Budget future plan: everyday control and life goals

Prepared 2026-09-13 against local `main` at `59af39a`.

**Status: proposed planning package for owner review. Documentation only.**
This is not permission to implement, migrate, seed an account, push, or deploy.
The defaults below make the proposal concrete; they do not silently supersede
approved product decisions. A future implementation request should name one
packet from the implementation plan. Evidence here is source inspection, not
a fresh test run or proof of the hosted application's state.

## Start here

The product should answer five questions:

1. What money do I actually have, in each currency?
2. What did I intend that money to cover?
3. Am I spending more than planned or more than I earned?
4. What upcoming obligations and savings intentions reduce my available cash?
5. Are my short- and long-term goals progressing, and what is the next milestone?

| Document | Purpose |
| --- | --- |
| [Allocation and daily-control specification](../superpowers/specs/2026-09-13-income-allocation-and-daily-control-design.md) | Setup, editable percentages, exact arithmetic, SQL contracts, actuals, bars, shortfalls, month changes |
| [Goals and milestones specification](../superpowers/specs/2026-09-13-goals-and-milestones-design.md) | Short/long horizons, cash earmarks, sinking funds, milestones, deadlines, progress and reversals |
| [Implementation packets](../superpowers/plans/2026-09-13-future-planning-implementation.md) | One layer per task, file ownership, prerequisites, algorithms, red-test fixtures, verification and smaller-model prompt |
| [Remaining roadmap technical register](2026-09-13-remaining-roadmap-technical-register.md) | All earlier roadmap items retained, technical direction, dependencies, explicit research gates |
| [Original competitor research](2026-09-11-competitor-research-and-roadmap.md) | Historical broad market comparison; use the refreshed status below when judging current source |

## What was already planned, and what was missing?

The September 11 roadmap already proposed P4 (sinking funds and savings goals),
P5 (left to spend), P6 (editable Needs/Wants/Savings), P8 (short cash outlook),
and P9 (pay-date planning). It did **not** fully define goal horizons,
milestones, contribution accounting, percentage rounding, historical mappings,
or how to avoid counting savings and debt twice. This package fills those gaps.

### Current source inventory, refreshed September 13

| Capability | Source evidence | Actual level established here |
| --- | --- | --- |
| Auth, spaces, wallet journal, categories/subcategories, loans, household | `src/features/{auth,workspace,wallets,categories,loans,household}/` | Modules and integration tests exist; no new runtime claim |
| Income/category monthly amounts | `supabase/migrations/20260912101000_monthly_budget_planning.sql` and `20260912101500_harden_monthly_budget_plan_shape.sql` | SQL and `tests/db/monthly-budgeting.integration.test.ts` exist; dedicated Plan UI is proposed in Control Room |
| Basic reports | `supabase/migrations/20260912102000_reporting_read_models.sql`, `src/features/reports/` | Current/previous month gateway and simple report page exist; full category charts are not established by these files |
| Notes/payees | `20260912090000_financial_event_notes_and_payees.sql`, Wallets gateway | Source exists; old X1 “missing” statement is historical |
| Exchange | `20260912100000_usd_to_lbp_exchange.sql` | USD→LBP protected command exists; do not assume reverse-direction or mixed-currency purchase support |
| Wallet lifecycle | `20260911100000_wallet_lifecycle_commands.sql`, wallet dialogs | Rename/archive/restore source exists |
| Quick entry, discovery, export | `src/features/wallets/quick-entry.ts`, `journal-tools.ts`; September 12 decisions | Loaded-history helpers exist; global search/export and an installable app remain separate work |
| Control Room | September 12 spec and plan | Proposed integration target, not proof it is implemented; current routes still use Home/Wallets/Loans/Categories/Reports/Household |
| Percentage policies, goal entities, goal milestones, recurring obligations | No corresponding tables/features in inspected tree | New proposal in this package |

Never equate a migration file with applied/live SQL or a plan with working UI.
Refresh this table before execution; another session may have advanced the app.

## Competitor evidence refreshed for this request

Checked live public primary sources on 2026-09-13. These are documented vendor
capabilities, not hands-on audits or endorsements. The exact formula behind
Dollarwise's available-money number was not verified.

| Product | Verified public claim | Design lesson for Budget |
| --- | --- | --- |
| Dollarwise | The App Store's 6.4 notes describe percentage targets saved to the account and editable month to month. Its description includes Needs/Wants/Debt-Savings and available spending. | Editable percentages are a useful planning lens; 50/30/20 is only a template. [App Store](https://apps.apple.com/us/app/dollarwise-budget-tracking/id6739215932) |
| Dollarwise | The website advertises customizable goals for vacations and emergency funds. A milestone subsystem and precise funding semantics were not verified. | Goals deserve their own clear specification. [Vendor site](https://dollarwise.com/) |
| YNAB | Its guide distinguishes saving a repeated amount from accumulating a target amount by a future date. | Support both monthly contribution targets and deadline-based suggestions. [Savings guide](https://www.ynab.com/guide/how-to-save-money) |
| Monarch | Flex budgeting separates fixed, non-monthly and flexible expenses, with goals integrated into planning. | Show an understandable spending allowance while keeping its components inspectable. [Flex budgeting](https://www.monarch.com/flex-budgeting-simplify-your-spending-with-just-one-number) |
| Actual | Schedules can wait for manual approval and can be matched with existing entries. | A bill becoming due should not invent a cash payment. [Schedules](https://actualbudget.org/docs/schedules/) |

No new price, banking-coverage, or Lebanon economic claim is needed for this
design. The wider September 11 research remains a dated reference.

## Three approaches considered

| Approach | Benefit | Cost | Recommendation |
| --- | --- | --- | --- |
| Only fixed category amounts | Smallest extension of current SQL | Does not satisfy income percentages or life-goal planning | Retain as an available mode |
| Percentage lens over revisioned monthly amounts, plus separate goals | Simple setup, precise history, compatible with the journal | Requires explicit snapshots and mapping rules | **Recommended** |
| Replace everything with a fully enforced envelope ledger | Every unit of cash gets a binding assignment | Reworks posting, negative wallets, exchange, corrections and concurrent spending | Separate future architecture decision; not the default |

## Proposed everyday experience

Setup belongs to the active personal/household **space**. Wallets describe where
money is held; categories describe what entries were for; allocation groups
describe priorities; goals describe future outcomes. Choosing a group does not
create a bank account or move money.

The member chooses a currency and expected net income, then fixed amounts or
an editable allocation split. Example: Essentials 56%, Lifestyle 24%, Future
20%. These are illustrative choices, not recommended personal financial ratios.
They map existing root expense categories to groups, review any unmapped ones,
choose how the Future allocation is divided between loan commitments and goals,
and save a month snapshot. Saving is a planning action.

During the month the app shows planned income and received income separately,
per-group planned-versus-actual bars, category drilldowns, uncategorized spending,
and an explicit surplus/shortfall. If salary is late, the monthly plan does not
pretend it has arrived. If rent is paid on day one, a generic daily pace line
does not accuse the member of overspending. Any suggestions open reviewable
edits; nothing posts or transfers cash automatically.

Goals include “Laptop by December,” “Emergency fund,” “School fees in September,”
and longer-term “Home deposit.” Each has its own currency, target, milestones,
monthly target, current earmark, currently cash-covered amount, and history.
Moving money between two of the space's wallets is not income, spending, or
automatic goal progress.

## Recommended order and release boundaries

Product horizons below describe delivery order. A goal's own short/long horizon
is separate and can exist in the same release.

| Packet | Deliverable | Depends on | User-visible release |
| --- | --- | --- | --- |
| V0 | Verify existing reporting contracts and reproduce any gaps | Current journal/categories/plan SQL | No new interface; trustworthy base |
| A1 | Allocation revisions, mappings, atomic monthly snapshots | V0 | Database only |
| A2 | Typed allocation gateway and request recovery | A1 | Application boundary only |
| A3 | Setup, monthly percentage editor, plan/actual bars | A2 and current approved shell integration | **Release 1: income allocation and daily comparisons** |
| G1 | Goal revisions, milestones, earmark journal, projections | V0, A1 | Database only |
| G2 | Typed goals gateway and request recovery | G1 | Application boundary only |
| G3 | Goals list/detail/editor, milestones and funding review | G2, A3 | **Release 2: short- and long-term goals** |
| B1 | Recurring drafts and exact settlement associations | A3 | Separate DB → gateway → UI packets |
| B2 | Available-after-commitments and 60-day outlook | B1, G3 | **Release 3: bills and pay-cycle control** |
| C1 | Explicit month copy, then optional signed rollover | A3; rollover needs B1/G1 semantics | Separate reviewed policy change |
| R1 | Broader history discovery/export, human identities, check-ins | Existing foundations | Independent bounded milestones |

V0 is verification first. Source inspection found questions worth testing:
reversal sign handling, root/subcategory rollup, invoker access to revoked plan
tables, and cursors/bounds. No live defect is asserted or fixed in this planning
session. A failing reproducer determines whether a forward fix is needed.

## Defaults needing owner review before their packet is implemented

| Default used in this package | Why | What changes if chosen differently |
| --- | --- | --- |
| Per-space settings; per-currency monthly budgets | Matches existing authorization and money boundaries | Private per-member plans need a separate visibility contract |
| Percentage targets use expected net income; actual-income view is a comparison | Keeps a late paycheck from rewriting the plan | “Only allocate received cash” adds explicit funding batches |
| Split can total 0–100%; remainder stays unallocated | Supports gradual setup | Requiring exactly 100% changes validation, not posting |
| Root expense targets only; children roll up once | Preserves September 10 decision | Child targets need a distinct allocation contract |
| Goal earmarks are planning reservations, with cash coverage shown separately | Avoids changing journal spending permissions | Binding locked cash requires a new posting architecture |
| Short horizon ≤12 months; long >12 months; no date is open-ended | Useful automatic grouping | A manual horizon field affects filtering, not balances |
| No automatic rollover, auto-posting or forced starter categories | Preserves approved defaults | Each requires a named policy decision and rejection tests |
| Any active member can plan in their visible space | Matches monthly-plan commands | Owner-only planning changes command authorization and UI |
| Simple explanatory rules before AI | Deterministic, explainable and testable | AI adds data/privacy/provider decisions and draft review |

## Completion contract for future work

The implementer records exact commit, migration names, approved packet, tests,
and UI evidence in the repository. Database, gateway, interface, deployed state,
and human acceptance remain separate statuses. Source and tests must agree on
each calculation. A smaller model must not guess missing financial semantics,
rename files to evade a scope gate, edit applied migrations, or silently expand
from one packet into the next.

The remaining roadmap register preserves all earlier ideas, including those
that cannot responsibly be implementation-ready without a later product decision.

## Verification of this planning package

The documentation's local links and fenced blocks were checked; all 39 original
roadmap identifiers are represented in the technical register. The proposed
TypeScript apportionment helper was extracted to a temporary directory,
compiled in strict mode, and exercised over 5,005 bounded conservation/rounding
cases plus the published examples, maximum input and invalid inputs. The goal
coverage and surplus/shortfall examples were checked independently.

These checks validate the documents and example arithmetic. No application
feature, database migration, live account, deployment or browser UI was changed
or verified by those checks. SQL examples remain proposed contracts and must
pass real PostgreSQL rejection/concurrency tests in their execution packets.
