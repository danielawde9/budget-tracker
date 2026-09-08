# Budget tracker

The current application milestone provides a bilingual authenticated shell
with verified Loans and Wallets workspaces. It supports Supabase email/password
sessions, safe first-space and first-wallet onboarding, switching between the
spaces visible through RLS, derived wallet balances, immutable paginated journal
history, the four approved general transaction shapes, and linked corrections.
Every financial change still goes through the protected PostgreSQL commands
documented in `docs/financial-command-inventory.md`.

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
`public.create_wallet`. The database now provides six protected Household
mutations and two bounded owner reads for invitation and membership
administration. No Household browser gateway, UI, or email delivery exists yet,
so invitations and member management remain unavailable in the application.

Loans and Wallets are active in the application navigation. Reports remains a
non-interactive preview of a later milestone.

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
- Wallet creation, general postings, and eligible general corrections use only
  `public.create_wallet`, `public.record_financial_event`, and
  `public.reverse_financial_event`.
- Browser reads remain subject to Supabase authentication and RLS.
- Space and wallet onboarding use only their protected creation commands and
  reconcile visible records after ambiguous transport failures before another
  submission is offered.
- Wallet and loan balances are derived ledger values and are never editable.
- Household database administration is limited to its six protected mutations
  and two bounded owner reads; its browser gateway, UI, and email delivery are
  not implemented.
- Categories, budgeting, reporting, recurring transactions, interest, fees,
  reminders, installments, forgiveness, imports/offline sync, cross-currency
  settlement, live UAT, deployment, and launch are not part of this milestone.
