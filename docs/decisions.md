# Decisions ledger

Append-only project decisions and assumptions. Each entry records what would
change if the decision changes.

## 2026-09-12 — Authenticated navigation is task-oriented and fully replaced

**Decision:** Replace the current authenticated navigation presentation with a task-oriented structure: Daily money (Overview, Wallets), Review (Loans, Reports), and Setup (Categories plus Household only in household spaces). Use a persistent labelled desktop rail and a labelled modal mobile drawer; do not use an icon-only rail or horizontally scrolling mobile primary navigation. The existing internal destinations, callbacks, feature pages, and conditional Household fallback remain unchanged.

**Why:** Grouping actual destinations by user purpose makes the financial workspace easier to scan without adding routes or weakening the protected financial boundary. Full labels avoid icon ambiguity, especially in bilingual and RTL use.

**If changed:** Adding destinations, URL routing, user-customized navigation, a global transaction action, or a different household fallback requires a separate product, accessibility, state-transition, and financial-flow design.

## 2026-09-12 — Event notes and reusable payees are immutable metadata

**Decision:** Notes and one optional reusable payee attach to an existing financial event through immutable association tables. Existing protected financial posting signatures remain unchanged. A narrow, idempotent metadata command canonicalizes payee names per space, creates a payee only when needed, and refuses to overwrite an event's description. The Wallets flow posts money first, then persists the description using its own retry-safe request receipt.

**Why:** Descriptive text must not weaken the verified journal posting boundary or make wallet balances mutable. Keeping metadata beside the event preserves future search/export/repeat-entry value while maintaining a clear audit trail.

**If changed:** Editable notes, multiple payees, deletion/merging, attachments, or automatic payee-to-category rules require new history, authorization, concurrency, and search/export behavior; the latter remains a separate milestone.

## 2026-09-12 — USD-to-LBP cash exchange is a dedicated linked ledger event

**Decision:** A USD-to-LBP exchange posts only through
`public.record_usd_to_lbp_exchange`. The command accepts positive exact minor-unit
amounts, validates active USD source and LBP destination wallets in one space,
and appends a single immutable `exchange` event with two linked movements: USD
out and LBP in. It never represents either leg as income, expense, or a generic
same-currency transfer.

**Why:** The currencies use different minor units and therefore cannot satisfy
the generic transfer's same-currency, zero-sum invariant. Keeping both quoted
amounts in one event preserves atomic reconstruction without inventing earned
income, spending, or an editable exchange-rate balance.

**If changed:** Supporting LBP-to-USD, another currency pair, fees, a rate
source, or an application UI requires a separate command/API and its own
authorization, idempotency, movement-shape, reversal, and user-flow tests.

## 2026-09-08 — Household authorization is a protected stateful database lifecycle

**Decision:** Household invitations store only versioned keyed recipient digests
and raw-token digests; current membership state remains on the existing
membership row, and every accepted mutation appends a non-PII immutable event
that also serves as its actor-scoped idempotency receipt. Six narrow mutation
commands and two bounded owner reads are the only application-facing household
administration surface. Revoked and left memberships remain as inactive history,
while deferred database invariants preserve one active owner per household and
exactly one active owner membership in every personal space.

**Why:** Keeping cancellation, one-time acceptance, replay, last-owner checks,
and RLS authorization in one PostgreSQL transaction prevents browser writes,
personal-space crossover, reusable secrets at rest, and partial membership/audit
state. A dedicated non-login command owner and layered grants, RLS, constraints,
and immutable triggers keep accidental privilege changes fail-closed.

**If changed:** Stateless/provider-owned invitations, owner invitations, member
identity projection, configurable expiry, hard deletion, or another role require
new token, privacy, capability, retention, concurrency, migration, and rejection
designs. Email delivery and UI remain separate milestones and cannot compensate
for a weakened database invariant.

## 2026-09-08 — Move the Budget development stack to Le Labo Ubuntu

**Decision:** Move the isolated Budget Supabase development stack to
`/home/lelabo/budget-supabase` on `lelabo@100.76.160.91`. Preserve the existing
54420–54429 Budget port allocation, permit it only through persistent
tailnet-only Docker ingress rules, and leave every Sandooq container, directory,
port, and lifecycle command unchanged. The Mac repository remains authoritative.

**Why:** Daniel selected the reachable Le Labo Ubuntu host after the previous
Budget host stopped responding. Reusing the established Budget port range keeps
the new stack separate from Sandooq's 54321–54324 range and the POS lane's
54331–54334 range.

**If changed:** Another host or port range requires renewed collision, ingress,
capacity, endpoint, and database-identity verification before any stack starts.

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

## 2026-09-08 — Space selection is visible-set and user scoped

**Decision:** The selected space is stored under the authenticated user ID and
restored only after a fresh RLS-visible space read confirms it is still
available. Switching or losing a space clears the current Loans projection
before another request begins, and request sequencing prevents late responses
from restoring data for an older space.

**Why:** A remembered UUID is not authorization. Revalidating it against the
current visible set and blanking the previous projection prevent stale household
or prior-user data from remaining on screen during navigation and membership
changes.

**If changed:** Global or URL-based selection must retain the same fresh
visibility check, per-user separation, synchronous data clearing, and stale-read
rejection before it can replace local per-user selection.

## 2026-09-08 — Ambiguous onboarding mutations reconcile before retry

**Decision:** `create_space` and `create_wallet` each receive one submission.
When the client cannot tell whether that request reached PostgreSQL, the
application completes a fresh RLS-visible space or wallet read and matches the
safe entered name/type or name/currency before it offers another deliberate
submission. A discovered record advances setup without sending the mutation
again.

**Why:** These foundation commands do not accept request IDs. Blind transport
retries can therefore create duplicate spaces or wallets even when the first
request succeeded but its response was lost.

**If changed:** Automatic retry is acceptable only after the database command
gains a reviewed idempotency key and conflicting-retry behavior with real
Postgres tests. Matching rules must also change if duplicate names become a
supported intentional onboarding choice.

## 2026-09-08 — The application shell owns global context

**Decision:** A persistent pine ledger rail owns product identity, visible-space
selection, language, primary navigation, and account actions. Loans is embedded
as the one active workspace and keeps ownership of its month, projections, and
protected dialogs. Wallets and reports appear only as disabled coming-later
labels, not navigable features.

**Why:** A non-technical manager needs one stable place to understand whose
space is open and how to leave or change language. Lifting global controls above
Loans removes duplicated context without rewriting the already verified Loans
domain and command flows. The pine/paper ledger treatment extends the existing
financial visual language without a generic grid of application cards.

**If changed:** A top navigation or route-based shell must still keep one global
selected space and locale, label unfinished features honestly, use sourced-name
isolation, and mount the same command-backed Loans workspace without duplicating
its mutation logic.

## 2026-09-08 — Wallets is a projection-first journal workspace

**Decision:** Wallets is an active application destination with its own typed
gateway. It reads active wallets and balances from RLS-protected relations,
derives displayed balances only from `public.wallet_balances`, and loads journal
history in bounded 20-event pages. Its only mutation commands are
`public.create_wallet`, `public.record_financial_event`, and
`public.reverse_financial_event`; loan-linked events remain read-only in this
workspace and direct the manager to Loans.

**Why:** A separate projection-first boundary keeps the verified Loans command
allowlist unchanged, prevents client-side balance prediction, and makes the
absence of protected archive, category, invitation, and cross-currency commands
visible instead of encouraging direct table writes.

**If changed:** Any additional Wallets mutation requires a reviewed protected
command, an inventory entry, real-Postgres rejection coverage, a browser-write
ratchet update, and reconciliation behavior before a UI control may expose it.
Changing page size or projection sources requires fresh bounded-read and stale
space-isolation proof.

## 2026-09-08 — Journal retries are explicit and request-stable

**Decision:** Every general posting or reversal receives one browser-generated
request UUID. An ambiguous transport result triggers a bounded RLS read by both
space and request ID. A visible matching event completes the workflow; otherwise
the UI offers only an explicit retry with the identical request ID and payload.
Wallet creation, which has no idempotency key, reconciles by selected space,
trimmed name, and currency and never retries automatically.

**Why:** A lost response must not create duplicate money events or wallets.
Database idempotency can protect request-bearing journal commands only when the
client reuses the same request, while wallet creation needs safe visible-state
reconciliation before another deliberate submission.

**If changed:** Automatic journal retry requires proof that every participating
client preserves the same request and payload. Automatic wallet retry remains
disallowed until its protected command accepts and verifies an idempotency key.

## 2026-09-08 — Categories v1 lifecycle and naming defaults

**Decision:** Every active space member may create and archive categories.
Active normalized names are unique within a space separately for income and
expense kind, in each supplied language. Category creation and onboarding seed
no starter rows.

**Why:** Member-managed lifecycle matches the existing wallet and posting
authorization boundary. Kind-scoped uniqueness lets one household use the same
human label on both sides of the ledger without merging meaning. Avoiding seed
rows keeps product copy, locale, and archival policy out of this database
foundation.

**If changed:** Owner-only management requires a role-aware private
authorization helper and new owner/member rejection coverage. A shared naming
namespace removes kind from the active unique indexes and changes conflict
behavior. Starter categories require a separate idempotent onboarding design
with explicit locale and archival rules.

## 2026-09-08 — Categories use a separate command-only application gateway

**Decision:** Category management and categorized posting use a dedicated typed
Categories gateway. Active category reads use `(created_at, id)` keyset order
with a default page of 50 and hard maximum of 100. Browser lifecycle mutations
call only `public.create_category` and `public.archive_category`; categorized
income and expense call only `public.record_categorized_financial_event`.
Uncategorized events keep the existing Wallets command path unchanged.

**Why:** Keeping the adapter separate preserves the reviewed Wallets and Loans
mutation surfaces while making the new database capabilities explicit and
auditable. Keyset pagination and hard limits keep space-scoped reads bounded,
and an explicit uncategorized path avoids inventing classification.

**If changed:** A shared gateway or another category mutation requires updated
command allowlists, direct-write ratchets, bounded-read tests, and a reviewed
database capability before the browser may expose it. A different page contract
requires compatible cursor validation and stale-space coverage.

## 2026-09-08 — Category history is immutable and posting recovery is request-stable

**Decision:** Category selection is available only for new income and expense
events. Each categorized submission receives one browser-generated request UUID
and reconciles an ambiguous response through bounded event and association
reads; absence exposes only an explicit identical retry. Journal pages resolve
at most 20 associations and retain archived category names read-only. Events
without an association remain visibly uncategorized.

**Why:** Openings, transfers, loan events, and reversals have no reviewed
category contract. Matching both the request ID and category association avoids
accepting the wrong recovered event, while historical labels must survive later
archival without rewriting the immutable journal.

**If changed:** Categorizing another event kind requires a reviewed database
contract and corresponding rejection/reconstruction proof. Editable or renamed
historical labels require an explicit audit policy; automatic retry requires
proof that the identical request ID and payload are retained end to end.

## 2026-09-08 — Accepted category commands recover by read-only refresh

**Decision:** A category create or archive is complete only after its protected
command is accepted and the active register refresh succeeds. If the command is
accepted but that read fails, the dialog retains its submitted context, disables
another mutation, and offers a read-only refresh until the server projection is
available.

**Why:** Reporting success before the refreshed projection is visible is false,
while replaying an already accepted mutation risks a duplicate create or a noisy
second archive. A separate refresh-required state makes that boundary explicit.

**If changed:** Any automatic mutation replay requires end-to-end proof that the
same request ID and payload remain idempotent. Allowing a dialog to report success
without a fresh projection requires a separate product definition of accepted
versus visibly complete work.

## 2026-09-08 — Private launch defaults are tailnet-only and environment-isolated

**Decision:** The implementation-planning default is a private personal
deployment: source, release worktree, and Vite development stay on Daniel's Mac;
only an immutable static release artifact may be copied to Le Labo Ubuntu.
Development, UAT, and live use separate Supabase projects, directories, ports,
credentials, volumes, Auth users, and backup prefixes. UAT is on-demand and
synthetic; live is exposed only through Tailscale Serve HTTPS with Funnel and
public/LAN ingress disabled. No provisioning or deployment is approved by this
planning decision.

**Why:** It preserves the proven Mac-authoritative workflow, gives approved
devices private HTTPS access, and makes reuse of Sandooq/POS or resettable Budget
development state a detectable error rather than an operator convention.

**If changed:** Managed hosting, public browser access, Mac-only live service, or
shared environments require a new cost, identity, data-location, ingress,
availability, backup, and isolation review before any live resource is created.

## 2026-09-08 — Live recovery defaults to a measured 24-hour RPO and four-hour RTO

**Decision:** Before real financial data, live must have a verified encrypted
backup at least daily, retain 14 daily, eight weekly, and 12 monthly recovery
points, and hold at least one verified ciphertext copy off-site. A scratch
restore from the off-site copy must prove the complete data/catalog/security
boundary and finish within four hours. The default maximum accepted-data loss is
24 hours. These are planning defaults until Daniel approves the recovery policy.

**Why:** A dump that has never been decrypted and restored is not recovery
evidence. Explicit objectives and retention bounds make backup health measurable
while keeping a personal deployment operationally and financially proportionate.

**If changed:** A tighter RPO requires rehearsed WAL archiving/PITR or a managed
PITR service; different retention or RTO changes storage, alerting, drill,
capacity, and provider-cost requirements before launch.

## 2026-09-08 — Live authentication defaults to closed verified enrollment

**Decision:** Live planning assumes approved accounts only, verified email,
working password recovery, secure password changes, and public signup disabled
after enrollment. External mail is transactional only and must use an approved
provider/sending domain with SPF, DKIM, DMARC monitoring, bounded idempotent
delivery, bilingual accessible templates, and redacted operational evidence.
Mailpit remains development proof only. No provider, domain, DNS change, or email
send is approved by this decision.

**Why:** The current development Auth configuration permits signup without email
confirmation and has no complete recovery flow. Real financial data should not
depend on an unverified address, an unrecoverable account, or an unauthenticated
sending domain.

**If changed:** Open signup requires CAPTCHA, abuse/rate-limit monitoring,
enumeration-safe recovery, lifecycle/deletion policy, and owner-approved support
capacity. Omitting email recovery requires a separately designed and rehearsed
account-recovery mechanism before real data.

## 2026-09-09 — Failure cleanup has an independent five-second bound

**Decision:** Backup and scratch-restore traps start one fresh five-second
monotonic deadline for exact descendant validation and cleanup. They do not
reuse the main operation deadline, which may already be expired when the trap
runs. Payload-size and tracked-text reads open candidates only inside their
bounded command or no-follow descriptor.

**Why:** An expired operation must still remove exact plaintext, incomplete
ciphertext, restore-temp, and lock artifacts without allowing cleanup to become
unbounded or to follow a swapped path.

**If changed:** A different cleanup budget needs measured slow-filesystem
evidence and new timeout-path tests. Any broader cleanup target needs a separate
review of path identity, ownership, permissions, and recoverability.

## 2026-09-09 — Cleanup owns the bounded run directory, not a filename list

**Decision:** Failure cleanup removes each exact run-scoped temp, incomplete
recovery, lock, and executable-snapshot directory through one no-follow helper.
The helper uses the trap's single deadline, descriptor-relative traversal and
unlink/rmdir operations, a 32-entry flat-directory cap, and safe bounded names.
Symlink entries are unlinked without touching their targets; nested directories
fail closed.

**Why:** An adapter can create or rename a flat sibling that a predetermined
filename list does not know about. Ignoring a nonempty `rmdir` then leaves
plaintext or recovery material while appearing to have attempted cleanup.

**If changed:** Supporting nested directories or more than 32 entries requires
a new bounded traversal design, adversarial symlink/swap tests, and an explicit
review of which additional artifacts cleanup is authorized to remove.

## 2026-09-09 — Offline acceptance is a rehearsal, not authenticated UAT

**Decision:** The release candidate has a deterministic offline acceptance
rehearsal using only synthetic identities, synthetic minor-unit amounts, an
injected browser session, and in-memory HTTP fixtures. The harness records only
the allowlisted protected-command names it observed and never records payloads.
Fixture state retained across a page reload proves only browser rehydration from
that fixture process. It is not evidence of Supabase Auth, RLS, PostgreSQL
persistence, private HTTPS, encrypted backup, off-site durability, or restore.

**Why:** This session explicitly forbids remote database, host, provider, and
deployment contact. Calling intercepted browser traffic “live UAT” would hide
the most important real-data-entry blockers. The rehearsal still gives
maintainers a fast, reproducible release check without weakening the reviewed
database or gateway boundaries.

**If changed:** A claim of private authenticated UAT requires the exact release
artifact on an approved private HTTPS origin, a separate synthetic UAT Supabase
environment, real Auth/RLS/protected-command evidence, and redacted operator
receipts. A claim of data recovery additionally requires a named encrypted
off-site backup and measured scratch restore.

## 2026-09-09 — Exact-schema UAT is isolated, minimal, and one-shot

**Decision:** The disposable UAT backend for release
`6af62c1b0105b75a9796cfb299791f4c26a7dd2e` uses a separate four-service Docker
Compose project at `/home/lelabo/budget-uat-18`: PostgreSQL, GoTrue, PostgREST,
and Kong only. It binds the gateway and database to loopback ports `54521` and
`54522`, uses restart policy `no`, generates its secrets only on Ubuntu, and
applies exactly the 18 hash-pinned release migrations to an empty journal.
After a stop or partial provision, cleanup and fresh provisioning replace secret
or database reuse. The ordinary checkout's hosted Supabase environment and any
Cloudflare frontend deployment remain outside this infrastructure layer.

Private HTTPS may be added only as one tailnet-only Tailscale Serve handler when
all existing TCP routes remain unchanged and Funnel remains disabled. Until
that route and its certificate are verified without bypass flags, the stack is
not ready for formal product UAT.

**Why:** A minimal, one-shot environment keeps schema attribution exact, makes
synthetic cleanup complete, and avoids coupling this release proof to Budget
development, Sandooq, POS, a hosted provider project, or public ingress.

**If changed:** Reusing secrets/data, adding services, enabling automatic
restart, changing ports/host, using hosted Supabase, or introducing a public
frontend/domain requires a new isolation, access, recovery, cost, and evidence
review before deployment or real-data entry.

## 2026-09-09 — Public beta may precede exact-schema and human UAT

**Decision:** Daniel explicitly authorized proceeding toward a public Cloudflare
launch without waiting for the isolated exact-schema UAT environment or the
first-time-user browser audit. The release must still pass its automated gate,
use the reviewed release-candidate boundary, and pass a pinned Cloudflare build
and dry run. Until an encrypted off-site backup has been restored successfully,
the public deployment is a beta for synthetic or replaceable data rather than an
approved store for irreplaceable financial records.

**Why:** Daniel prioritized reaching a live public origin now and accepted the
remaining usability, physical-device, exact-schema, and recovery uncertainty.
Recording the waiver preserves an honest distinction between availability and
evidence that the product is understandable and recoverable.

**If changed:** Requiring full launch evidence blocks public or real-data use
until authenticated exact-schema desktop/mobile UAT, a first-time-user browser
audit, physical-device coverage, an encrypted off-site backup, and a measured
scratch restore have passed. Approving real data before recovery proof requires
a separate explicit loss-risk decision.

## 2026-09-10 — Live Supabase migration runner is exact-target and one-time

**Decision:** Daniel explicitly approved applying the reviewed forward-only
migration journal to Supabase project `bsjqmulybcmlgpmhfrug`. The operator
runner accepts only that project, the manifest-pinned 18-migration journal, the
`main` branch, a clean tracked migration boundary, a Supabase personal access
token, a database password, and an exact typed confirmation. It creates a
private local snapshot of the pre-migration `public` schema and data, dry-runs
before applying, excludes reset/repair/seed/role/include-all operations, then
checks both a second dry run and the exact required schema/history. A service
role or secret API key is neither consumed nor accepted as migration authority.

**Why:** The hosted application authenticates successfully but the configured
project lacks `public.spaces`, so its reviewed schema must be installed before
the application can load a workspace. Exact project and journal gates prevent a
valid credential or stale local link from widening the approved production
change.

**If changed:** A different project ref, additional migration, seed, role,
history repair, destructive reset, or automated CI application requires a new
review and explicit owner approval. The local `public` snapshot is not an
encrypted off-site recovery point and does not approve irreplaceable real-data
entry before the existing restore requirement is satisfied.

## 2026-09-10 — Subcategories use one immutable parent level

**Decision:** A category may have one immutable parent category, and only a
root category may be a parent. Parent and child share the same space and
income/expense kind. Active normalized names remain unique across the whole
space and kind. Transactions keep one category association; reporting rolls a
child into its parent without duplicating the event. Monthly targets initially
belong only to roots. A root cannot be archived while it has active children.

**Why:** One bounded level supports household breakdowns such as Essentials →
Rent/Groceries/Utilities without introducing recursive trees, mutable taxonomy
history, double-counted budgets, or changes to the immutable journal. Global
name uniqueness keeps pickers unambiguous and preserves the deployed
Categories v1 constraint.

**If changed:** Arbitrary nesting requires cycle, depth, recursive read, and
subtree lifecycle contracts. Reparenting requires append-only relationship
history and historical reporting semantics. Child-level targets require an
explicit allocation rule preventing parent/child double counting. Sibling-only
name uniqueness requires replacing deployed indexes and disambiguating every
category picker and report.

## 2026-09-10 — Essentials bootstrap is owner-specific production data

**Decision:** Daniel's existing production `Essentials` expense category will
receive the 22 English-only child names recorded in the Subcategories database
design, but only through separately approved authenticated commands after the
schema is implemented and applied. The list is not seeded for other spaces or
users.

**Why:** These labels reflect one household's requested budgeting structure.
Keeping them out of migrations preserves the established no-starter-category
default and prevents product policy or personal preferences from becoming
global database state.

**If changed:** A reusable suggested pack requires its own locale, duplicate,
opt-in, versioning, and archive policy. Applying this list to another account
requires a new exact-target verification and owner-approved data operation.

## 2026-09-10 — Parent validation serializes independent owner writes

**Decision:** The unapplied subcategory migration's parent validation trigger
uses `FOR UPDATE`, matching the protected child creation command. Two-session
owner tests cover child-first and archive-first ordering, exact rejection,
unchanged receipts, and cleanup under bounded database and barrier deadlines.

**Why:** A direct owner archive update takes a `FOR NO KEY UPDATE` row lock,
which is compatible with the originally specified `FOR KEY SHARE`. Both
transactions could therefore commit an active child beneath an archived root.
The table invariant must survive independently of the protected RPC locks.
The lesson is to test direct-writer lock conflicts as well as command races.

**If changed:** Weakening the trigger lock reopens this proven race. An
alternative needs a separately reviewed serialization mechanism and both
owner-order rejection tests. The stronger lock serializes child creation for
the same parent until each short transaction completes.

## 2026-09-10 — Milestone migration proofs compose without owning later migrations

**Decision:** Empty-database tests compare the bounded discovered migration
journal with the rows actually applied. A milestone upgrade test selects its
exact baseline and exact migration instead of treating every later timestamp as
part of that milestone. Function-compatibility checks use an exact protected
signature allowlist without rejecting additional APIs delivered by another
reviewed milestone.

**Why:** Merging the independently reviewed Household and Subcategories branches
produced a valid 32-migration journal, but their standalone tests assumed that
no later migration or public command could exist. Those assumptions caused the
combined gate to fail even though every migration applied successfully.

**If changed:** Treating a repository suffix or the entire public-function
namespace as one milestone's private universe will make safe parallel features
conflict at integration time. A deliberately exclusive release boundary should
instead use its separate hash manifest and exact release gate.

## 2026-09-10 — Subcategories extend the existing category register

**Decision:** Active subcategories render as a semantic one-level nested list
beneath their immutable root in the existing income and expense registers.
Only roots expose child creation. A root with active children directs the user
to archive those children first instead of submitting a predictably invalid
root archive. Both roots and children remain exact single-category transaction
choices, and history continues to display only the category identity stored on
the event.

**Why:** This makes the database's one-level invariant visible without adding a
second navigation surface or changing the established Categories lifecycle.
It also prevents the application from inventing a parent event association or
double-counting financial history. Root creation, child creation, and archival
remain separate protected commands with request-stable recovery.

**If changed:** Arbitrary depth needs recursive reads, cycle handling, and
subtree lifecycle UX. Reparenting needs relationship history. Displaying both
parent and child as event associations or adding child budget targets requires
a separately reviewed roll-up/allocation contract. Allowing root archive with
active children requires an explicit cascade policy; this UI does not infer
one.

## 2026-09-10 — Household invitation delivery uses a server-only Worker boundary

**Decision:** The existing protected invitation creation RPC remains the only
authorization and membership-state writer. A Cloudflare Worker forwards the
caller's JWT to that command and then submits one English or Arabic transactional
message through an injected Resend HTTP adapter. It holds provider configuration
only in required server secrets, applies 20 attempts per source IP per minute and
three attempts per owner and household per minute, uses the invitation UUID as
the provider idempotency key, and enforces a 23-hour provider retry cutoff. No
database migration, service-role credential, browser integration, or real send
is part of this decision.

**Why:** Keeping delivery outside the database transaction preserves the proven
membership locks, RLS, and replay behavior while preventing Resend credentials
from entering Vite. Stable provider idempotency, bounded retries and timeouts,
fail-closed throttles, fixed redacted audit events, and accessible bilingual
HTML/text make the transport independently testable without claiming inbox or
membership success.

**If changed:** A durable queue, delivery-status persistence, different provider,
longer retry window, different rate limits, or another runtime requires a new
failure, replay, abuse rate, secret, and operational design. Any direct database
write or service-role path requires a separate authorization and real-Postgres
review. Provider setup, DNS, deployment, synthetic sending, bounce handling, and
the Household acceptance UI each remain separately approved work.

## 2026-09-10 — Household UI records invitations without claiming delivery

**Decision:** Household administration is a selected-household application
destination backed only by the six protected mutation commands, two bounded
owner projections, and the current user's existing RLS-visible membership row.
Invitation links use `#household-invitation=<token>`; the client removes the
fragment before application initialization and never persists or renders the
token. Until an email provider is separately approved, invitation creation
discards the returned token at the gateway boundary and reports only that the
database record exists and delivery is not configured. Member identities remain
opaque user IDs because no approved profile or email projection exists.

**Why:** This exposes the merged Household lifecycle without introducing direct
table writes, widening identity reads, leaking reusable secrets, or pretending
that an invitation was delivered. Scoping administration to the selected
household also prevents personal-space controls or stale cross-space data from
appearing.

**If changed:** Usable external delivery requires a separately reviewed trusted
delivery boundary that consumes the returned token without exposing it to UI or
logs. Display names or email addresses require an explicit identity projection
and privacy design. A routed settings area would require a navigation and URL
state milestone rather than an incidental Household UI change.

## 2026-09-11 — Deleted live project is replaced by a fresh exact target

**Decision:** The deleted Supabase project `bsjqmulybcmlgpmhfrug` is no longer a
valid Budget release target. The replacement project is the active
`Budget Production` project `hqblhzqitrbvpyoxtmew` in `ap-south-1`. The live
migration runner is retargeted to that exact ref while retaining the same
hash-pinned 32-migration journal, backup, dry-run, confirmation, and post-apply
verification boundaries. The unrelated `bsszbeohjxehcxwssjlc` project is not a
Budget target.

**Why:** The old hosted project was deleted and cannot receive or preserve the
release. The authenticated Supabase account currently exposes one healthy
project named `Budget Production`; using its exact ref prevents a stale local
link from selecting another database. Retargeting does not authorize applying
SQL and does not alter any forward-only migration.

**If changed:** Any other project ref, restored source database, imported data,
or expanded journal requires a new read-only identity and journal inspection,
runner review, green release gate, and exact owner approval before application.

## 2026-09-11 — Frontend may deploy before invitation delivery

**Decision:** While the Household invitation provider remains deliberately
unconfigured, the public Budget release uses a separate static-assets-only
Cloudflare configuration. It keeps the same `budget-tracker` Worker name and
SPA fallback but omits the Worker entry point, `/api/*` routing, rate-limit
bindings, and server-secret contract. The combined configuration remains the
only approved path once invitation delivery is enabled.

**Why:** Cloudflare correctly rejects the combined deployment while its six
required invitation secrets are absent. The owner ordered frontend availability
before the separately approved Resend milestone. A distinct static release
keeps that sequencing explicit instead of weakening or partially configuring
the invitation Worker.

**If changed:** Enabling invitation delivery requires all six reviewed hosted
secrets, provider/domain verification, a combined dry-run and deployment, and a
synthetic send test. Running the frontend-only command afterward would remove
the API route and must therefore be blocked by the release procedure.

## 2026-09-11 — Cloudflare Workers Builds retargets to the frontend-only command

**Decision:** The `budget-tracker` Worker's Cloudflare Workers Builds production
settings (GitHub-connected auto-deploy on every push to `main`) now run
`pnpm deploy:cloudflare:frontend` instead of `pnpm deploy:cloudflare`. Build
command, environment variables, and repository/branch watch are unchanged.

**Why:** Workers Builds predates the frontend-only release decision above and
still pointed at the combined deploy command. The push that landed the
frontend-only release and Subcategories timeout fix auto-triggered Workers
Builds, which correctly failed at Cloudflare's required-secrets gate (the six
invitation secrets are still unset) without deploying anything — the manually
deployed frontend-only release stayed live and unaffected. Left unchanged,
every future push to `main` would keep failing the same way until the
invitation milestone starts.

**If changed:** Enabling invitation delivery must flip this deploy command back
to `pnpm deploy:cloudflare` in the same change that configures the six hosted
secrets, so Workers Builds and the manual release procedure stay consistent.

## 2026-09-11 — Hosted restore drill proves logical restore, not recovery readiness

**Decision:** The first Budget Production recovery drill restored read-only
Supabase CLI dumps into a loopback-only scratch container built from the exact
production image and compared catalog, data, foreign-key, RLS, and privilege
evidence against production. The data dump deliberately excluded live
session-credential tables (`auth.sessions`, `auth.refresh_tokens`,
`auth.mfa_amr_claims`, `auth.one_time_tokens`, `auth.flow_state`), narrowing the
approved "including Auth data" scope. The plaintext dump stays in a private
session directory until Daniel approves cleanup, and the drill scripts are
throwaway and not committed. The real-data gate is unchanged: an encrypted
off-site backup and a restore fetched from that copy are still required.

**Why:** Refresh tokens are bearer credentials that a real recovery would
invalidate anyway, and they change constantly, so excluding them reduces
exposure without weakening the Auth-user, foreign-key, or privilege proof. A
plaintext local dump proves the logical restore procedure and exposed two
restore defects cheaply, but it is not an encrypted, retained, off-site recovery
point.

**If changed:** Including session tables requires encrypted-at-rest handling for
the dump and a churn-tolerant comparison. Treating a drill as recovery evidence
requires a named encrypted off-site copy, key custody, retention, and a restore
fetched from that copy. Promoting the drill scripts into repository tooling is a
separate reviewed milestone with rejection tests.

## 2026-09-11 — Supabase restores neutralize target default privileges

**Decision:** Every restore of a Budget schema dump into a Supabase-shaped
database must, inside the restore transaction, create platform roles the role
dump references but the target lacks, revoke every item of the target's
`public` per-schema default privileges for `postgres` and `supabase_admin`,
assert none remain, restore, and then reinstate those defaults exactly. A restore
counts as verified only when object ACLs, policies, functions, and default
privileges match production by catalog comparison and a privilege smoke test
observes `permission denied` for `anon` and for direct writes.

**Why:** Measured on 2026-09-11: without this step the dump restored cleanly and
row-visibility checks passed, yet `anon` gained `SELECT` on `public.spaces` and
`EXECUTE` on the `SECURITY DEFINER` `leave_household_space`, both denied in
production. The schema dump emitted grants relative to built-in defaults and no
revokes, while the target's default privileges added broad grants at object
creation. Production carries the identical 24 default-privilege entries, so a new
hosted project is expected to widen the same way; that remains to be measured on
such a target.

**If changed:** A target without Supabase default privileges may skip the
neutralization but still needs the ACL comparison. A different backup format or
an explicit ACL-reset step needs its own rejection test proving `anon` is denied
after restore.

## 2026-09-11 — Supabase scratch restores use one reviewed fail-closed procedure

**Decision:** Supabase CLI dumps are restored only through
`scripts/ops/supabase-scratch-restore.sh`, re-derived from the drill's runbook
section and the two entries above because the drill scripts were never
committed. It renders one `psql --single-transaction` stream in the drill's
restore order and runs it through `docker exec` in one running container
labelled `budget.restore-target=supabase-scratch`, built from
`supabase/postgres:17.6.1.166` pinned by index digest, publishing nothing beyond
loopback, and reached over a local-socket or SSH Docker endpoint. Verification
needs a line-for-line match with a production fingerprint produced by
`ops/supabase-restore/fingerprint.sql`, zero foreign-key orphans, and SQLSTATE
`42501` for every probe in `ops/supabase-restore/privilege-probes.txt`. A
Testcontainers suite on the real image joins `pnpm check:ops`, using synthetic
fixtures dumped through the CLI 2.109.1 pipelines copied from its `--dry-run`
output. Defaults taken in the owner's absence:

- The image is referenced as `public.ecr.aws/supabase/postgres:17.6.1.166`,
  whose index digest equals Docker Hub `supabase/postgres:17.6.1.166` (measured
  2026-09-11); either name is accepted only with that digest.
- The fingerprint compares CLI application schemas plus `auth` and
  `supabase_migrations`. It excludes the CLI's internal platform schemas, row
  data of the five excluded session tables, and role attributes (the image and
  hosted `postgres` attributes already differ). Non-allowlisted setting values
  appear only as md5.
- The probe manifest holds exactly the five probes measured denied in
  production, for `anon` and `authenticated` only.
- A non-empty `storage` table, any psql meta-command, and line-level transaction
  control refuse the bundle before a target is contacted.
- Only `supabase_realtime_admin` has a reviewed platform-role definition; any
  other missing platform role fails the whole transaction.
- A deferred completion sentinel refuses the commit when the stream ends early,
  because `psql --single-transaction` commits whatever it read at end of input.
- `pnpm check:ops` now needs a reachable Docker endpoint. At Daniel's request
  the suite runs on the Le Labo Ubuntu Docker host through a local unix-socket
  bridge to `ssh ... docker system dial-stdio`, because Tailscale SSH refuses
  socket forwarding and Testcontainers 12.1.0 does not speak `ssh://`. Ryuk is
  disabled there, and the suite stops each test's labelled containers itself.
- `testcontainers` 12.1.0 (MIT, pinned devDependency) brings build scripts for
  `cpu-features`, `protobufjs`, and `ssh2`. The pinned pnpm 11.17.0 refuses a
  frozen install while they are unreviewed (measured: `ERR_PNPM_IGNORED_BUILDS`),
  so `allowBuilds` denies each explicitly. The deployment contract test still
  pins approvals to `esbuild` and `workerd` and now accepts only explicit
  denials besides them.

**Why:** The drill exposed two defects that a hand-run procedure could repeat
silently: a platform role missing from the target, and target default
privileges that widened `anon` while row-visibility checks still passed.
Encoding the order, guards, and checks with rejection tests turns both into
refusals, and pinning the target by label, image digest, and loopback-only
ports keeps a restore of production data off any other database.

**If changed:** Another image tag or registry digest needs a new pin and a
re-measured placeholder `auth` inventory. Including session tables needs their
data dumped and a churn-tolerant comparison. The fingerprint definition has not
yet run against production, so its first approved run may expose differences;
each needs its own ledger entry, not an ad hoc exclusion. More probes or
platform roles need measured production evidence. A real-data restore on the
shared Ubuntu host needs the host isolation audit. Encryption, off-site storage,
key custody, and scheduling remain owner decisions.

## 2026-09-11 — Secret scan is bounded by bytes and time, not a near-full file count

**Decision:** The tracked-text secret scan behind `pnpm check:ops` accepts up to
4,096 files (was 256) and keeps the 10 MiB per-file read bound. It adds a 64 MiB
total bound, summed from `lstat` sizes before any content is read, and a
180-second monotonic deadline checked before each file is opened. Every bound
fails closed: scan-bound failures exit `64`, secret findings still exit `69`. A
passing scan now reports its byte total alongside its file count.

**Why:** The 256-file cap sat just above the tree. Commit `08a6e01` measured 235
scanned files and the Supabase scratch-restore tooling reported 246, so about ten
unrelated files would have broken `check:ops`. From 2026-09-07 to 2026-09-11 the
scanned set grew from 59 files and 0.33 MiB to 235 files and 2.89 MiB, about 40
files and 0.9 MiB a day, so even 1,024 files would trip within about three weeks.
Time is the resource that matters. Measured on the development Mac, each file
costs about 8 ms of process overhead and repository text scans at about 0.46 s
per MiB; the current tree takes 3.3 s. A real scan at both caps (4,096 files
totalling exactly 64 MiB) passed in 53 s, so the deterministic count and byte
bounds trip well before the machine-dependent deadline. Checking the deadline
inside the per-line loop would cost a process per check, so it is checked
between files. One pathological
10 MiB file measured 28 s (806k assignment-shaped lines) and 144 s (5.2M one-byte
lines), so the worst-case wall time is the deadline plus one such file. The byte
total is measured before reading so an oversized plan fails fast and
deterministically. A file that grows after measurement is still held to the
per-file read bound and the deadline.

**If changed:** When a bound is exceeded again, raise it only in its own reviewed
commit, never folded into the unrelated change that tripped it. First re-measure
the file count and byte total (both printed by a passing scan) and the wall time
of `BUDGET_OPS_STATIC_ONLY=1 bash scripts/ops/check-budget.sh`. Then either narrow
the scanned set (for example, a generated file such as `worker-configuration.d.ts`
that has its own `check:worker-types` provenance check), or raise
`BUDGET_MAX_SCAN_FILES` / `BUDGET_MAX_SCAN_TOTAL_BYTES` and update this entry, the
runbook, and `tests/ops/secret-scan-bounds.test.ts`. Keep the measured time at
both caps under half of `BUDGET_SCAN_DEADLINE_SECONDS`. If the deadline trips on
an unchanged tree, the host is slower than the one measured here: re-measure on
that host before raising the deadline. The direct `budget-common.sh scan-secrets`
entrypoint passes paths as argv (macOS `ARG_MAX` is 1 MiB), so a much larger file
cap must keep scanning in-process as `check-budget.sh` does. A hard deadline
inside a single file would need line-loop checkpoints or a faster matcher, each
with its own rejection test.

## 2026-09-11 — The Testcontainers suite reaches the Le Labo Docker host through a tracked bridge

**Decision:** `scripts/ops/docker-ssh-bridge.sh run -- COMMAND` replaces the
hand-built bridge described in the Supabase scratch-restore procedure entry
above. It runs one command with
`DOCKER_HOST` pointing at a private local unix socket and
`TESTCONTAINERS_RYUK_DISABLED=true`; each accepted connection runs
`ssh lelabo@100.76.160.91 docker system dial-stdio` over one multiplexed SSH
master. Fixture tests with a fake `ssh` join `pnpm check:ops` and need no remote
host. Defaults taken in the owner's absence:

- The address is a pinned constant with no override, passed with `HostName`,
  `ProxyJump=none`, and `ProxyCommand=none` so ssh configuration cannot reroute
  it (accepted by `ssh -G` with OpenSSH 10.3p1). Only the client binary can
  change (`BUDGET_DOCKER_BRIDGE_SSH_BIN`, an absolute path, default
  `/usr/bin/ssh`), which is how the tests substitute a fake. On the host,
  `docker system dial-stdio` still follows the `lelabo` user's Docker
  configuration.
- Each run gets its own mode-`0700` directory under `TMPDIR` holding the bridge
  socket and `ControlPath=<dir>/ssh`, and ends its master with `ssh -O exit`,
  instead of a shared `${TMPDIR%/}/bl-%h` (the form measured working on
  2026-09-11). Concurrent runs cannot stop each other's master, at the cost of
  one master start per run; only a killed helper leaves its master and directory
  behind, until `ControlPersist` (900 s). A `TMPDIR` longer than 69 bytes after
  one trailing slash is removed is refused, because the control path plus
  OpenSSH's 17-character suffix would reach the 104-byte macOS `sun_path`.
- Readiness is `GET /_ping` through the bridge within 30 s
  (`BUDGET_DOCKER_BRIDGE_READY_SECONDS`, 1-120). Failure exits `66` with a
  Tailscale re-authentication hint, so a stale login at startup cannot hang the
  run. Sessions have no wall-clock limit because hijacked `docker exec` streams
  last as long as a restore; SSH keepalives (15 s, two misses) bound a dead link.
  If the master connection drops mid-run, new sessions reconnect, and check mode
  can hold those until the suite's own timeouts.
- Testcontainers 12.1.0 tries `tc.host` from `~/.testcontainers.properties`
  before `DOCKER_HOST` and falls back to `/var/run/docker.sock` when an endpoint
  fails (read from the pinned source). The helper refuses a `tc.host` setting and
  exits `66` when the bridge exits before the command does. It cannot see which
  endpoint a client finally used; the suite asserts that before starting any
  container (see "The scratch-restore suite fails unless Testcontainers dials
  `DOCKER_HOST`" below).
- Interrupts during cleanup are ignored because cleanup is bounded, so a second
  Ctrl-C cannot orphan the bridge. SSH sessions run in their own session so a
  terminal Ctrl-C reaches the helper first, and the bridge stops itself within a
  second when the helper is killed. The command process gets `TERM`, then `KILL`
  after 10 s; processes it started are not signalled directly.
- At most 32 connections are open at once; excess connections are refused and
  logged rather than queued. Tailscale SSH's own per-connection session limit is
  unmeasured; a full `pnpm check:ops` through the helper (13 files, 249 tests,
  231 s, measured 2026-09-11) never reached the bound.
- Client EOF closes SSH stdin while the response keeps flowing; remote EOF ends
  the connection. While the remote is silent, a POLLHUP on the client ends the
  session. On macOS a half-closed peer still polls writable, while a closed one
  reports only POLLHUP (measured 2026-09-11).
- Sessions the bridge terminates at shutdown are not reported as SSH failures.
  OpenSSH mux clients exit 255 when terminated, which printed a false
  `ssh exited with status 255` in 3 of 5 live `docker version` runs before the
  fix.
- The command keeps the caller's `PATH`, because Node comes from a version
  manager outside the ops allowlist. `DOCKER_CONTEXT` is left alone: Docker CLI
  29.7.2 prefers `DOCKER_HOST` when both are set (measured).

**Why:** `pnpm check:ops` now depends on this host, and the bridge existed only
as prose that each operator rebuilt by hand, with two silent traps: a
`ControlPath` over the socket limit stalls every connection, and a stale
Tailscale login makes the suite look stuck. Tracked, tested tooling turns both
into loud refusals, pins the SSH route, and refuses the two ways Testcontainers
12.1.0 could quietly use a different daemon.

**If changed:** If Tailscale SSH allows socket forwarding, or Testcontainers
supports `ssh://`, remove the helper in favour of `ssh -L` or
`DOCKER_HOST=ssh://`. Another Docker host needs its own pinned constant and
measurements, not an override. If the suite needs more concurrent connections,
or the SSH server caps sessions lower, re-measure and move the bound with its
test. Once the suite asserts its runtime endpoint, the `tc.host` refusal and
bridge-exit check remain as defense in depth. Running the suite in CI needs a
Docker endpoint there; this helper is operator-Mac tooling. The helper adds two
files to the tracked secret scan.

## 2026-09-11 — The scratch-restore suite fails unless Testcontainers dials `DOCKER_HOST`

**Decision:** The container `beforeAll` in
`tests/ops/supabase-scratch-restore.test.ts` first calls
`assertTestcontainersDialsDockerHost` from `tests/ops/testcontainers-endpoint.ts`.
When `DOCKER_HOST` is set, it resolves the Testcontainers runtime client and fails
the suite unless that client dials exactly `DOCKER_HOST`, so a `tc.host` override
or a fallback from a dead bridge socket stops the run before any container starts.
Defaults taken in the owner's absence:

- The dialed endpoint is read from `client.container.dockerode.modem`. In the
  pinned 12.1.0 source, `ContainerRuntimeClient.info` records no endpoint and the
  chosen strategy's `uri` is discarded. `clients/client.js` creates the only
  dockerode instance, and every `GenericContainer` call reuses the client it
  caches for the process, so one check before the first container covers the
  run. The modem is also more faithful than the strategy URI: docker-modem 5.0.7
  fills options the strategy leaves out from `process.env.DOCKER_HOST`.
  `@types/docker-modem` 3.0.6 declares no connection fields, so they are read as
  `unknown` and narrowed.
- The comparison is exact: `unix://` plus the dialed socket path must equal
  `DOCKER_HOST` byte for byte, so a path that Testcontainers' URL parsing rewrites
  fails as well.
- A set `DOCKER_HOST` that is not `unix:///absolute/path` (empty, `tcp://`, or
  `ssh://`) is refused before the client is resolved, so nothing is dialed. The
  bridge only produces unix sockets and the restore script refuses `tcp://`; an
  `ssh://` endpoint would be dialed during resolution. Testcontainers treats an
  empty `DOCKER_HOST` as unset and would silently pick a local socket.
- With `DOCKER_HOST` unset the check is skipped: a local Docker Desktop run
  chooses its own endpoint on purpose.
- The bridge helper's `tc.host` refusal and bridge-exit check stay as defense in
  depth. The probes below run without the helper, and the helper's fixture tests
  run without the suite.
- Probes run the helper in a fresh Node process each (the client cache is
  per-process) with a minimal environment, against fake local Docker APIs that
  answer only `GET /info`. They import the `.ts` file directly, measured working
  on the pinned Node 22.22.0. A matching socket passes; a dead socket with a fake
  fallback at `XDG_RUNTIME_DIR/docker.sock` fails; a `tc.host` override fails
  without the `DOCKER_HOST` socket being contacted; `tcp://` is refused without
  being dialed; empty is refused; unset passes. When `/var/run/docker.sock` is
  live, the dead-socket probe falls back to it instead, sends it one `GET /info`,
  and must still fail (read from the source; Docker Desktop was stopped when this
  was measured).

**Why:** Testcontainers logs a failing endpoint at debug level and moves on. A
dead bridge socket could therefore run the suite's containers on another daemon
while the restore script's `docker` CLI still used `DOCKER_HOST`, and the tests
that only use `container.exec` would pass there. Measured 2026-09-11 with no
Docker daemon and no remote host: with `DOCKER_HOST` on a dead socket and a fake
daemon at `XDG_RUNTIME_DIR/docker.sock`, the suite before this change sent that
fake `GET /info`, `GET /images/public.ecr.aws/supabase/postgres:17.6.1.166/json`,
and `POST /images/create`. After it, the fake saw only `GET /info` and vitest
exited `1`. A resolve-only stub let the fallback, `tc.host`, and `tcp://` probes
exit `0`.

**If changed:** Supporting `ssh://` means comparing the modem's protocol,
username, host, and port with `DOCKER_HOST`, with probes that still dial no
remote host. Pinning every run means failing when `DOCKER_HOST` is unset and
changing the unset probe. A Testcontainers upgrade must re-read where the client
keeps its dockerode instance and whether it still caches one client per process;
if the client starts recording its endpoint, compare against that and keep the
probes. The helper adds one file to the tracked secret scan (252 on this branch,
under the 4,096-file bound and still under the earlier 256).

## 2026-09-11 — New wallet transactions start as an expense

**Decision:** The Wallets "Add a transaction" dialog preselects **Expense**
instead of Income. Opening balance, income, and transfer stay one choice away in
the same Type control; nothing else about posting changes.

**Why:** The owner asked for it after recording an income by mistake: an
untouched Type control silently posted money *into* a wallet. Day-to-day entries
are overwhelmingly expenses, so the common path should need no extra choice and
the costly mistake (an inflated balance) should need a deliberate one.

**If changed:** Restoring an income default, or remembering the last-used type,
only changes the dialog's initial state and the tests that assert an untouched
Type records an expense. Remembering per-user or per-space choices would add
client state that must be cleared on space switch.

## 2026-09-11 — Wallet journal corrections are presented as Undo on the original date

**Decision:** The Wallets journal presents the existing linked-reversal
correction as **Undo** in English and Arabic ("Undo income", "Undo this
transaction", "Undone", "Undoes an earlier entry"), and the undo date defaults
to the original event's effective date instead of today. The command
(`public.reverse_financial_event`), eligibility (general, not loan-linked, not
already reversed), confirmation checkbox, and request-stable retry are
unchanged. The owner was offered real deletion and chose Undo: the journal stays
append-only and the original stays visible, marked as undone.

**Why:** The owner looked for "delete" to remove a mistaken income and did not
recognise "Correct income / Add linked reversal" as that action. Dating the
reversal like the original makes it cancel in the same period as the mistake, so
future month- or date-bounded reports net it to zero; a manager can still pick a
later date for a genuine refund.

**If changed:** Real deletion needs a new protected command that deliberately
bypasses the append-only journal guards, a command-inventory entry,
real-Postgres rejection tests, and an audit story — a separate reviewed
milestone. Hiding undone pairs from history is UI-only but must keep bounded
pagination honest, since a filtered page can look short. Loans corrections still
say "Correct … / Add reversal"; aligning that wording is a separate change.

## 2026-09-11 — Wallets change in place behind an append-only command log and are never deleted

**Decision:** A wallet's name and archive state change only through protected
commands that update `public.wallets` in place and append one row per request to
`public.wallet_command_requests` (who, what, when, and a rename's previous and new
name). Triggers let only the owning role update a wallet, allow only `name` and
`archived_at` (between null and a timestamp) to change, and refuse deleting or
truncating wallets. The log is owner-insert-only and rejects update, delete
(including zero-row statements), and truncate.

**Why:** This mirrors Categories' in-place state plus request ledger, so every
existing wallet read, balance view, and posting check keeps working while the log
answers "who renamed or archived this wallet, and when". Append-only revision
tables were rejected: the same audit value for a much larger read-path change.
Deleting a wallet would orphan journal history; archive is the removal path.

**If changed:** Revision tables would require every wallet reader and
`wallet_balances` to resolve the latest revision. Allowing deletion needs proof
that no movement, loan posting, or log row references the wallet, and its own
rejection tests.

## 2026-09-11 — Archived wallets accept no money movement

**Decision:** A `BEFORE INSERT` trigger on `public.wallet_movements` locks the
target wallet `FOR SHARE` and refuses any movement into an archived wallet with
`every wallet movement must use an active wallet`. It covers every writer,
including `reverse_financial_event` and the loan commands.

**Why:** Posting commands already skipped archived wallets, but reversals did not
check at all, and no command locked the wallet, so a posting validated just
before an archive committed could still land in the archived wallet. The share
lock conflicts with the archive command's row lock, so exactly one of the two
wins and an archived wallet always has a zero balance.

**If changed:** Allowing corrections into archived wallets needs its own reviewed
rule for keeping their balance at zero. Removing the lock reopens the race that
`tests/db/wallet-lifecycle.integration.test.ts` proves closed.

## 2026-09-11 — Any active space member may rename, archive, or restore a wallet

**Decision:** `rename_wallet`, `archive_wallet`, and `restore_wallet` require only
active membership of the wallet's space, like `create_wallet` and
`archive_category`. A rename trims the name, keeps the 1–120 character rule,
refuses an unchanged name, and refuses an archived wallet. The current name is the
only name and also shows on past entries.

**Why:** Household members already create wallets and post into them; an
owner-only rule would stop the member who empties an envelope from tidying it up,
and no owner-only policy was requested.

**If changed:** Owner-only lifecycle commands need an owner check in
`private.require_wallet_command_actor`, non-owner rejection tests, and UI that
hides the actions from members. Showing the name a wallet had when an entry was
posted needs a name-at-time projection built from the command log.

## 2026-09-11 — Wallets archive only at zero balance and can be restored

**Decision:** `archive_wallet` refuses unless the wallet's derived balance (the sum
of its movements) is exactly zero; `restore_wallet` returns an archived wallet to
active use at any time. Both are request-idempotent: an exact replay returns the
original wallet without re-applying, even if the wallet's state changed since.

**Why:** Archiving a wallet that still holds money would hide real balances from
every total. Restore makes an archive mistake recoverable and is the way to undo
an old transaction on an archived wallet.

**If changed:** Archiving non-zero wallets needs a visible archived-balance
projection or a closing-transfer design. Dropping restore makes archive permanent,
as it is for categories, and leaves old entries on archived wallets uncorrectable.

## 2026-09-11 — Subcategories and household-migration tests consolidate onto the shared disposable-database harness

**Decision:** `tests/db/subcategories.integration.test.ts` now imports its
disposable-database create/bootstrap/replay/dispose/transaction helpers from
`tests/db/disposable-database.ts` instead of carrying its own copy (removed
~290 duplicated lines: `createDisposableDatabase`, `disposeDisposableDatabase`,
`bootstrapCompatibilityObjects`, `migrationFiles`, `replayMigrations`,
`withAuthenticatedTransaction`, `withRollback`, `expectSavepointRejection`,
`inTransaction`, `databaseClient`, and their name-validation/drop plumbing).
Its disposable-database naming is unchanged (`budget_subcategories_<hex>`),
verified by keeping the exact prefix passed to the shared
`createDisposableDatabase`. `tests/db/household-migrations.integration.test.ts`
consolidates only the pieces that were byte-for-byte equivalent — the
`auth`/`extensions`/`supabase_migrations` bootstrap SQL and the migration-file
listing/replay loop — onto `bootstrapCompatibilityObjects` and
`migrationFiles`/`replayMigrations` from the same shared module. Its own
database creation, naming (`budget_household_migration_<hex>`), and
`cleanupDisposableDatabase` (which retries the drop after terminating blocking
backends, unlike the shared harness's single-attempt drop) are kept as-is.

**Why:** `tests/db/disposable-database.ts` (added on the merged
`claude/wallet-lifecycle-database` branch) is the same create/replay/dispose
logic subcategories had already copied verbatim and household-migrations had
reimplemented with small variations; two more copies is pure upkeep cost with
no behavioral value. `cleanupDisposableDatabase`'s retry-after-terminate
sequencing is a real, independently tested behavior difference from the shared
harness's `dropDisposableDatabase` (optimistic drop first, retry only on
failure, vs. terminate-then-drop-once) — merging it into the shared module
would change drop behavior for every consumer (subcategories,
household-migrations, wallet-lifecycle) as a side effect of a dedup pass, so
it was left alone rather than folded in unreviewed.

**If changed:** Adopting the shared harness's drop strategy for
household-migrations means either enhancing `dropDisposableDatabase` in
`disposable-database.ts` with the retry-on-failure behavior (verified against
all three consumers) and moving `cleanupDisposableDatabase`'s two dedicated
unit tests to target the shared function, or accepting the loss of that retry
path. Either call should happen as its own reviewed change, not silently.

## 2026-09-11 — The authenticated finance app gets a Home orientation surface and a transaction-first Wallets workspace

**Decision:** The approved visual direction is a calm, practical financial
workspace. Authenticated navigation begins at a bounded Home surface that shows
orientation, active wallet balances, and recent activity, while Wallets remains
the primary place to read and record the full journal. The redesign changes only
presentation and route composition: existing protected commands, typed gateways,
derived balance rules, and archive behavior remain authoritative. Reports stays
out of primary navigation until a real, approved feature exists.

**Why:** The existing UI presents every feature as a dense ledger/admin surface,
with heavy borders, oversized headings, placeholder-like navigation glyphs, and
no clear daily entry point. A small Home surface provides orientation without
inventing reporting; a transaction-first Wallets page keeps financial work close
to the verified ledger behavior.

**If changed:** Making Wallets the default instead removes the Home route but
does not alter the shared visual system. Adding charts, budgets, search,
notifications, or reporting requires a separate product and data-contract
decision; they are not cosmetic additions to this redesign.

## 2026-09-11 — Account, household, onboarding, and auth share the workspace presentation language

**Decision:** Household headers, required onboarding, authentication, loading,
and configuration states use the same calm paper/surface and dialog treatments
as the authenticated workspace. Authentication remains a clear bounded surface,
not a separate full-screen promotional card. Backup readiness stays available in
the Account menu but is collapsed as operator-only detail by default.

**Why:** These states are part of one financial product and should not interrupt
the working model with a different visual system. The backup warning is
important but does not belong in the normal task hierarchy for every user.

**If changed:** Restoring a distinct auth treatment is presentation-only as
long as email/password autocomplete, confirmation/resend, and session-state
contracts are unchanged. Promoting backup readiness into primary navigation
requires a product decision about user-facing operational status and ownership.

## 2026-09-12 — Preserve nested loan focus and fit the financial workspace to its containers

**Decision:** Keep the loan detail mounted but hidden and without its keyboard
listener while repayment, monthly-target, or correction dialogs are active.
Closing the child restores its actual action; closing the detail restores its
list opener. If a successful mutation removes that action, focus falls back to
the detail panel. Home receives its own wrapping header and spaced journal
rows. The narrow Wallets balance folio stacks wallet identity above the amount.
The rail add-space action uses light text on the rail and dark text on hover.

**Why:** Browser QA reproduced mobile Home overflow/action interception,
detached nested-dialog openers, touching journal text, colliding LBP balances,
and a 1.48:1 rail action contrast ratio. Dedicated browser geometry/contrast
checks and retained focus regressions now detect these failures. Unit coverage
also asserts one exposed dialog, child Tab containment, opener identity, and
two-level Escape return.

**If changed:** Recreating the detail requires an explicit stable focus target
and preservation of the original list opener. A side-by-side balance layout
must prove separation at its actual folio width in both languages. No financial
command, gateway, derived-state, archive rule, or dialog copy changes are needed.

## 2026-09-12 — The workspace rail is compact, light neutral, and mint-selected

**Decision:** Replace the dark full-height rail with the approved light neutral
rail, dark-green navigation text, and a mint active destination. Tighten the
shell's logo, space switcher, navigation, page-header, and control spacing on
the shared 8px rhythm. Use restrained mint, peach, and soft-blue content accents
rather than a blanket dark theme.

**Why:** The previous redesigned shell retained too much visual weight and
empty space. The selected light-and-mint direction is visibly distinct while
keeping a finance workspace calm, readable, and compact.

**If changed:** A dark rail or a more expressive palette is a visual-system
decision and must be reviewed across desktop, mobile, and Arabic RTL. This
decision does not authorize changes to routes, financial behavior, data, or
archive flows.

## 2026-09-12 — Journal discovery and portability remain bounded to loaded, authorized history

**Decision:** Search, wallet/event filters, and CSV export operate only on the
already loaded journal entries for the selected space. The journal reads the
existing immutable `financial_events.actor_id` through its member-only RLS
projection; it labels the current actor as “You” and otherwise shows the
authorized actor UUID. It does not join `auth.users`, expose email addresses,
or add a privileged identity lookup.

**Why:** The current journal gateway has bounded pagination and an existing
member-only RLS boundary. Client-side discovery/export keeps that boundary
intact and makes its scope explicit rather than issuing an unbounded export
query. Actor IDs are durable event provenance, whereas member profile display
names are not an approved data contract.

**If changed:** A full-history export needs a separately reviewed bounded
server-side export contract. Human-readable household identities require an
explicit profile/privacy schema and an RLS-tested member-only projection; it
must not read `auth.users` from the browser.

## 2026-09-12 — Monthly budgeting is a planning ledger, not a money ledger

The first monthly-budget database boundary stores planned income and expense-category
allocations as immutable, request-idempotent revisions. It intentionally does not create
financial events, wallet movements, or loan postings. Current values resolve by revision
identity rather than timestamp; per-currency left-to-allocate subtracts category targets
and the existing monthly loan reservation from planned income. If a later product decision
needs actual-spend reporting or UI editing, it must extend the read projections/gateway
without granting direct writes to plan or financial-history tables.

## 2026-09-12 — Quick Entry reuses only reviewed, active transaction context

**Decision:** Quick Entry opens an editable transaction draft. The normal entry
action remembers the latest eligible expense wallet and active category but
leaves amount and payee empty. “Repeat as new” copies an eligible income or
expense event’s wallet, active category, payee, and exact minor-unit amount
into a new draft; it never posts or reuses the old request ID. A typed payee
suggests a category only when two of that payee’s last three eligible entries
agree, and the member can replace the suggestion before review. Archived
categories and reversed, loan-linked, and non-general events are excluded.

**Why:** Repetition removes daily-entry friction without allowing a remembered
choice to become an unreviewed posting. The 2-of-3 threshold keeps the visible
payee rule predictable while avoiding a single accidental category change.

**If changed:** Persisting preferences beyond the loaded bounded journal,
auto-posting, or supporting transfers as repeatable requires a new product and
ledger-safety decision. Changing the agreement threshold requires corresponding
unit coverage for the new history rule.

## 2026-09-13 — Future planning is a documented proposal with isolated implementation packets

**Decision about this session's scope:** Produce documentation only for the
owner's brainstorming request: percentage income allocation, actual-spending
comparisons, short-/long-term goals and milestones, and the remaining roadmap.
The entry point is [the future-planning master](product/2026-09-13-future-planning-master.md).
No application implementation, SQL application, seed data, push, deployment or
external communication is authorized by this document.

**Proposed defaults, not approved product changes:** Per-space, per-currency
percentage policies use integer basis points and expected net income. Saved
month snapshots retain mappings and exact monetary allocations. Root categories
roll up children once. Goals use a separate non-posting earmark history with
current cash coverage; short-term means a deadline within 12 months of goal
creation, long-term later, and no deadline is open-ended. Monthly contributions
and milestone checkpoints never create income or expense. No automatic
rollover, auto-posting, mandatory category seeds or chart dependency is selected.
Existing explicit gateway parsers remain the default; adopting a validation
package is a separate dependency decision.

**Why:** The earlier roadmap named goals and an editable percentage lens but
did not specify the financial semantics a smaller implementation model needs.
Separating database, gateway and UI packets preserves verified journal and
authorization boundaries. Current source now contains monthly plan and report
SQL, so future work must verify and extend it rather than recreate it from a
stale missing-feature list. V0 names reproducible checks, not confirmed live
defects; this documentation session did not run database or live-product tests.

**If the owner chooses differently:** Received-cash-only allocation adds explicit
funding batches; binding savings holds require a new posting architecture;
per-member private plans require a new RLS contract; child-level budgets require
an anti-double-counting rule; automatic rollover requires signed carry and
restatement history. Revise the affected proposed specification before its
packet is requested. This entry does not retroactively approve any of them.


## 2026-09-13 — Convert the future roadmap into separate executable task files

**Scope:** The owner explicitly requested actionable Markdown for a smaller
implementation model, especially SQL. Created the execution pack at
[future-planning/00-start-here.md](superpowers/plans/future-planning/00-start-here.md)
and mapped all39 roadmap IDs. This remains documentation-only work. No runtime
code, applied migration, account seed, deployment or external delivery was performed.
A task file is a proposed implementation contract, not evidence its feature exists.

**Documented defaults/refinements:** New planning commands serialize per space,
recheck membership after locking, replay actor-owned receipts before stale-head
validation, and publish complete immutable snapshots with declared child counts.
Group definitions belong to template snapshots; milestone definitions belong to
goal snapshots. Funding-head hashes include financial reversals. Goal earmarks
are advisory claims, never protected wallet balances. Recurring occurrence identity
is schedule+due date, independent of definition revision. Settlement/goal links
consume an expense once; refunds restore linked goal funding without fictitious
contributions. Available cash removes overlap between budgeted bills and earmarks.
Export manifests capture payloads in one statement snapshot; month closes freeze
totals and detect later fact changes by digest. Rollover is explicit and signed.
Fixed CSV template has nine columns; quick text is a deterministic reviewed draft.

**Why:** The previous coarse packets left enough schema, replay, rounding,
concurrency and integration decisions open that a smaller model could implement
plausible but inconsistent money behavior. Separate DB/gateway/UI steps, real
rejection fixtures, exact helper examples and stop/commit boundaries make the
repository the resumable handoff. Existing source-present features get a
verification task instead of duplicate implementations. Provider/domain-dependent
features get bounded evidence tasks with missing inputs stated, not invented rules.

**Exceptions made explicit:** Operational export/recap queues have constrained
mutable lifecycle/cleanup rather than financial-history immutability. Recap may
need a narrow NOLOGIN worker capability role, never a broad app-owner role. No
real sending follows from queue implementation. Interest, savings circles,
settle-up and valuation policies still need their named factual inputs.

**If the owner chooses differently:** Change the affected task contract before
its layer begins, including numerical fixtures, relational invariants, public
RPCs, typed DTOs and downstream comparisons together. Binding holds require a
posting architecture change; alternate pay/bill/savings ownership rules require
new deduplication examples; arbitrary import formats require mapping evidence.
Keep already-applied migrations forward-only. Current validation is documented
in [the plan-pack review](verification/future-planning/plan-pack-review.md);
parser/helper checks are not PostgreSQL integration or live-product proof.

## 2026-09-13 — Carry-over concerns are independent future packets

**Decision:** Keep the reporting `currency` ambiguity, direct journal currency
filter, sheet focus containment, i18n consolidation, and planner-statistics
failure as explicitly named future work. Reporting starts with a real-engine
reproducer and adds a timestamped forward migration only if the ambiguity is
confirmed. Journal filtering is an extension of the bounded search contract,
not a client-side loaded-history filter. Focus containment and translation
consolidation are separate shared-UI packets. The planner failure is diagnosed
against its old-main baseline and fixed for determinism, not skipped or waived.

**Why:** These items span database correctness, search semantics, accessibility,
shared UI infrastructure, and test reliability. Combining them would obscure
which gate failed and risks changing UAT-frozen behavior under unrelated work.

**If changed:** A request to fix any item immediately still starts with its
packet's red reproduction and affects only that packet's declared layer. A
decision to accept a known failing DB gate requires an explicit replacement
completion rule; it is not implied by this planning record.

## 2026-09-13 — Plan a private-account Claude/Codex connector for later

**Scope:** The owner requested a future plan for entering personal Budget records
from Claude/Codex. Saved [MCP1](superpowers/plans/2026-09-13-private-account-mcp-connector.md)
and linked it from the roadmap/index. This is documentation only; it authorizes
no implementation, infrastructure, account connection, live posting or deployment.

**Proposed defaults:** One existing personal space per revocable client grant;
income/expense only; minimum wallet/category context; optional category, payee
and note; exact USD/LBP minor-unit strings. A remote MCP service prepares durable
drafts and returns receipts. Budget's authenticated review screen approves the
exact payload through an atomic wrapper around existing financial commands.
The connector runtime role cannot post, approve, execute arbitrary RPCs or write
financial tables. M0 must establish client compatibility and the vetted
authorization-to-database identity mapping before executable auth/SQL packets.

**Why:** This captures the requested integration without interpreting the older
AI deferral as a permanent ban or silently enabling an autonomous account agent.
Owner-session review makes approval independent of a model-supplied flag; durable
requests/receipts prevent duplicate expenses after retries or response loss.
It remains independent of goals, future POS integration and public SaaS work.

**If the owner chooses differently:** Conversation-only approval requires a
verifiable approval contract for each selected client before enabling posting.
Household or multiple-space access changes consent and authorization tests;
transfers/loans/corrections require additional individually classified tools;
history/balance reporting needs separate scopes. A local-only adapter changes
installation and supported surfaces. Proposed 10-minute draft expiry, payload
cleanup within 24 hours, 10,000 receipts per grant and receipt retention through
30 days after revocation are M0 policy defaults, not existing runtime behavior.

## 2026-09-13 — Archive source-delivered plans without promoting release status

**Decision:** Move the 18 plan documents with implementation evidence reachable
from `main` to `docs/superpowers/plans/archive/2026-09-source-delivered/` and
use `docs/superpowers/plans/README.md` as the current selectable-work index.
Keep deployment, UAT, future-planning, and MCP evidence work outside that
archive. The archive label means source delivery only; it does not collapse
source, migration, hosted deployment, authenticated UAT, and product acceptance
into one status.

**Why:** Historical unchecked checklists were obscuring the executable roadmap
even where their code and focused verification commits had long been merged.
Separating them makes the next packet unambiguous while retaining the full
historical instructions and evidence commits for regression work.

**If changed:** A later failure starts a new current-source verification/fix
packet. Restoring an archived document to the active index requires evidence
that its implementation boundary is genuinely unfinished, not merely that a
later deployment or acceptance gate remains open.

## 2026-09-13 — Live migration journal extends to the 38-migration release

**Decision:** Daniel explicitly approved extending the forward-only, hash-pinned
migration journal from 33 to 38 migrations, adding financial event notes and
payees, USD-to-LBP exchange, monthly budget planning (plus its row-shape
hardening), and reporting read models. `ops/budget-migrations.sha256` and
`scripts/ops/apply-live-migrations.sh` (`LIVE_MANIFEST_SOURCE_SHA`, the exact
`supabase_migrations.schema_migrations` array, and one new `to_regclass`
sanity check on `public.monthly_budget_plan_revisions`) are retargeted to
source commit `e2764f084dd9b364daba24b7bde36c6dac8b1a1b` — the tip commit that
touches `supabase/migrations` for this batch and is an ancestor of `main`.
`tests/ops/migration-manifest.test.ts` and `tests/ops/live-migrations.test.ts`
were updated to match. This commit only reconciles the local gate; it does not
itself run `pnpm migrate:live` against the live `Budget Production` project
(`hqblhzqitrbvpyoxtmew`), which still requires a human to supply a Supabase
personal access token, database password, and the exact typed confirmation
interactively.

**Why:** These 5 migrations were merged into `supabase/migrations` on
2026-09-12 without a corresponding manifest update, leaving `pnpm check` red
(`tests/ops/migration-manifest.test.ts` failing) and the live runner unable to
apply them (its own manifest/project/branch gates would otherwise refuse).
Reconciling the pinned manifest is the documented prerequisite from the
2026-09-10 and 2026-09-11 entries above before any live application.

**If changed:** Any further migration, additional schema check, restored
source database, imported data, or expanded journal requires a new review and
explicit owner approval, plus a matching update to this manifest and the two
ops tests, mirroring this same procedure.

## 2026-09-14 — Reporting foundation was unexecuted; task 02 fixes it forward

**Decision:** The three `report_*` functions added by
`20260912102000_reporting_read_models.sql` had never been exercised against a
real PostgreSQL engine before this session and did not run at all:
`report_monthly_cash_summary` failed its own RETURNS TABLE contract
(`sum(bigint)` yields `numeric`), and `report_category_actual_vs_budget`
failed on every call, twice over (its `currency` OUT parameter is ambiguous
against a bare column reference in its own query, and it is `SECURITY
INVOKER` reading a table with all privileges revoked). Both functions also
re-negated an already-correctly-signed reversal movement, doubling a reversed
income/expense instead of netting it to zero. `monthly_budget_category_page`
accepted a `created_at` cursor it never returned, making pagination
unusable, and had no root-only guard on monthly budget targets despite the
subcategory model requiring one.
`supabase/migrations/20260914090000_planning_projection_contracts.sql` fixes
all of the above via `CREATE OR REPLACE` (no prior migration edited): corrects
the sign and bigint-cast defects, converts `report_category_actual_vs_budget`
to `SECURITY DEFINER` with the same authenticated-only grant boundary, adds a
root-only trigger plus an application-level check on
`monthly_budget_plan_revisions`, and adds `monthly_budget_category_page_v2`
(returning its cursor timestamp as `text`, since a JS client's `Date`
round-trip truncates `timestamptz` to millisecond precision and can
duplicate/drop rows across a page boundary) while leaving v1 for existing
consumers. Full evidence: `docs/verification/future-planning/02.md`.

**Why:** `docs/superpowers/plans/future-planning/02-reporting-verification.md`
requires proving these paths in real PostgreSQL before new budgets depend on
them, precisely because a migration having applied is not evidence it runs
correctly. None of these defects could have been found without a real
engine: they are runtime/type-checking failures, not migration-apply-time
syntax errors.

**If changed:** A new `financial_event_kind` value must be added to the
literal classification map in
`tests/db/planning-projections.integration.test.ts` before it is used in
reporting. `monthly_budget_category_page` (v1) is unchanged and still used by
any existing caller; a UI/gateway migration to v2 is a separate, later
packet. The full 15-file `tests/db` suite could not be run to completion in
this sandboxed session (stalled after `household-membership.integration.test.ts`
on real network latency, not a code fault); that file's one pre-existing,
unrelated failure (`uses the selective membership and invitation indexes
after representative ANALYZE`) is not fixed here and needs a session with
reliable full-suite network access.

## 2026-09-14 — Planning command foundation adds a shared lock ahead of existing advisory locks

**Decision:** Added shared, not-yet-called-by-any-command infrastructure for
future planning commands per
`docs/superpowers/plans/future-planning/03-planning-foundation-db.md`:
`private.planning_minor`/`planning_fingerprint`/`planning_replay`/
`planning_child_request`, the append-only `public.planning_command_receipts`
table (RLS enabled, no API write policy, all direct table/sequence privileges
revoked, an owner-only `SECURITY INVOKER` insert guard, and a statement-level
immutability trigger), and the read-only `public.find_planning_command`
lookup (execute granted to `authenticated` only, returns only the caller's
own receipt). `private.set_monthly_budget_plan` was redefined, unchanged
except for one new `perform private.lock_planning_actor(p_space_id);` call
taking the `public.spaces` row lock before its two existing advisory locks.
Full evidence: `docs/verification/future-planning/03.md`.

**Why:** Later planning commands (allocation, goals, recurring obligations)
need one shared idempotency/authorization boundary instead of each
reinventing fingerprinting and replay, and `01-sql-contract.md`'s lock
protocol requires the space row lock ahead of any advisory lock so a future
publish wrapper can hold one space lock across several planning writes
without inverting lock order. Proved with `orderedAuthenticatedRace`: an
income-plan write and an expense-category-target write for the same space
use different existing advisory-lock keys, so nothing serialized them before
this change.

**If changed:** No command writes through `planning_command_receipts` yet —
the first command that does must reuse `private.planning_replay`/
`private.lock_planning_actor` rather than re-implementing fingerprinting, and
must not create a public "insert receipt" RPC (only a domain command may
write one, after its own validation). Changing `private.planning_child_request`'s
digest/encoding after any wrapper can have outstanding requests would break
existing pending idempotency keys.

## 2026-09-14 — Live migration journal extends to the 40-migration release (deploy pending)

**Decision:** Daniel reproduced a live Home-page failure ("Could not load the
latest data.") by signing in to the local dev shell (which talks to the real
`Budget Production` project) with his own account. Network capture showed
`report_monthly_cash_summary` and `report_category_actual_vs_budget` both
returning HTTP 400 from PostgREST — the exact two functions task 02 proved
broken and fixed in `20260914090000_planning_projection_contracts.sql`, which
had never been deployed. `ops/budget-migrations.sha256` and
`scripts/ops/apply-live-migrations.sh` (source SHA, one new
`to_regclass('public.planning_command_receipts')` check, and the exact
`schema_migrations` array) are retargeted to source commit
`a1346ce0f406deb36fe8778f5e2e47c0af3312e3` to include both the task 02 fix and
task 03's foundation migration (38→40). This commit only reconciles the local
gate; it does not run `pnpm migrate:live`.

**Also corrects the record:** `docs/financial-command-inventory.md`'s task-02
claim that "no application UI entry path calls them yet" was wrong — it was
never checked against `src/`. `src/features/control-room/routes.tsx`'s Home
destination has called both functions on every load via
`supabase-reports-gateway.ts` and `insights-client.ts` since before task 02;
that is exactly why the broken pre-fix functions surfaced as a visible,
reproducible bug in production rather than staying latent.

**Why:** The two functions were fixed locally but the fix sat undeployed;
production kept executing the pre-fix, unusable versions on a UI path real
users hit on every sign-in.

**If changed:** Deploying requires Daniel to run
`set -a && source .env.ops.local && set +a && scripts/ops/docker-ssh-bridge.sh run -- pnpm migrate:live`
himself (Supabase PAT/DB password prompts; Claude does not and will not enter
credentials). Any future planning-foundation packet must check `src/` for
existing UI/gateway consumers before claiming a command is unused — this is
now a standing lesson, not just this incident.

## 2026-09-14 — Add a read-only live-migration drift check, not an auto-deploy

**Decision:** Added `pnpm check:live-migration-drift`
(`scripts/ops/check-live-migration-drift.sh` +
`scripts/ops/check-live-migration-drift.mjs`), a read-only sibling of
`apply-live-migrations.sh` that compares `supabase/migrations/*.sql` against
`supabase_migrations.schema_migrations` on the live `Budget Production`
project and reports every version present on only one side. It runs the same
exact-project verification and credential prompts as the live migration
runner, but issues no write of any kind: no `db push`, no dry-run, no backup,
no typed confirmation, because nothing here can change the database. It is
**not** wired into `pnpm check` or any CI/build step — it needs the same
Supabase PAT and DB password as `migrate:live` and is meant to be run
on demand (`set -a && source .env.ops.local && set +a && pnpm check:live-migration-drift`,
inside `scripts/ops/docker-ssh-bridge.sh run --` if the local Supabase CLI
needs it) or from a future scheduled job that has those secrets.

**Why:** Daniel asked for "SQL sync" after task 02's fix migration sat
undeployed for a day and broke the Home page in production before anyone
noticed. Auto-deploying migrations on merge was explicitly declined — it
would remove the manual PAT/password/typed-confirmation gate this repo
deliberately built, and directly contradicts this repo's own global rule
that migrations are "never auto-pushed to a database." A read-only detector
gives the same visibility without an unattended write path to production.

**If changed:** Wiring this into an actual scheduled job (so it runs without
a human present) requires storing the Supabase PAT and DB password as CI/job
secrets — a separate, explicit decision with its own review, not implied by
adding this script. Any new column this check should also assert on
(currently only `schema_migrations.version`, not file hashes) needs a
matching update to `check-live-migration-drift.mjs`'s tests.

## 2026-09-14 — Allocation schema lands with two Postgres naming/scoping gotchas fixed

**Decision:** Added the task 04 allocation schema (8 tables: groups,
versioned templates + lines + root mappings, and immutable monthly snapshots
+ groups + roots + loan-pool commitments) with two deferred cross-row
validation functions, per
`docs/superpowers/plans/future-planning/04-allocation-schema-db.md`. Full
evidence: `docs/verification/future-planning/04.md`. Two non-obvious defects
were found and fixed while building the real-Postgres test suite (not
present in the task's own given DDL/logic — both are naming/scoping
mechanics I introduced while implementing it):

1. `CREATE CONSTRAINT TRIGGER <name>` registers a `pg_constraint` row under
   that same name. Two of my chosen trigger names collided with Postgres's
   own auto-generated name for a two-column `CHECK` on the same table
   (`allocation_template_lines_check`, `allocation_month_groups_check`).
   Renamed every constraint trigger with a `_publish_check` suffix.
2. `SET CONSTRAINTS ALL IMMEDIATE` switches the deferral *mode* for the rest
   of the transaction, not just a one-time check — an unrelated later insert
   in the same transaction then fires its own deferred trigger immediately,
   before its children exist. Test helpers now re-issue
   `SET CONSTRAINTS ALL DEFERRED` immediately after every forced check.

**Why:** These are exactly the class of defect `01-test-recipes.md`'s
red/green mechanics and deferred-constraint guidance exist to catch — neither
is a migration-apply-time syntax error, both only surface when real rows are
actually inserted and checked.

**If changed:** No public command writes through this schema yet (task 05).
Any new table added to this family must reuse `private.planning_guard_insert()`
/ `private.planning_reject_mutation()` (task 03) rather than new per-table
guard functions, and any new deferred constraint trigger name must avoid the
`<table>_check` / `<table>_<single-column>_check` auto-naming pattern
Postgres reserves for unnamed CHECK constraints on that same table.

## 2026-09-14 — Allocation commands land; a deferred-trigger security gap in task 04 surfaces and is fixed forward

**Decision:** Added `private.allocate_planning_income` (exact largest-remainder
apportionment), `public.save_allocation_template`, and
`public.publish_allocation_month` per
`docs/superpowers/plans/future-planning/05-allocation-commands-db.md`. Full
evidence: `docs/verification/future-planning/05.md`. Building the real
command path (not task 04's owner-seeded test rows) surfaced that task 04's
seven deferred-trigger adapters were `SECURITY INVOKER`: a deferred
constraint fires at COMMIT, after any `SECURITY DEFINER` caller has already
returned, back under the plain session role — which has no `EXECUTE` on the
revoked `check_allocation_template`/`check_allocation_month`. Fixed with
`CREATE OR REPLACE FUNCTION` on all seven adapters (now `SECURITY DEFINER`);
`20260914110000_allocation_schema.sql` is not edited. Also strengthened
`private.check_allocation_month` (task 05's own item 5) to compare exact
per-group apportionment output, not just the aggregate sum — which in turn
required correcting three of task 04's own tests that had declared a
`group_count` inconsistent with their fixture template's real one-group
shape (the old sum-only check never noticed; the new exact check correctly
does).

**Why:** `01-sql-contract.md`'s "Required SQL evidence" list exists precisely
to catch defects like this — a `SECURITY DEFINER` privilege boundary that
looks correct until exercised through the specific caller shape (a real
command called by an ordinary authenticated session, not a raw owner insert)
that production will actually use.

**If changed:** Any future deferred-constraint trigger whose adapter calls a
restricted-`EXECUTE` check function must itself be `SECURITY DEFINER`, not
`SECURITY INVOKER` — verified by testing through the real `SECURITY DEFINER`
command, not just owner-seeded fixture rows (owner-seeded rows hide this
exact class of bug, as task 04's own test suite did). No UI/gateway calls
either new command yet (checked against `src/`, not assumed) — task 06 adds
the read-model projections these commands feed.

## 2026-09-14 — Allocation projection read-model lands per task 06

**Decision:** Added `private.planning_ordinary_activity` (the exact given
canonical ordinary-activity SQL, wrapped with membership and a 1–366-day
range check) plus four public read contracts —
`public.allocation_month_state`, `public.allocation_category_page`,
`public.allocation_history_page`, `public.allocation_trend` — per
`docs/superpowers/plans/future-planning/06-allocation-projections-db.md`.
Full evidence: `docs/verification/future-planning/06.md`. Two real defects
surfaced only once the functions were exercised through disposable-Postgres
tests, not by re-reading the plan's own SQL:

- Postgres has no built-in `max()`/`min()` aggregate for the `uuid` type.
  `allocation_category_page`'s next-cursor computation originally used
  `max(root_id) filter (...)` to pick the last-returned row's UUID cursor;
  fixed by restructuring the pagination query around a `numbered` CTE and
  plain scalar subqueries (`(select root_id from numbered where rn =
  p_limit)`, `exists(...)` for `hasMore`) instead of aggregating a UUID
  column at all.
- `SET statement_timeout='10s'` was added to all four public functions per
  the task's own Task 2 preamble ("All reads ... `SET
  statement_timeout='10s'`"), matching the pattern task 03 already
  established (`set search_path=... set statement_timeout='10s'`), which the
  first draft of this migration had omitted.

Design choices made where the task's prose was under-specified (validated
against Task 3's fixture, not assumed): `ownDebtPaidMinor`/
`remainingDebtMinor` are always a **live** read via
`loan_monthly_currency_summary` at the currently-viewed month, independent of
`hasPlan`; a `future`-purpose group's `actualMinor` is always its snapshot's
own stored `allocation_month_commitments.observed_actual_minor` (the amount
observed at publish time), never live loan activity, so it cannot silently
drift after publish; `leftToAllocate`'s "standalone debt commitment" and
"future excess" terms are mutually exclusive per snapshot, matching the
schema's own one-row-per-snapshot `allocation_month_commitments` shape
(`group_id is null` selects exactly one branch).

**Why:** `01-sql-contract.md`'s required-evidence discipline exists exactly
to catch a builtin-aggregate gap like the `uuid` one above — it reads as
valid SQL and would only fail at the first real page-2 request in
production, not at `CREATE FUNCTION` time (Postgres does not validate a
`plpgsql` function body's inner SQL until it first executes a given branch).

**If changed:** Any future paginated read contract that carries a `uuid`
(or other type without a builtin min/max aggregate) cursor must extract the
boundary row via a scalar subquery ordered by the cursor column, never
`max()`/`min()` on that column directly. No UI/gateway entry path calls any
of the four new functions yet (checked against `src/`, not assumed) — task
07 (gateway) and task 08 (setup/charts UI) are separate, later packets.

## 2026-09-14 — Allocation gateway lands per task 07; a fake-timer/React combination is dropped as a test hazard, not a product defect

**Decision:** Added the typed allocation application boundary per
`docs/superpowers/plans/future-planning/07-allocation-gateway.md`: shared
transport (`src/features/planning-shared/rpc.ts`, a 15-second abortable RPC
wrapper) and parsers (`parse.ts`); the pure `allocateIncome` apportionment
helper (`src/features/allocation/money-allocation.ts`, ported verbatim from
the task's exact implementation); DTOs (`types.ts`); the Supabase gateway
(`supabase-allocation-gateway.ts`) mapping camelCase inputs to
`p_snake_case` RPC args and validating every response field explicitly; a
state-machine hook (`use-allocation.ts`) with the required
loading/ready/saving/accepted-refresh-pending/ambiguous/error status union;
an in-memory test fake; and an error classifier
(`errors.ts`) covering every SQLSTATE/message token from tasks 03–06's own
error table plus the domain-specific `P0001` messages `save_allocation_template`/
`publish_allocation_month` raise. `src/lib/supabase.ts`'s `BudgetDataClient`
now also intersects `AllocationDataClient`. Full evidence:
`docs/verification/future-planning/07.md`.

Mutation reconciliation reuses the wallets feature's ambiguous/ready-to-retry
shape (`src/features/wallets/use-wallets.ts`), but is simpler: because tasks
03/05 gave every allocation command a real idempotent receipt
(`public.planning_command_receipts`, looked up by `find_planning_command`),
reconciliation after a timeout-shaped failure is an exact
`(space,request,actor)` lookup, never wallets' heuristic match-by-business-
fields. An explicit user-initiated `retryAmbiguous()` re-issues the identical
request id/payload rather than auto-retrying, matching `01-sql-contract.md`'s
"never auto-retry... with a fresh request UUID" (the SAME id is safe and
required here, by design, since it replays instead of reposting).

One test in the plan's own Task 3 recipe — re-driving the real 15-second
`AbortController` timeout through `renderHook` + `vi.useFakeTimers()` — was
written, then dropped after it reproducibly crashed the vitest worker with an
out-of-memory abort in this sandbox (confirmed via a minimal, unrelated
`renderHook`-plus-fake-timer repro that did *not* crash, isolating the cause
to this specific combination: real `AbortController`/`AbortSignal` event
dispatch plus fake timers plus React's effect scheduler, not a defect in
`use-allocation.ts`, `rpc.ts`, or the removed test's own gateway fake). The
15-second timeout itself is proved once, in isolation, by
`planning-shared/rpc.test.ts` (fake timers, no React); the hook's
ambiguous/retry state machine is proved end-to-end by two other
`use-allocation.test.tsx` tests using a synthetic timeout-shaped rejection
instead of a real armed timer, exercising the identical `reconcileCommand`
code path.

**Why:** A test that reliably crashes the runner is worse than no test: it
would either be skipped by a future session (silently losing its coverage
signal) or block the whole file's suite from reporting real regressions
elsewhere in the same run, exactly what happened here (11 of 12 tests were
starved of a result on every attempt). The two-layer split (transport-level
timeout in isolation; hook-level reconciliation with a synthetic rejection)
preserves full coverage of both halves without the hazardous composition.

**If changed:** If a future session needs to re-attempt this exact
end-to-end shape, budget time to root-cause the jsdom/fake-timer/
AbortController interaction first (not just retry variations of the test),
or use `vi.setSystemTime`/manual `Date` stubbing instead of
`vi.useFakeTimers()` for the `setTimeout` in `rpc.ts` specifically. Task 08
(allocation UI) is a separate, later packet; this commit stops before it.

## 2026-09-14 — Allocation UI lands per task 08, completing Release 1

**Decision:** Added the allocation human flow per
`docs/superpowers/plans/future-planning/08-allocation-ui.md`:
`chart-ratio.ts` (exact given `chartPercent`), `allocation-bars.tsx` (an
accessible `<table>` chart — real semantic table plus a CSS-only responsive
"stacked card" layout under 420px, since Playwright's `expectContainedControls`
caught the desktop table layout genuinely overflowing the 390px mobile
viewport on first e2e run), `allocation-overview.tsx`, `allocation-month-editor.tsx`
(manual/percentage mode, live `allocateIncome` preview, client-side
over-allocation guard mirroring the SQL's own check for immediate feedback),
`allocation-setup.tsx` (the orchestrator wiring `useAllocation` to the
overview/editor), and `allocation.css`. Full evidence:
`docs/verification/future-planning/08.md`.

**Placement:** Control Room's Plan route already existed with its own
per-category target editor (`PlanPage`/`usePlan`, predating this roadmap).
Rather than replace it — a redesign decision out of this task's scope per
`00-start-here.md`'s "do not implement that entire redesign as a side
effect" — the new allocation section (one per currency, mirroring the
existing Plan page's own USD/LBP stacking) was added **alongside** it in
`PlanRoutes`. Both now coexist on the Plan screen. Consolidating them into
one coherent editing surface (or deciding the old per-category editor should
be retired once allocation covers its use cases) is an explicit **open
follow-up UX decision**, not resolved here.

**expectedRevisionId for existing category targets:** `allocation_category_page`
(task 06) does not expose each root's `target_revision_id`, so the editor
cannot learn it from the allocation read contracts alone when re-publishing
an already-planned category (required for `publish_allocation_month`'s
per-category optimistic-concurrency check, proven necessary by task 05's own
"stops an old positive target" test, which only works because the test
already held that revision id from calling `set_monthly_category_target`
itself). Resolved without any SQL change: `publish_allocation_month` and the
pre-existing `set_monthly_category_target` both write into the same
`monthly_budget_plan_revisions` table, and the pre-existing, already-public
`monthly_budget_category_page`/`_v2` (task 02) already reads `target_revision_id`
from it. `AllocationSetup` resolves each category's current revision id from
the existing Plan gateway's category rows (already loaded by `PlanRoutes`)
before opening the editor.

**Live-browser verification:** the real Supabase project still has none of
tasks 02–06's migrations deployed (`pnpm migrate:live` has not been run this
session), so both the pre-existing Plan screen and the new allocation
section show their real, honest "could not load" error states against
production today — confirmed by hand in Chrome and unrelated to this
change (the Plan screen's own pre-existing failure, "the database row is
missing name_ar", predates this task and reproduces on `main` before these
commits; not investigated further here as out of Release 1's scope). Full
happy-path verification therefore used `e2e/allocation.visual.spec.ts`
against the project's existing Playwright fixture-server harness
(`e2e/fixtures/loans.ts`, extended with `allocation_month_state`/
`allocation_category_page`/`allocation_history_page`/`allocation_trend`/
`save_allocation_template`/`publish_allocation_month`/`find_planning_command`
route handlers, reusing the real `allocateIncome` helper for a faithful
publish-time apportionment preview) — real Chrome, real bundled app code,
real network layer, fixture data only at the PostgREST boundary. This
exercised the exact plan-pack Task 3 numbers end to end and caught the
mobile overflow bug above on the first run.

**Why:** Every prior task in this roadmap fixed real bugs only by testing
against the real engine/real browser rather than trusting the written code;
this task's mobile-overflow catch is the UI-layer instance of that same
pattern. The placement and expectedRevisionId decisions both favor an
explicit, reasoned default over inventing new SQL or redesigning shared
navigation mid-task, per `00-start-here.md`'s own scope discipline.

**If changed:** A future task should either retire `PlanPage`'s per-category
editor in favor of allocation's manual mode, or make their relationship
explicit in the UI (e.g., link one from the other) — right now a user could
set values in both without a documented reconciliation story. If
`allocation_category_page` later grows a `targetRevisionId` field, the Plan
gateway cross-reference in `allocation-setup.tsx` can be dropped for a
single-gateway read. Release 1 (tasks 02–08: allocation DB layers through
UI) is now complete; task 09 (goal tables) is a new, separate feature.

## 2026-09-14 — Live migration journal extends to the 43-migration release (deploy pending)

**Decision:** Daniel ran `pnpm migrate:live` and the local gate itself
refused with `unmanifested migration file` (exit 79) before any credential
was even used — `ops/budget-migrations.sha256` and
`scripts/ops/apply-live-migrations.sh` were still pinned to task 03's
foundation release (commit `a1346ce`, 40 migrations) and had never been
retargeted for tasks 04–06's three new migration files
(`20260914110000_allocation_schema.sql`, `20260914120000_allocation_commands.sql`,
`20260914130000_allocation_projections.sql`), exactly the gap this repo's
own drift-detection tool (`pnpm check:live-migration-drift`, added in task
05's own packet) exists to catch at review time rather than at deploy time.
Retargeted both to source commit `882703bfd3ae8e8250096f639fbaa38873d8b75c`
(task 06's own commit — the last commit that added a migration file), added
three `to_regclass`/`to_regprocedure` existence checks
(`public.allocation_month_snapshots`, `public.publish_allocation_month(...)`,
`public.allocation_month_state(...)`) representing the three new migrations,
and extended the `schema_migrations` array to all 43 versions. The new
manifest rows were generated with the script's own
`migrate-budget.sh create-manifest` (pure local SHA-256 hashing, no network
or credentials) and verified locally with `verify-manifest` before being
installed, mirroring exactly `ad69c21`'s prior 38→40 release-prep pattern.
`tests/ops/live-migrations.test.ts` and `tests/ops/migration-manifest.test.ts`
were updated to match (43 rows, the new source SHA, the three new checks).
This commit only reconciles the local gate; it does not run
`pnpm migrate:live` and does not touch credentials.

**Why:** Every task in this session's roadmap that adds a migration file
must also extend this manifest/verify-SQL pair in the same spirit as
`ad69c21` already established — tasks 04–06 added their migrations without
doing so, so the very first live deploy attempt after task 06 landed was
always going to fail this gate. Root cause is process, not the gate itself
working exactly as designed (it is why `--is-ancestor` checks and the
"tracked changes forbidden" guard exist: to stop a deploy from running
against a manifest nobody has reviewed against the current migration set).

**If changed:** Any future packet that adds a `supabase/migrations/*.sql`
file must, in the same commit or a same-day follow-up, regenerate
`ops/budget-migrations.sha256` (via `migrate-budget.sh create-manifest`) and
retarget `LIVE_MANIFEST_SOURCE_SHA`/`LIVE_VERIFY_SQL` in
`apply-live-migrations.sh` to the new migration-adding commit — do not defer
this to a separate "release prep" packet as happened across tasks 04–06.
Deploying still requires Daniel to run
`set -a && source .env.ops.local && set +a && scripts/ops/docker-ssh-bridge.sh run -- pnpm migrate:live`
himself; Claude does not and will not enter the Supabase PAT/DB password
prompts.
