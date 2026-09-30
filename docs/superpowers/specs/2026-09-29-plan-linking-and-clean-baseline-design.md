# Plan linking, default plan in onboarding, and a clean migration baseline

Date: 2026-09-29 · Status: draft for review · Path: architectural

## Why

A new user reaches an empty Plan. Groups, categories, goals and loans are separate things that the
person must wire together by hand (Purpose radios, "Link debt payments to", per-goal group selects,
a four-step allocation wizard). Most people never finish it, so the Categories step shows "No active
expense categories yet" and spending lands in Unmapped. The product moves to one rule: **every planned
or spent amount belongs to exactly one group, and the group is set by something the person already
picks (a category, a goal, or a loan). Nobody picks a group while entering an expense.**

The production Supabase project was deleted and a new empty one exists, so this is also the moment to
replace 61 layered migrations (with superseded v1/v2/v3 functions) by one clean baseline.

## Intent (what the person said, and what is assumed)

Said: force the default plan in onboarding (editable); link goals and debt to allocation groups;
remove screens and questions that do nothing; the allocation screens look inconsistent; start the new
database clean.

Assumed (logged in `docs/decisions.md`): the default groups and percentages, the default loan group,
and that existing users are offered the plan rather than migrated silently.

## Part A. Linking model

| Link | Today | After |
| --- | --- | --- |
| Category → group | Hidden template mapping, root categories only, chosen in a wizard step | Stored default group on the category; creating a category asks "which group?" |
| Goal → group | Chosen per month in the editor | Goal remembers a default Future group; the month editor only overrides |
| Loan payments → group | "Link debt payments to" dropdown | One default Future group, no dropdown |
| Bill / expense → group | Indirect via category, invisible | Same path, shown as a chip |
| Planned income | Typed by hand | Prefilled from income schedules, still editable |
| Payday, timezone | In the database, no UI | Asked in onboarding |

Rules kept from today and now enforced as constraints with rejection tests: a Spending group holds
categories; a Future group holds goals and loan payments; group percentages total 100.

Default plan created at onboarding (editable): Essentials 60 (Rent, Bills, Groceries, Transport),
Guilt free 5 (Eating out, Fun, Shopping), Short-term goals 15, Saving 10, Investment 10. Seeding is one
idempotent server function, not client-side inserts. Names are stored as separate `name_en` / `name_ar`.

## Part B. UI

- Onboarding step 3 becomes "Your plan": income, payday, then the default groups with categories.
  Accept or edit, with no separate wizard.
- Allocation editor: the Mode, Groups, Categories, Review wizard is replaced by one screen. Purpose is
  set by the system and moved under an Advanced control. Group rows share one height.
- Unmapped shows only when non-empty, with a "Fix" action. Uncategorized shows only when non-empty.
- Existing users get a one-time "Set up your plan" card: it creates the defaults, suggests a group per
  existing category, and changes nothing until they accept.
- All new styles extend the shared `cr-*` set and are recorded in `docs/design-guidelines.md`.
  Every screen is checked in LTR and RTL.

## Part C. Clean baseline

1. Build a database from the 61 current migrations.
2. Export its final schema as one baseline migration; drop superseded functions (v1/v2/v3) that the
   gateways no longer call.
3. Prove equivalence: a test builds an empty database from the baseline and diffs its schema against the
   one built from the old history.
4. Part A lands as new migrations on top of the baseline. The new project only ever receives baseline
   plus these.
5. Migrations are applied to the new project by the person, using the existing live-migration command.
   This work never applies migrations itself.

The old migration files are removed from the tree only after step 3 passes. Git history keeps them.

## Open questions for the plan phase (need code reading, not client input)

- Allocation groups are per currency; categories are not. Where does a category's default group live so
  it resolves per currency without duplicating rows?
- Are allocation group names bilingual today? If not, the defaults need an Arabic column or a name key.
- Which of `publishMonth` / `publishMonthV2` and the v1/v2/v3 budget functions still have live callers.
- Whether an existing published month must be re-snapshotted when a category's default group changes.

## Testing

- Real Postgres (Testcontainers). Rejection tests: a category cannot map to a Future group; percentages
  over 100 are refused; seeding twice creates nothing new; a goal and a loan resolve to a Future group.
- Baseline equivalence test (Part C step 3).
- Playwright: onboarding creates the plan; adding a category asks for a group; Unmapped is empty in the
  happy path; both directions.
- `pnpm test:e2e` runs as a regression check before anything is called done.

## Out of scope (separate pieces)

Merging Plan into Home; the household invite error; bill reminders, goal home wallet, exchange rates,
receipts and tags; the duplicate entry screens and orphaned Reports page cleanup. The Supabase env
switch is done by the person.
