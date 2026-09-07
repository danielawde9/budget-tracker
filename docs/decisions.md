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

## 2026-09-07 — Background roles share the financial posting boundary

**Decision:** Supabase's `service_role`, like browser roles, has no direct
INSERT, UPDATE, DELETE, or TRUNCATE privilege on wallets or financial,
loan-principal, and planning-history tables. A future background entry path
must use a classified protected command rather than bypassing the journal.

**Why:** The independent Loans audit found that Supabase's default
`service_role` table grants bypassed the documented whole-app boundary even
though no background caller exists yet.

**If changed:** Any direct background writer requires a new authorization,
idempotency, reconciliation, and immutable-history design plus explicit
real-Postgres coverage; granting a table privilege alone is not sufficient.

## 2026-09-07 — Loans UI is a command-backed ledger workspace

**Decision:** Build the first application surface as a React/Vite SPA with one
typed Loans gateway. The browser may read existing RLS-protected ledger rows and
the two monthly projections, while loan mutations are allowlisted to the five
approved loan commands. The visual system uses ledger-like rows, restrained
paper/ink/jade/saffron/brick tokens, tabular figures, large intentional dialogs,
and mirrored logical layouts for English and Arabic. Automated component tests
use an injected in-memory gateway; production startup never selects fixture
data.

**Why:** The repository has no application layer to preserve, so a small SPA
keeps Supabase integration explicit and independently testable. A ledger-shaped
interface helps a non-technical manager distinguish actual money, obligations,
due amounts, and monthly reservations without editable balance controls or a
generic grid of metric cards.

**If changed:** Adopting another application framework must preserve the same
gateway allowlist, RLS read boundary, request-ID behavior, bilingual accessibility,
and visual evidence. A different visual language may change components and CSS,
but it must keep currencies and planned-versus-actual values visibly separate.

## 2026-09-07 — Loans UI dependencies are pinned and fixture-free at runtime

**Decision:** Pin React/React DOM 19.2.8, Supabase JS 2.116.0, Vite 7.1.7,
the Vite React plugin 5.0.4, Playwright 1.55.1, jsdom 30.0.1, and the recorded
Testing Library packages. The installed package metadata identifies Playwright
as Apache-2.0 and the other named runtime/test tools as MIT. Browser fixtures
exist only in component and Playwright test files; the production entry point
requires Supabase environment values and never selects fixture data.

**Why:** Exact versions and local fixtures make handoff verification
reproducible without giving a development-only sample ledger a path into the
runtime application. Using the existing Supabase client preserves its browser
session and RLS boundary while the Loans gateway keeps financial commands
allowlisted.

**If changed:** Dependency upgrades require compatibility, license, typecheck,
component, build, and rendered-flow verification. Adding a runtime demo mode
would require a new data-isolation decision and must be impossible to enable in
a real financial environment.

## 2026-09-08 — Authentication state excludes reusable credentials

**Decision:** The application authentication boundary stores and distributes only
the current user's ID and optional email address. Supabase remains the sole owner
of browser session persistence and refresh behavior; application state, errors,
tests, and logs never copy reusable session credentials or raw auth responses.

**Why:** The shell needs identity and lifecycle events, not reusable credentials.
A narrow gateway makes accidental rendering, logging, or cross-user retention of
sensitive session material substantially harder.

**If changed:** Any feature that requires a reusable credential outside the
Supabase client needs a separate threat model, storage/lifetime decision, and
tests proving the credential cannot reach rendering, logs, screenshots, or
another user's application state.

## 2026-09-08 — Auth content is gated until session resolution

**Decision:** The application renders no financial workspace until the initial
browser session resolves. Auth changes are authoritative over older in-flight
session reads; an unexpected loss of a previously authenticated session shows
an expired-session recovery state, while an explicit sign-out returns directly
to the signed-out state.

**Why:** This prevents a flash of private financial content and prevents a late
session read from restoring the wrong user after a refresh, sign-out, or account
change. Separating expiry from explicit sign-out gives the manager a useful next
step without implying the application lost data.

**If changed:** Optimistic financial rendering or a different event priority
needs race tests proving that stale reads and prior-user content can never become
visible. Merging expiry into generic sign-out would simplify copy but remove the
specific recovery explanation.

## 2026-09-08 — Onboarding has a separate two-command gateway

**Decision:** Initial setup uses a dedicated workspace gateway with bounded RLS
reads and exactly two mutations: `public.create_space` and
`public.create_wallet`. It does not extend the Loans gateway, classify these RPCs
as financial posting commands, or introduce a membership/invitation write path.

**Why:** Space ownership and the first wallet are prerequisites for the Loans
workspace but are not ledger postings. Keeping their allowlist separate preserves
the audited Loans command boundary and makes the missing household-membership
command visible instead of encouraging a direct table write.

**If changed:** Adding invitations, member management, or another onboarding
mutation requires a reviewed protected database command with authorization,
rejection, and RLS tests before any UI can call it.
