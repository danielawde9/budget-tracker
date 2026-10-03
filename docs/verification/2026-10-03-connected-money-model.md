# Connected money model (v2): verification, 2026-10-03

Branch `redesign/connected-plan`. Everything below ran in this session on this
Mac (Node 22/26, pnpm 11.17, Docker Desktop). Nothing ran against a hosted
project.

| Check | Result | What it covers |
| --- | --- | --- |
| `pnpm typecheck` | pass | TypeScript strict across app, tests and preview scripts |
| `pnpm test:db` | **165/165** in 12 files | See "Database suites" below. |
| `pnpm test:ui` | **80/80** in 14 files | See "UI suites" below. |
| `pnpm build` | pass, **0 warnings** | Vendor chunks split; largest chunk 339 kB. Demo code and credentials are absent from `dist/`. |
| `pnpm test:e2e` | **3/3** | See "End-to-end flows" below. |
| `pnpm preview:up` | pass | See "Local preview" below. |

Database suites (real Postgres 17.6, Supabase image, Testcontainers):

- invariant triggers biting;
- RLS and grant layers;
- every command's two-sided lines;
- plan split and funding;
- reads;
- the ten demonstrations to the cent;
- a 2,400-command randomized conservation test;
- a TS/SQL plan-math parity check over 2,000 plans;
- zod contracts parsed against real output.

UI suites (jsdom):

- money and plan math;
- i18n completeness in EN and AR;
- the API error mapping (PostgREST plain objects);
- Home, the expense cover, Fund my plan and plan editor behavior;
- the double-submit guard, mutation-checked.

End-to-end flows (real Chrome, local Supabase with real Auth, PostgREST and Kong):

- onboarding from zero → income → Fund my plan → an overspend into over-assigned → take back → reassign savings;
- the story user paying a bill, updating an investment value, repaying a loan and reading last month;
- Arabic RTL at 390px with no horizontal scroll.

Local preview: migrations applied on a real local Supabase stack, and the story was seeded through the public API.

## Guarantees and the test that proves each

| Guarantee from the brief | Proof |
| --- | --- |
| Each currency's cash held equals ready to assign plus set aside | `conservation.property.test.ts`: after every command. `reads.test.ts` checks the same through the read path. The real API returned 871260 = 739260 + 132000. |
| The same money cannot fund two purposes | `core-constraints.test.ts` refuses an unbalanced entry and a negative item at commit. `commands.test.ts` refuses moving or funding more than is held. |
| Transfers never create income or expenses | Property test: transfers, moves and exchanges leave the income and spending totals unchanged. |
| Reservations are not deducted twice | Property test: a bill paid from its item lowers the item once and leaves Ready to assign alone. The insurance demonstration shows the same. |
| Existing balances are not reported as new contributions | Opening flows stay out of funding (property test). Holiday: opening 800 / funded 400 (demonstrations). |
| Exact money and rounding | bigint minor units end to end. The split's largest remainder is identical in SQL and TS on 2,000 plans. $205.50 stays exact. |
| Currencies are never added together | LBP keeps its own pile and wallets. The UI test checks that LBP never appears in USD figures. A cross-currency transfer is refused. |
| Atomic, idempotent, serialized writes | One transaction per command and a space row lock. Request-id replay and conflict tests. Six concurrent duplicates make one entry. |
| Isolation | Browser roles cannot read `budget.*`. With a leaked grant, RLS still returns 0 rows. Non-members get 42501. anon cannot execute commands. |
| Readable corrections | Reversals mirror the original exactly. Reversing a used fund is refused. Record-then-reverse restores every balance (property test). |

## Not verified

- **Production:** nothing was applied to or deployed on the hosted project, and
  production cutover/reset was not attempted.
- **Browsers:** only installed Google Chrome was exercised. Safari and Firefox
  were not run, and `<dialog closedby>` is a progressive enhancement there.
- **Arabic copy:** written in this session; no native reviewer has checked it.
- **Load:** performance at large data volumes was not measured. The reads sum
  journal lines on demand, which is indexed and sized for a household.
- **Onboarding resume:** if the browser reloads mid-onboarding after the space
  exists, the remaining steps are not resumed. Home then shows "Add a wallet",
  and the plan can be edited from Plan.

## Independent review and fix pass

A fresh reviewer read the whole branch, reproduced findings on a scratch
Supabase Postgres, and gave the verdict "yes with fixes". One critical and four
important findings were fixed, each with a test that failed first:

1. A bill first due after the queried range broke Home.
2. LBP sitting in Ready to assign could not be assigned in the UI.
3. The space clock was read once per session.
4. Back-dated entries and reversals could make past statements negative.
5. Investing or lending from an item silently covered the shortfall.

The suites above are the post-fix runs, including the minor findings below,
which were fixed afterwards at the owner's request.

## Rulings made during execution

Each ruling states what was decided, why, and its cost if wrong. Owner decisions are recorded in `docs/decisions.md`.

- test DBs clone a template built from template0 + auth shim (auth.users id/email, auth.uid() reading request.jwt.claim.sub or request.jwt.claims) — Supabase image's postgres DB has pg_net/pg_cron workers attached so it cannot be a template — cost if wrong: auth.users column drift only; real auth exercised in e2e
- RPC privilege tests (anon execute, cross-space) move to Task 3 where the first RPCs exist — Task 2 has no public functions yet — cost if wrong: none
- split_by_bps planned share = floor(total × Σbps / 10000); the rounding cent of an under-100% plan stays 'not planned' (test expectation 51/40 corrected to 50/40) — cost if wrong: one cent shown as not planned
- invariant trigger functions are SECURITY DEFINER — deferred checks fire at COMMIT under the caller role (authenticated), which has no schema usage — cost if wrong: none (definer functions only read budget tables and raise)
- defaulted params moved after required ones (record_exchange p_item after p_on; save_bill p_bill/p_archived last) — Postgres requires defaults last; clients use named args — cost if wrong: none
- create_space seeds LBP reference rate 89,500 effective 2024-02-15 (BdL official rate) — display only — cost if wrong: one editable row
- plan SQL lives in its own migration 20261003120250_budget_plan.sql instead of being appended to commands/helpers — one responsibility per file; nothing applied anywhere yet — cost if wrong: none
- plan_month item rows expose balances as {USD, LBP} map instead of lbpAvailable — no hard-coded plan currency — cost if wrong: none
- added public.clock_today(timezone) (authenticated only) so the story/onboarding read the server clock without creating a probe space — cost if wrong: one extra read RPC
- Task 12's local stack (config, up.sh, seed, demo accounts) is built before the UI tasks so each screen is verified against real seeded data — cost if wrong: none (same deliverable, earlier)
- PlanEditorForm extracted from PlanEditorDialog so onboarding step 2 embeds the same editor — one plan editor — cost if wrong: none
- shell/auth/onboarding (T8), Home+Accounts (T9), Plan (T10), record/bills/activity/settings (T11) landed as one UI commit — they share the record dialog host, workspace context and dictionary, so separate commits would not each build — cost if wrong: coarser history only
- hash routes are #/home #/plan[/YYYY-MM] #/activity #/accounts #/settings; Bills live in Plan (section) + Home (upcoming), not a separate destination — cost if wrong: one nav item
- double-submit guard proven by mutation (removing inFlight check → test fails 2≠1) — the button's disabled state alone does not cover a same-batch double submit
- label-wrapped <select> folded the selected option into its accessible name — fixed at source with SelectField (for/id), not by loosening test selectors — cost if wrong: none
- fixes edit the v2 migration files in place — they have only ever been applied to disposable databases (Testcontainers, the local preview which up.sh resets); forward-only applies once a shared/prod DB has them — cost if wrong: none today

## Minor findings from the final review: fixed

Each one has a test that failed first. The database fixes are in
`tests/db/minor-fixes.test.ts`. The screen fixes are in
`src/screens/minor-fixes.test.tsx` and `src/ui/async.test.tsx`.

| Finding | Fix |
| --- | --- |
| Unpaid occurrences older than 92 days dropped out of lists and alerts | Look back 366 days. A bill unpaid for a year is still overdue. |
| `create_space` replay ignored the payload and two identical concurrent calls could raise 23505 | `insert … on conflict do nothing`. A replay with the same name returns the space; a different name is `BUDGET_REQUEST_CONFLICT`. |
| Months before the first plan showed no groups; past months showed today's Ready to assign | The earliest plan's structure is shown with 0 planned. Past months show "Ready to assign at month end". |
| `skip_bill` could not be undone | Skips are an append-only event log. `unskip_bill` and an Undo skip button in Bills. |
| No message for `BUDGET_WALLET_BOUNDS`; Activity "Show more" swallowed errors; the investment form found its item by the English group name | Messages added (EN/AR). The error is shown under the list. The default is the item tied to the account, else the last group's flexible item. |
| A stale client could save a plan's first version at a new month | Revisions count up per space, never per month. |
| No check that every public function is closed to `anon` on the real stack | The test database now has Supabase's default privileges, and a ratchet fails on any public function `anon` can run. |

Found while fixing these:

- `useLoad` returned a new object on every render. Activity's "reset to the
  first page" effect therefore ran after every render, so a second page
  vanished as soon as it loaded. `useLoad` now returns one object per state,
  and `src/ui/async.test.tsx` pins this.
- The "server could not be reached" message said "Nothing was saved". After a
  timeout that can be false. It now says to retry from the same form, which
  keeps its request id, so the retry cannot record the entry twice.

## Added after the review: expense suggestions

The `expense_suggestions` read and the Description field are covered by
`tests/db/expense-suggestions.test.ts` (5 tests) and
`src/record/expense-suggestions.test.tsx` (6 tests). The fresh-account
end-to-end flow records "Supermarket", then checks that typing it again
brings back the item and amount, with the only wallet shown as text. One
mutation check removed the "keep what you set" guard, and the test failed as
it should.

