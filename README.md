# Budget Tracker (v2: connected money model)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A bilingual (English/Arabic, right-to-left) personal budget built on
Postgres/Supabase and React. Every dollar has exactly one job. One append-only
journal records where money is (wallets) and what it is for (plan items) in the
same entry, so the cash you hold always equals the money set aside plus the
money ready to assign. The database enforces this; nothing on screen keeps its
own balance.

> This branch replaces the v1 app. `main` and production still run v1. Adopting
> v2 in production means resetting the hosted database; see `docs/decisions.md`.

## Concepts

| Word | Meaning |
| --- | --- |
| **Wallet** | Where spendable money is: a bank account, cash or a card (a card may go negative). |
| **Investment account / Loan** | Tracked outside spendable cash; counts in net worth only. |
| **Plan group** | A share of expected income (Essentials 60%, Guilt free 5%, …). |
| **Plan item** | One purpose inside a group: monthly spending, a reserve, a goal, a loan payment, or the group's flexible item (which gets what the items leave). |
| **Ready to assign** | Money you hold that has no job yet. |
| **Fund / Move** | Give ready money a job, or change a job. Funding and moving are never income or spending. |

The rules, with worked examples recomputed in cents, are in
[the design spec](docs/superpowers/specs/2026-10-03-connected-money-model-design.md).
The schema and calculation rules are in
[the plan](docs/superpowers/plans/2026-10-03-connected-money-model.md).

## Run the local preview

Requires Docker, the Supabase CLI, Node 22 and pnpm 11.

```bash
pnpm install
pnpm preview:up
pnpm demo
```

Then open http://127.0.0.1:5173 and pick a demo account. Everything runs on
this computer; see [the local preview runbook](docs/operations/local-preview.md).

## Verify

```bash
pnpm typecheck
pnpm test:db
pnpm test:ui
pnpm build
pnpm test:e2e
```

- `pnpm test:db` starts its own Postgres 17.6 (Supabase image) with Testcontainers.
- `pnpm test:e2e` needs the local preview stack.

## Where things live

- `supabase/migrations/`: the schema, invariant triggers, commands, plan and
  reads. All writes go through `SECURITY DEFINER` functions. The tables are not
  reachable from the browser.
- `src/api/`: the typed client. Every read is validated with zod, and money is
  `bigint` minor units end to end.
- `src/screens/`, `src/record/`, `src/ui/`: the screens, the record dialog and
  shared UI. All of it follows `docs/design-guidelines.md`.
- `scripts/preview/`: the local stack, the seed, and the ten demonstrations as
  one shared script.
