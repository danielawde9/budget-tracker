# Decisions ledger

Append-only project decisions and assumptions. Each entry records what would
change if the decision changes.

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
