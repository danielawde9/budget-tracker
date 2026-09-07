# Budget tracker

The current application milestone provides a bilingual authenticated shell
around the verified Loans workspace. It supports Supabase email/password
sessions, safe first-space and first-wallet onboarding, and switching between
the spaces visible through RLS. The Loans workspace still sends every financial
change through the protected PostgreSQL commands documented in
`docs/financial-command-inventory.md`.

## Run the application

Use Node 22.22.0 and pnpm 11.17.0, then copy `.env.example` to `.env.local` and
replace the anon-key placeholder with the Budget development value. Do not use
Sandooq or hosted-production credentials.

```bash
pnpm install
pnpm dev
```

The application starts with a sign-in/sign-up screen. An authenticated user
with no visible space is guided through creating a personal or household space
with `public.create_space`, then its first USD or LBP wallet with
`public.create_wallet`. Household invitations and member management are not
available because no approved protected command exists for them yet.

Only Loans is active in the application navigation. Wallet and report labels
are non-interactive previews of later milestones.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:ui
set -a
source ./.env.test
set +a
pnpm test:db
pnpm build
pnpm test:e2e
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
- Space and wallet onboarding use only their protected creation commands and
  reconcile visible records after ambiguous transport failures before another
  submission is offered.
- Wallet and loan balances are derived ledger values and are never editable.
- Household invitations, general wallet/transaction screens, budgeting,
  reporting, interest, fees, reminders, installments, forgiveness, imports,
  sync, and cross-currency settlement are not part of this milestone.
