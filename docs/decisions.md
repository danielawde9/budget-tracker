# Decisions ledger

Append-only project decisions and assumptions. Each entry records what would
change if the decision changes.

## 2026-09-07 — Isolated remote development database

**Decision:** Budget will use its own Supabase development stack on the Le
Labo Ubuntu host, reachable only through Tailscale. The React app remains on
the Mac. Hosted Supabase provisioning is deferred until launch approval.

**Why:** Isolation prevents Budget development from reading, changing, or
depending on the existing Sandooq development backend.

**If changed:** A shared or hosted backend would require a new data-isolation,
backup, endpoint, and operational review before any migration is applied.

## 2026-09-07 — Financial journal foundation

**Decision:** Store money as immutable typed events with signed wallet
movements; derive wallet balances rather than editing totals.

**Why:** It preserves a traceable history and makes reversals, idempotency, and
rejection tests enforceable at the database boundary.

**If changed:** A mutable-balance model would need a new audit and correction
design; a full accounting chart would expand the API, schema, and user-facing
concepts.

## 2026-09-07 — Foundation toolchain versions

**Decision:** Pin Node 22.22.0 and pnpm 11.17.0. The database test harness uses
TypeScript 7.0.2, Vitest 5.0.0, node-postgres 8.23.0, @types/node 26.4.1, and
@types/pg 8.23.1. Their recorded licenses are Apache-2.0 or MIT.

**Why:** The database foundation needs reproducible real-Postgres tests without
introducing a browser or application framework before the data boundary exists.

**If changed:** Upgrading a pinned dependency requires its own compatibility and
license review; replacing the test driver changes the integration-test boundary.

## 2026-09-07 — Budget remote host and opt-in lifecycle

**Decision:** Budget's dedicated remote directory is
`/home/daniel/budget-supabase` on `daniel@100.124.228.75`. Its Supabase ports
are allocated in the 54420–54429 range, separate from Sandooq's 54321–54324.
Budget containers must retain Docker restart policy `no` and therefore stay
stopped after a host reboot until explicitly started.

**Why:** The original Ubuntu endpoint was offline. The available replacement
host already runs Sandooq with restart policy `no`; leaving Budget opt-in avoids
unnecessary RAM use and preserves host-service boundaries.

**If changed:** Moving the host or enabling automatic restart requires a new
capacity, port-collision, network-access, and recovery review.

## 2026-09-07 — Explicitly enforce no restart policy

**Decision:** After every Budget `supabase start`, the lifecycle script runs
`docker update --restart=no` for Budget containers. A `disable-restart` command
applies the same requirement to a running stack.

**Why:** The installed Supabase CLI created most containers with
`unless-stopped`, contrary to the opt-in RAM-use requirement. The host firewall
was independently verified to admit Docker traffic over Tailscale and deny it
from the LAN interface.

**If changed:** Removing this enforcement would cause Budget to start after a
host reboot; any firewall change requires another ingress verification before
Budget is started.

## 2026-09-07 — Journal functions use a fixed extension-aware search path

**Decision:** Financial command functions use a fixed `pg_catalog, extensions`
search path and fully qualify application schemas.

**Why:** The first journal test proved that an empty search path prevents the
`pgcrypto` digest lookup. Adding only the trusted extension schema preserves the
search-path defense while allowing request fingerprints.

**If changed:** Any newly referenced function must be schema-qualified or live
in an explicitly reviewed trusted schema; broadening to a mutable application
schema would reintroduce function-shadowing risk.

## 2026-09-07 — Whole-app financial posting boundary

**Decision:** Daniel confirmed that the shared financial journal must be the
mandatory control point for every actual money or obligation change throughout
Budget, including both loan directions and all related financial features.
Feature-specific protected commands post linked effects atomically; balances
and report actuals are derived from the journal. Planning targets and drafts
remain separate from posted money. New financial features must prove their
coverage and rejection behavior before being described as fully tracked.

**Why:** A single enforced posting boundary prevents wallet balances, loan
balances, and reports from maintaining conflicting versions of the same money.
The current foundation source alone does not establish whole-app coverage.

**If changed:** Allowing an independent financial write path requires a new
consistency, reconciliation, authorization, and audit design across every
affected feature.

## 2026-09-07 — Loans and monthly repayment planning deferred

**Decision:** Include both "they owe me" and "I owe them" in a later Loans
milestone, with partial/full repayments, outstanding balances, history, optional
due dates, and optional monthly targets for money I owe. Principal movements
remain separate from earned income and ordinary spending. Targets reserve
planned allocation only; actual repayment posts once through the journal.

**Documented defaults:** Start with same-currency settlement, an explicit
opening outstanding balance for pre-existing loans, no automatic carry-forward
of missed monthly targets, and separate per-currency totals. Interest, fees,
reminders, installment schedules, forgiveness, and cross-currency settlement
remain later extensions. See the
[approved direction and acceptance requirements](superpowers/specs/2026-09-07-loans-and-ledger-coverage-design.md).

**Why:** Daniel approved both loan directions and monthly repayment planning
while accepting delivery after the database foundation. These defaults preserve
cash history and avoid treating planned repayments as money already paid.

**If changed:** Carry-forward would change monthly allocation calculations;
interest or installments would need explicit charge/schedule rules;
cross-currency settlement would need linked exchange postings. Importing full
pre-app loan history would need a separate cutover and deduplication design.

## 2026-09-07 — Loan principal is an immutable linked subledger

**Decision:** Every loan action creates a financial event and one immutable
loan-principal posting. Cash lending, borrowing, and repayment add exactly one
linked wallet movement in the loan currency; opening obligations add no wallet
movement. Outstanding principal is the sum of loan postings, not a mutable
loan total.

**Why:** One event identifier makes wallet and obligation effects atomic,
reversible together, and reconstructable. It also lets the database reject an
overpayment while serializing concurrent repayments of one loan.

**If changed:** Supporting interest, fees, forgiveness, multi-loan settlement,
or cross-currency payments requires explicit additional posting types and
reconciliation tests; it cannot edit a principal total.

## 2026-09-07 — Monthly targets retain planning history without posting money

**Decision:** Monthly repayment target changes append a target revision. A
target of zero clears the current target through another revision; no target
revision creates a financial event, wallet movement, or loan posting. The
monthly projection caps remaining reservation at zero and uses the net
repayment effect from journal history.

**Why:** This preserves a attributable planning history while keeping planned
allocation distinct from cash and principal. It prevents an actual payment
from being counted both as a payment and as an untouched reservation.

**If changed:** Automatic carry-forward, schedule allocation, or a mutable
target row would need new historical and reconciliation rules.

## 2026-09-07 — Financial boundary inventory is a test-enforced contract

**Decision:** The active actual-money and principal writers are
`record_financial_event`, `reverse_financial_event`,
`open_loan_outstanding`, `record_cash_loan`, and
`record_loan_repayment`. The integration gate discovers public functions that
write journal tables, requires every one to appear in the inventory, and
checks that authenticated roles have no direct financial/history writes.

**Why:** A written command list alone would drift; the database catalog check
detects an unclassified future writer or a privilege bypass.

**If changed:** A new financial feature must add its protected command,
inventory classification, privileges/RLS proof, and real-Postgres rejection
and reconstruction coverage in the same change.
