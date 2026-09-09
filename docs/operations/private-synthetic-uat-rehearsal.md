# Private synthetic UAT rehearsal

## Status and safety boundary

This is the smallest offline acceptance harness for the current private release
candidate. It uses fictional names, reserved `.test` email addresses, and
synthetic USD/LBP minor-unit amounts. It does not need or accept a real Budget,
Sandooq, provider, SSH, or production credential.

The Playwright fixture intercepts only `127.0.0.1:55432` Auth and REST/RPC URLs.
It injects a synthetic Supabase-shaped session into browser local storage and
keeps projections in the test worker's memory. The fixture audit endpoint emits
only these facts:

- boundary: `simulated-local-http`
- authentication: `injected-local-storage-session`
- database: `in-memory-fixture-state`
- the set of allowlisted protected mutation names observed
- `payloadsRecorded: false`

Therefore:

- a sign-in or authenticated screen proves the browser's Auth integration path,
  not real Supabase authentication;
- a protected-command receipt proves the typed gateway dispatched that RPC name,
  not that PostgreSQL executed it or RLS authorized it;
- fixture state visible after reload proves browser rehydration from one living
  test fixture, not database, process-restart, device, or backup persistence;
- the production Vite build proves compilation and bundling, not deployment or
  private-device reachability;
- the account warning displays an operator repository reference; the README
  links the runbook. These prove that the readiness guidance is discoverable,
  not that any backup or restore exists.

Do not enter real financial data based on this rehearsal.

## Reproduce offline

Prerequisites are Node `22.22.0`, pnpm `11.17.0`, the committed lockfile, the
pnpm store already populated, and installed Google Chrome. Start from a clean
checkout of the reported release head, with no Supabase or database environment
variables required.

```bash
pnpm install --offline --frozen-lockfile
pnpm test:uat:offline
pnpm check:uat:scope
pnpm check:uat:offline
git diff --check
git status --short
```

`test:uat:offline` is the focused acceptance rehearsal. `check:uat:scope`
fails when the release-start-to-working-tree diff touches Supabase or database
tests, Auth implementation, typed Supabase gateways, Household, Monthly Budget,
or Reporting paths. It includes tracked, staged, and untracked files and first
proves that `HEAD` descends from the fixed release start. `check:uat:offline`
runs that ratchet, ops fixtures and the bounded secret scan, TypeScript, all UI
tests, the production build, and the complete Playwright suite. It
intentionally omits `test:db`: the ignored database environment is absent in
this worktree, and database contact is outside this session's authority.

All Playwright screenshots and traces from an ordinary run remain in ignored
`test-results/`. Set no update flag: committed curated screenshots are not
rewritten by routine verification.

## Covered command surface

The desktop English rehearsal submits all four general wallet event shapes
(opening balance, income, expense, and same-currency transfer), creates a
wallet, records a linked reversal, creates and archives a bilingual category,
records a categorized expense, opens an outstanding loan, records a cash loan,
records a repayment, sets a monthly target, and exercises the dependent-loan
reversal rejection. The fixture receipt must equal this protected mutation set:

```text
archive_category
create_category
create_wallet
open_loan_outstanding
record_cash_loan
record_categorized_financial_event
record_financial_event
record_loan_repayment
reverse_financial_event
set_loan_monthly_target
```

The existing application-shell scenarios separately cover `create_space`,
first-wallet onboarding, ambiguous space recovery, sign-in rejection/retry,
sign-out, and prior-user clearing. The full Playwright suite also covers empty,
validation, definite rejection, ambiguous-result reconciliation, retry,
space-switch clearing, archived-category history, desktop/mobile, and EN/AR RTL
states. The committed acceptance matrix is in
[`artifacts/private-uat/2026-09-09-offline-matrix.md`](../../artifacts/private-uat/2026-09-09-offline-matrix.md).

## Blocked live gates

The following remain Blocked until a separately authorized session supplies
real private infrastructure and evidence:

- Supabase Auth token issuance, refresh/expiry, RLS, and per-user isolation;
- PostgreSQL execution and persistence across service/process restart;
- exact release artifact served over allowlisted private HTTPS on approved
  desktop and mobile devices, including tailnet loss/recovery;
- real encrypted backup, independent off-site receipt, scratch restore, and
  measured RPO/RTO;
- SMTP/account recovery, monitoring/alert delivery, deployment, launch, and
  Daniel's explicit real-data-entry approval.

Ready for private live authenticated UAT: **No**.
