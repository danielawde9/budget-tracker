# Connected money model (v2): verification, 2026-10-03

Branch `redesign/connected-plan`. Everything below ran in this session on this
Mac (Node 22/26, pnpm 11.17, Docker Desktop). Nothing ran against a hosted
project.

| Check | Result | What it covers |
| --- | --- | --- |
| `pnpm typecheck` | pass | TypeScript strict across app, tests and preview scripts |
| `pnpm test:db` | **152/152** in 10 files | See "Database suites" below. |
| `pnpm test:ui` | **64/64** in 11 files | See "UI suites" below. |
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

The suites above are the post-fix runs. Deferred minor findings are listed in
the final report.
