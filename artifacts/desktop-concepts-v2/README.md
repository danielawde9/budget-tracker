# Desktop concept gallery

These are revised desktop layouts based on the current React screens and their
features. The visual proposal moves Loans from Manage into Plan, while keeping
the loan data and actions. They are generated design images, not screenshots of
the running app.
Names, dates, amounts, and email addresses are illustrative. No product code was
changed for this set.

The proposed visual direction uses a dark green workspace rail, warm neutral
canvas, white cards, clear amount hierarchy, and dense but readable financial
tables. USD and LBP remain separate. The four main destinations stay Home,
Journal, Plan, and Manage. Plan has six sections, including Loans.

## Entry and main destinations

| Screen | Image |
| --- | --- |
| Sign in | [01-sign-in.png](01-sign-in.png) |
| Create first space | [02-first-space.png](02-first-space.png) |
| Home | [03-home.png](03-home.png) |
| Journal | [04-journal.png](04-journal.png) |
| Plan overview | [05-plan.png](05-plan.png) |
| Manage hub | [10-manage.png](10-manage.png) |

## Plan sections

| Screen | Image |
| --- | --- |
| Allocation | [06-allocation.png](06-allocation.png) |
| Goals | [07-goals.png](07-goals.png) |
| Available cash | [08-available-cash.png](08-available-cash.png) |
| Upcoming bills | [09-upcoming-bills.png](09-upcoming-bills.png) |
| Loans | [13-loans.png](13-loans.png) |

## Manage sections and action overlay

| Screen | Image |
| --- | --- |
| Wallets | [11-wallets.png](11-wallets.png) |
| Categories | [12-categories.png](12-categories.png) |
| Household | [14-household.png](14-household.png) |
| Add from your phone | [15-add-from-phone.png](15-add-from-phone.png) |
| Record overlay | [16-record-overlay.png](16-record-overlay.png) |

## Generation prompt set

The built-in image generator was used in `ui-mockup` mode. The shared prompt was:

> Create a high-fidelity, flat 1440×900 desktop web app concept for a bilingual
> personal and household budget tracker. Use a dark forest green 230px rail with
> Budget ledger, My money, Record, and exactly Home, Journal, Plan, Manage.
> Use a warm off-white canvas, white cards, deep charcoal sans text, emerald
> accent, subtle borders, legible financial figures, and restrained shadows.
> Keep USD and LBP separate. Show practical controls and plausible sample data.
> Place Loans under Plan alongside goals, bills, and cash; keep Manage for
> wallets, categories, household, preferences, and account. Avoid gradients,
> stock imagery, decorative hero sections, extra navigation, and mobile layouts.

Each page prompt then specified the features and sample content from its screen:

- Sign in: email/password, language switch, sign in and create account.
- First space: personal/household choice, space name, and first-wallet step.
- Home: net position, available after commitments, budget vs actual, monthly
  trend, loans, and recent activity.
- Journal: search, date range, type filters, CSV export, and activity register.
- Plan: planned income, left to allocate, category targets, and loan commitments.
- Allocation: month totals and group target/actual/variance rows.
- Goals: active goal progress, target and reserved amounts, and New goal.
- Available cash: commitment arithmetic, outlook chart, and breakdown.
- Upcoming bills: scheduled occurrences, settlement, status, and New schedule.
- Manage: Wallets, Categories, Household, preferences, and account.
- Wallets: derived balances, wallet actions, and transaction history.
- Categories: income and expense roots with one child level and archive actions.
- Loans under Plan: money lent/borrowed, outstanding amounts, repayment actions.
- Household: members, roles, and invitations.
- Add from your phone: `?add=expense` / `?add=income` links and setup steps.
- Record: type selection for Expense, Income, Transfer, Exchange, Lend,
  Borrow, and Repay in a stepped overlay.

Some charts, summaries, and card arrangements are proposals for discussion;
they do not assert that the current app already renders those exact elements.
