# Decisions ledger

Append-only project decisions and assumptions. Each entry records what would
change if the decision changes.

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
