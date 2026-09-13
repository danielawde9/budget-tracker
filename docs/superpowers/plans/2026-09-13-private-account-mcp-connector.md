# Private-account MCP connector — future implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` when a later request
> selects a milestone below. Complete milestone M0 before writing the executable
> auth/SQL implementation packets. Each subsequent session owns one named layer.

**Status:** Planned for later on 2026-09-13 at source baseline `27eb525`.
The owner requested this plan, not implementation, connection of an account,
installation, production data entry, or deployment. Defaults below are proposals.

**Goal:** Let Daniel ask Claude or Codex to add an expense or income to his
private Budget account, review the exact entry, and receive a durable receipt.

**Architecture:** A Budget-owned MCP service exposes a small set of authorized
context, draft and receipt tools. The initial proposal uses Budget's authenticated
review screen to approve and post a draft through the existing financial commands.
The connector itself receives no general financial posting capability.

**Tech stack:** Existing TypeScript, Supabase/PostgreSQL, React and Worker
boundaries. HTTPS Streamable HTTP with delegated OAuth sign-in is the proposed
transport/auth direction. SDK, authorization provider and database transport are
selected and pinned only after the M0 compatibility and identity proof.

## Product scope and relationship to the roadmap

This is additional roadmap item **MCP1: private-account Claude/Codex connector**.
It is separate from E5, the in-app bilingual quick-text parser. It does not
depend on goals, allocations, recurring bills, POS integration, or a public SaaS.

The September 11 roadmap deferred an AI assistant/agent acting on accounts.
The owner's September 13 request adds this narrow integration to future planning.
It does not activate unattended posting, an in-app chatbot, or general agent
control over financial accounts. Existing no-auto-posting rules remain in force.

“Private account” means one explicitly selected existing **personal space**, not
all spaces the signed-in person can access. No account email, space UUID or
production secret belongs in this plan or a committed client configuration.

### Proposed first release

- Connect the owner to one personal space; separate revocable grants for Claude
  and Codex. Connection cannot create an account, wallet, category or membership.
- Read that space's active wallet names/currencies and active income/expense
  categories, including root and one-level subcategory identity.
- Prepare one income or expense at a time, with a wallet, exact USD/LBP amount,
  effective date, optional category, payee and note.
- Show the exact draft in Budget, let the owner confirm or cancel, and return
  the saved event ID and posting status to the initiating client.
- Support English and Arabic text in names/notes and in the review interface.
  Client language understanding produces structured tool arguments; the MCP
  service does not run a second LLM or assume inferred values are correct.

Transfers, exchange, loans, reversals, split expenses, budgets/goals, attachments,
batch import, household access, raw SQL, generic RPC calls and background posting
are excluded from this first release. Corrections use Budget's existing reviewed
correction flow. History searches and balance reporting are optional later scopes;
listing wallets must not automatically disclose all balances or transaction history.

## Approaches and proposed default

| Approach | Benefit | Cost / decision |
| --- | --- | --- |
| Remote MCP, drafts with approval in Budget | Shared tool contract; owner approves exact data using an existing authenticated session | Proposed v1; one Budget review visit per entry |
| Remote MCP with approval entirely in the client | Closest to adding an entry entirely from the conversation | Only after the selected clients provide an approval mechanism the server can verify; a model-supplied `confirmed: true` is insufficient |
| Local stdio adapter | Possible development path for selected local clients | Separate installation/credential lifecycle; does not establish compatibility with hosted Claude or all Codex surfaces |

The owner has not yet selected Claude web, Claude Desktop, Claude Code, Codex
desktop, or Codex CLI as the acceptance surfaces. M0 records the exact requested
products and versions; do not assume their transport, account-tier or approval
features are interchangeable. A local adapter is not an automatic fallback that
silently changes the requested experience.

## User flow

1. In the selected client, connect to Budget. Sign in on a trusted Budget/auth
   page; consent names the client, one personal space and the allowed tools.
2. Say, for example, “Add a $20 grocery expense from my USD cash wallet today.”
3. The client resolves names against authorized wallet/category results. If the
   amount, currency, wallet, category or date is ambiguous, it asks for the
   missing value. It never silently picks a different space or creates a category.
4. `prepare_entry` returns a canonical draft and a Budget review URL. Opening
   the URL performs no mutation; link previews and GET requests cannot approve.
5. Budget requires the owner session and displays space, wallet, direction,
   currency, amount, date, category, payee and note. Only an explicit confirmation
   submits it. Any edit creates a replacement draft/revision requiring review.
6. Budget posts atomically, then displays the event receipt. The client can call
   `get_entry_status` to report success. A timeout is “status unknown,” never
   proof that no entry was saved and never permission to generate a new request.

V1 deliberately includes step 5 in Budget. M0 must flag this to the owner when
implementation is requested; if conversation-only approval is required, resolve
its evidence gate before claiming the requested experience is implementation-ready.

## Authorization and privacy contract

- Every tool call verifies a token intended for this MCP resource, then checks
  its live grant, permitted operation and current personal-space membership.
  Identity and space come from verified authorization, never tool arguments.
- Bind grants to issuer/subject, client registration, selected space and explicit
  scopes. Initial scopes: `budget:context:read`, `budget:entries:draft` and
  `budget:receipts:read`. A read-only grant cannot prepare/cancel a draft.
- Revocation blocks subsequent reads/drafts and unposted approvals. Define the
  race: posting and revocation serialize against the same grant; whichever
  commits first wins. Revocation does not undo an already committed expense.
- Keep client access tokens separate from any downstream database identity.
  Do not forward an MCP token to Supabase as an ordinary user token, share an
  app session with the model, or give the connector `service_role`, schema-owner
  credentials, a JWT signing secret, raw SQL, or unrestricted RPC access.
- M0 must prove the precise token-to-database identity mapping. Prefer a vetted
  authorization component; do not invent an OAuth server or trust an unsigned
  subject/`auth.uid()` claim. Connector runtime access must be unable to invoke
  financial commands even if its application-level tool allowlist is bypassed.
- Budget approval uses the existing authenticated owner session, independently
  of the connector credential. SQL rechecks owner, personal space, live grant,
  draft identity and approved payload before calling the protected commands.
- Grant consent must explain that returned context and submitted draft fields
  pass through the chosen AI client. No transcript, bank login, identity document,
  credential or unrelated household data is requested or logged.
- Audit IDs, actor/grant/client, operation, outcome and server time. Store payee,
  notes and money only where needed for private drafts/ledger data, never in
  general logs. Treat stored names/notes as data, not instructions.

The reference direction follows the MCP specification's resource-specific token
validation and authorization discovery model. Its HTTP binding defines Streamable
HTTP and origin validation. These are dated design references, not a compatibility
claim about any installed client: [MCP authorization, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[MCP transports, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
Re-check the chosen protocol revision in M0; reject unsupported protocols and
unapproved browser origins while handling authenticated non-browser clients
according to the selected binding.

## Proposed tool contract

These names describe new tools; none exists in the inspected source.

| Tool | Inputs beyond verified grant context | Result / restriction |
| --- | --- | --- |
| `get_context` | None | Selected personal-space label/ID, supported currencies, allowed operations and grant expiry; no email/token |
| `list_wallets` | Opaque cursor, limit | Active wallet ID/name/currency; balances excluded |
| `list_categories` | `kind: income \| expense`, opaque cursor, limit | Active category IDs, EN/AR names and parent identity |
| `prepare_entry` | `requestId`, kind, walletId, currency, amountMinor, effectiveDate, categoryId or null, payeeName or null, note or null | Durable draft ID, canonical fields/digest, expiry, status and review URL; no financial event |
| `get_entry_status` | draftId **or** requestId, exactly one | This grant's status and immutable receipt if posted; cannot enumerate another client's drafts |
| `cancel_entry_draft` | draftId | Cancel only an unposted draft owned by this grant; never reverse an event |

`amountMinor` is a positive integer **string**. USD `"2000"` means $20.00;
LBP `"20000"` means LBP 20,000. Currency must match the selected wallet.
The server constructs one negative expense or positive income movement using
exact integer arithmetic. The model cannot submit arbitrary movement arrays.
Reject zero/negative amounts, more than 15 digits, decimals in minor units,
unknown fields/enums, malformed UUIDs and invalid dates before persistence.
Dates are explicit `YYYY-MM-DD`; “today” must be resolved and shown using an
explicit user timezone. Record timestamps are generated by PostgreSQL `now()`.

Proposed operational caps: 16 KiB request bodies; 64 KiB responses; list pages
default 20/max 50 with opaque cursor max 1 KiB; payee max 120 characters and
note max 500, further narrowed if current SQL accepts less. One entry per draft,
20 unexpired drafts per grant, 10-minute approval expiry, 60 reads and 10 draft
mutations per minute per grant, with separate bounded unauthenticated/IP limits.
Use a 10-second total upstream deadline; no automatic retry with a fresh UUID.
Caller status checks are capped at three per action before returning pending.
No unbounded scan, in-process approval store, autonomous polling or queue.

## Posting, concurrency and recovery

Existing integration points to inspect again before implementation:

- [Financial command inventory](../../financial-command-inventory.md).
- [Wallet gateway](../../../src/features/wallets/supabase-wallets-gateway.ts):
  posting, descriptive metadata and request reconciliation.
- [Category gateway](../../../src/features/categories/supabase-categories-gateway.ts):
  active category reads and categorized posting.
- [Money helpers](../../../src/features/wallets/money.ts): current currency scale
  and integer conventions; reuse behavior without importing an entire UI module.
- [Worker handler](../../../worker/handler.ts) and
  [Auth gateway](../../../src/features/auth/supabase-auth-gateway.ts): existing
  delivery/session boundaries, not an implemented MCP or delegated OAuth service.

Persist grants, drafts and receipts in a separate connector boundary with
constraints, RLS/privileges and protected commands. Exact SQL is an M0→M1
deliverable, not permission to write a speculative migration from this outline.
No existing applied migration or ledger table contract is rewritten.

Draft payloads are immutable. Proposed terminal states are posted, cancelled,
expired and superseded. A pending draft becomes terminal once; only a posted
draft has an event ID. Expiry remains enforced at approval even if cleanup has
not run. Retrying `prepare_entry` with the same grant/request and payload returns
the same draft/status; changed payload with that key is a conflict.

Approval must use one transaction: serialize grant/draft against revocation and
competing approvals, recheck permissions and current wallet/category state, call
`record_financial_event` or `record_categorized_financial_event`, optionally call
`describe_financial_event`, then link the posted receipt. A new narrow approval
wrapper may compose these existing commands; it must not insert ledger rows itself.
Expose it only to the authenticated Budget review path, never the connector role.
M1 must trace existing lock order before selecting new locks, so composition
does not introduce deadlocks or bypass existing membership/archive protections.

Use stable posting and metadata request IDs derived/stored once per draft.
If any metadata or receipt step fails, roll back the whole transaction. On a
response loss, reconcile the existing draft/receipt and return the same event.
Concurrent confirmation creates one event, one movement and one receipt.
Archived/deleted access, expired/replaced drafts, changed digests and cancellation
win or lose under the same serialized transition; they cannot partly post.

Keep minimal request/digest/outcome receipts for the life of a grant and 30 days
after revocation so response loss does not create a retry ambiguity. Cap each
grant at 10,000 draft receipts; refuse new drafts at capacity. Remove sensitive
terminal draft payloads within 24 hours through bounded cleanup, retaining only
receipt identifiers/digests/outcomes; posted financial metadata follows existing
ledger retention. Store no second copy of the chat. Changes to these proposed
retention/cap defaults belong in the M0 decision record.

## Milestones for a later request

All milestones are pending. Future code steps require their own exact tests,
SQL/API signatures and implementation packets after M0 closes its prerequisites.
This plan records the intended work; it is not a copy/paste SQL implementation.

### M0 — Client compatibility and authorization design (planning/evidence)

**Create later:** `docs/product/evidence/private-account-mcp-compatibility.md`,
`docs/superpowers/specs/2026-09-13-private-account-mcp-design.md`, and separate
implementation packets for the selected M1–M5 layer under this plans directory.
Use the actual implementation date for newly authored follow-up documents.

- [ ] Record exact Claude/Codex surfaces, versions and account availability, plus
  whether Budget-screen approval meets the intended workflow. Keep missing
  client access explicitly unverified; synthetic transport tests do not replace it.
- [ ] Check official client documentation and protocol revision; after choosing
  dependencies, verify pinned APIs with Context7 and license/maintenance/runtime
  fit. Record an evidence matrix for auth discovery, login, scopes, reconnect,
  refresh/expiry, revocation, tool discovery, draft review and receipt recovery.
- [ ] Map the existing verified Budget identity to the connector authorization
  and narrow database role. Prove connector credentials cannot post directly;
  document issuer, audience, keys, token storage/rotation and revocation races.
- [ ] Choose the vetted auth component, Worker/database connection mechanism,
  deployment boundary and bounded storage model. No provider purchase or
  infrastructure provisioning follows from this evidence task.
- [ ] Write exact grants/drafts/receipts schema, ACLs, command signatures, lock
  order and failure contracts, plus the review-screen design and executable
  per-layer test steps. Record defaults and consequences in `docs/decisions.md`.
- [ ] Self-review and commit the documentation. Unverified client/auth identity
  paths remain named prerequisites; do not start dependent auth/SQL work by guess.

### M1 — Connector grants/drafts/approval/receipts (database)

**Own later:** new timestamped connector migration(s),
`tests/db/mcp-connector.integration.test.ts`, command inventory/decisions/evidence.

- [ ] Write red real-PostgreSQL tests for authorization, immutable payloads,
  posting composition and two-connection races from the acceptance matrix below.
- [ ] Implement the reviewed schema and minimal command wrappers, without new
  direct financial writers or changes to ordinary app posting permissions.
- [ ] Prove denial with the connector runtime role even when the MCP handler is
  bypassed; prove SQL isolation when application scope validation is bypassed.
- [ ] Verify empty replay, seeded upgrade, effective PUBLIC/anon/authenticated/
  connector-role permissions and unchanged prior migration digests; commit.

### M2 — Delegated auth and MCP tools (server)

**Own later:** focused modules under `worker/mcp/`,
`tests/worker/mcp/`, minimum `worker/handler.ts` routing changes and configuration
types/examples. Runtime dependency changes require the completed M0 decision.

- [ ] Add failing tests for token validation, grant scoping, unknown tools,
  invalid input, response redaction, expiry, origin rules, limits and deadlines.
- [ ] Implement only the six listed tools over M1's narrow interface; no browser
  user credential capture, generic database proxy, unrelated route refactor or
  hidden financial tool. Mark read/draft effects correctly for client display.
- [ ] Reproduce metadata/discovery, error/status mapping and request recovery
  using deterministic fixtures; preserve invitation-route behavior; commit.

### M3 — Connection management and entry review (application/UI)

**Own later:** `src/features/connections/`, its tests, a narrowly scoped route
registration in the then-current app shell, and `e2e/mcp-connector.spec.ts`.

- [ ] Add tests for connect/consent, selected-space display, grants, disconnect,
  revoked/expired states and exact draft confirmation/cancellation.
- [ ] Implement owner-session approval with anti-CSRF/origin checks, current
  field review and the M1 atomic command. A link or client-provided boolean
  cannot approve. Show an existing receipt after refresh/response loss.
- [ ] Check mobile/desktop and English/Arabic/RTL, accessible labels, `<bdi>`
  around database-sourced strings, long names and all recovery states; commit.

### M4 — End-to-end connector acceptance (verification)

**Create later:** `docs/verification/private-account-mcp-connector.md` and
`docs/operations/private-account-mcp-connector.md` with redacted setup examples.

- [ ] Run the integrated synthetic/real-database matrix, including concurrency
  and disconnected-client recovery. Record exact commands, totals and limitations.
- [ ] Exercise each selected actual Claude/Codex client against a dedicated
  synthetic test account. A hosted endpoint/test account must be separately
  authorized before provisioning; unavailable clients remain Blocked.
- [ ] Document connection/revocation, secret rotation, limits, receipt lookup,
  kill switch and rollback that preserves already-posted history; commit.

### M5 — Owner account activation (separately requested operations)

- [ ] Present the tested build, chosen endpoint, migration/release artifact,
  selected personal-space grant and rollback procedure for the requested release.
- [ ] Only when asked, perform the reviewed deployment and account connection.
  Record deployment and actual-client evidence separately from source/test proof.
- [ ] Never create a sample expense/income in the owner's real account merely
  to demonstrate success. Any real posting requires its own explicit exact entry.

## Minimum acceptance matrix

| Case | Required observation |
| --- | --- |
| Expense fixture: USD wallet starts at `"10000"`; approved expense `"2000"` | One expense movement `"-2000"`; balance `"8000"`; category/payee match review |
| Income fixture: LBP wallet starts at `"100000"`; approved income `"20000"` | One income movement `"20000"`; balance `"120000"` |
| Prepare, open review, cancel or let draft expire | Zero financial events/movements |
| Wrong owner/client/space, household ID, revoked grant, unsigned/wrong-audience token | Denied without leaking records; zero financial changes |
| Connector role calls posting or approval RPC directly | Database permission denial |
| Read-only scope attempts draft mutation; handler skips scope filter | Correct boundary rejects in each separately exercised layer |
| Ambiguous USD/LBP, zero/negative/oversized amount, unknown wallet/category | No draft/posting; field-specific safe response |
| Same request/payload, changed payload with same request, concurrent confirm | Same draft/receipt; conflict; exactly one event respectively |
| Revocation/archive/cancellation races with approval | Serialized documented winner; no partial posting or stale authorization |
| Metadata or receipt failure after attempted posting | Whole transaction rolls back |
| Server restart or network loss after commit | Existing receipt resolves to the same event; no new request ID |
| Malicious instructions in a category/payee/note | Data displayed safely; no expanded scope or extra tool execution |
| Both selected real clients, English/Arabic and mobile review | Connect → prepare → approve → receipt → revoke verified per surface |
| Existing app routes, loans, posting and invitations | Required regression checks pass; no cross-feature behavior change |

Future verification uses the repo's then-current documented commands. Today the
entry points include `pnpm typecheck`, `pnpm test:worker`, `pnpm test:ui`,
`pnpm test:db`, `pnpm build` and `pnpm test:e2e`. Database verification uses the
existing isolated harness and authoritative ignored environment, never a mock
or production database. Run only relevant checks for the selected layer and the
repository's required full gates; documentation validation is not runtime proof.

## Resume prompt

> Plan milestone M0 of `docs/superpowers/plans/2026-09-13-private-account-mcp-connector.md`.
> Keep this session to compatibility/auth design and executable follow-up packets.
> Verify current source and exact requested Claude/Codex clients. Preserve the
> personal-space boundary, explicit review, exact money, narrow connector role,
> existing protected financial commands and idempotent receipts. Record unresolved
> evidence precisely. Do not implement, provision, deploy, connect my real account
> or create transactions as part of the planning task.
