# Budget tracker

The current application milestone is the Loans workspace. It reads immutable
loan and wallet ledger data from the dedicated Budget Supabase stack and sends
every loan change through the protected PostgreSQL commands documented in
`docs/financial-command-inventory.md`.

## Run the Loans UI

Use Node 22.22.0 and pnpm 11.17.0, then copy `.env.example` to `.env.local` and
replace the anon-key placeholder with the Budget development value. Do not use
Sandooq or hosted-production credentials.

```bash
pnpm install
pnpm dev
```

The first Loans milestone expects an authenticated Supabase browser session.
If the session has no active membership, the UI keeps financial data hidden and
explains how to recover access. Sign-in and onboarding screens are a later
application milestone.

## Verification

```bash
pnpm check:ui
pnpm test:e2e
set -a
source ./.env.test
set +a
pnpm check
```

`pnpm test:e2e` runs deterministic local HTTP fixtures against the application
and uses installed Google Chrome; it does not access Ubuntu or any Supabase
database. Database tests require the ignored `BUDGET_TEST_DATABASE_URL` from
`.env.test` and target only the dedicated Budget development database described
in `docs/operations/ubuntu-development-stack.md`.

## Current boundaries

- Loan openings, lending, borrowing, repayments, targets, and corrections use
  only the approved protected commands.
- Browser reads remain subject to Supabase authentication and RLS.
- Wallet and loan balances are derived ledger values and are never editable.
- Interest, fees, reminders, installments, forgiveness, imports, sync, and
  cross-currency settlement are not part of this milestone.
