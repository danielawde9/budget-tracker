# Budget MCP connector

Endpoint: **https://mcp.openbudgetracker.app/mcp**.
Worker: `budget-tracker-mcp`. App: `https://openbudgetracker.app`.

## Connect Codex

```sh
codex mcp add budget_tracker --url https://mcp.openbudgetracker.app/mcp
```

Complete OAuth in the browser, sign in to Budget and select the owned space.
The consent explicitly permits direct expense and income saves for 90 days.
If already registered, use `codex mcp login budget_tracker`.
Reload the Codex connection/session if its tools have not appeared.

Examples: “Add a $20 grocery expense from USD Cash today” or “Record $500 income
in Bank today.” A complete instruction is saved directly; missing/ambiguous
wallets, items, dates and amounts are clarified first. The returned entry ID is
the durable receipt. Unfunded expenses use Ready to assign, as in the app.
Disconnect under **Settings → AI connections** to block further operations,
including with already-issued access tokens.

## Tools and retries

- `get_context`: selected space, its clock/timezone, cash wallets and plan items.
- `record_entry`: one income/expense, existing IDs, USD/LBP, exact integer-string
  minor units, explicit date, optional memo and stable request UUID.
- `get_entry_status`: reconcile the original UUID after response loss.

USD `"2000"` is $20.00; LBP `"2000"` is LL 2,000. Never retry with a new UUID
following an unknown result. A not-found receipt can mean a request is still
in flight: only retry the same UUID and payload. A reused UUID with changed
fields is rejected. The API exposes no raw SQL, transfers or account management.

## Operate

```sh
pnpm types:mcp
pnpm typecheck:mcp
pnpm test:mcp
pnpm test:db
pnpm test:ui
pnpm build:cloudflare
pnpm deploy:mcp:dry-run
pnpm deploy:mcp
```

Deploy the additive database migration and app consent screen before enabling
clients. The production migration was applied with the Supabase Management API
and its returned version is the local filename. Existing migration history
contains an aggregate v2 baseline: do not blindly reapply historical migrations.

The Worker's only configured secret is `SUPABASE_PUBLISHABLE_KEY` (the public
browser key). Configure with `wrangler secret bulk <ignored-env-file> --config
wrangler.mcp.jsonc`. `OAUTH_KV` holds library-managed OAuth data and short-lived
pending consents. Never configure a Supabase login token, service-role key,
password or database connection string. Keep `.dev.vars` and `.env.*` ignored.
Native Supabase OAuth and custom token hooks are not needed and remain disabled.

For the pinned Wrangler 4.130 runtime, local development uses
`pnpm dev:mcp --compatibility-date 2026-09-15`; production keeps 2026-10-16.
A different local origin needs a separate development config and frontend;
production consent is intentionally fixed to the two HTTPS sibling domains.

GET `/health` checks Worker availability. GET
`/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server` check discovery. An unauthenticated
POST to `/mcp` must return 401 with a resource-metadata challenge.
No health/discovery check writes financial data.

## Deployment verification — 2026-10-16

- Applied migration: `20261016134130_mcp_connector`.
- Frontend version: `2a8943a1-2a3d-41c2-acb9-b3273602ed11`.
- MCP Worker version: `c6280ee9-c99b-49ec-842c-e36dec627804`.
- Live health and both OAuth discovery endpoints: HTTP 200.
- Unauthenticated MCP: HTTP 401 with resource metadata and scope challenge.
- Codex global server `budget_tracker` registered; owner OAuth sign-in started.
- Verification: 242 SQL tests, 208 UI tests, 5 MCP tests; production build and
  deployment dry runs passed. Independent security review found no blockers in
  the final opaque-token design. User login and a real requested entry remain
  the final acceptance steps; no production financial test entries were made.

## Consent restoration — 2026-10-16

A subsequent app deployment from main omitted the unmerged MCP frontend and
sent `/oauth/consent` to the dashboard. Updated this worktree to `3755355` before
redeploying the combined app, preserving paused-savings funding changes.
Frontend version: `ef689ba7-413d-411f-828a-c4d548e04093`.
Typecheck, nine targeted consent/connection/funding UI tests, and the production
build passed. The MCP source must be included in future frontend deployments.

### Worker transport fix (2026-10-16)

Live authorization diagnostics isolated `STATUS_UNKNOWN` to the outbound fetch:
Workers rejects `redirect: 'error'` with `TypeError: Invalid redirect value`.
The RPC transport now uses `manual`, explicitly refuses 3xx responses without
following their Location, and retains safe phase/status diagnostics. A regression
test reproduces the runtime rejection and verifies redirects are not followed.
Seven MCP tests, Worker typecheck, and deployment dry run pass. Deployed version
`351d7e09-c78c-4a65-b540-b2c8de57f925`. A live invalid-code probe now reaches
Supabase and returns `BUDGET_MCP_UNAUTHORIZED`, rather than a transport failure.
Real client authorization and read-only context verification remain pending.

### Real OAuth connection verified (2026-10-16)

The native Codex OAuth listener reported `mcpServer/oauthLogin/completed` with
`success: true`. `codex mcp list` now reports OAuth, and a fresh native MCP
inventory connection successfully initialized the hosted server and discovered
`get_context`, `record_entry`, and `get_entry_status` without a tools error.
No financial entry was created. A separate app-server could not call
`get_context` against this active chat because it already has an active writer;
that read-only call remains to be exercised through the chat's refreshed tools.
Frontend was restored on top of `cabb812` (including latest invitation changes),
with nine consent/auth tests passing; deployment `92a4b3cc-364e-4952-a9ba-7c9ad16ea72c`.

### ChatGPT personal cloud plugin — 2026-10-16

Installed `plugin_asdk_app_6ad253bba1608191b181e2a1c4e3917c` through ChatGPT
Plugins in the owner's Brave session. The browser extension works; desktop
Computer Use did not have its trusted RPC service configured. OAuth discovery
selected DCR; configured base scopes `budget:read`, `budget:write`,
`offline_access`. ChatGPT Settings shows OAuth connected, one write tool and two
read tools. Its actual `open_budget_tracker.get_context` connector call
succeeded, confirming access to the authorized space without making a financial
write. The owner confirmed the plugin appears on ChatGPT mobile. This is a
hosted personal cloud connection, not a public listing. Mobile write behavior
awaits the owner's first requested transaction.

Source package: `plugins/open-budget-tracker`. Build with
`pnpm package:chatgpt-plugin`; generated ZIP and SHA-256 are under ignored
`artifacts/chatgpt`, outside frontend assets. Includes a product icon and five
positive/three negative review scenarios. Public submission still requires the
support/privacy/terms URLs, verified publishing identity, a dedicated demo
account, executed review cases and a walkthrough. See the package README.

## Public review package — 2026-10-16

Dedicated synthetic reviewer and isolation accounts are prepared; their private
credentials stay in ignored `.wrangler/chatgpt-review/` files. The owner's
personal ChatGPT connection remains primary. The synthetic ChatGPT connection
is named **Plugin review (synthetic)**. Five positive and three negative cases
were exercised using that account; direct activity verification confirmed the
USD/LBP entries and no writes from negative scenarios. Ten hosted integration
checks cover OAuth/PKCE, isolation, exact amounts, retry safety and revocation.

The captioned walkthrough and transcript are at
`https://openbudgetracker.app/review/`; only synthetic data is visible. Source
assembly: `scripts/chatgpt/build-review-video.mjs` using ignored actual captures.
The ZIP builder includes its public URL and only three allowlisted package
files. The archive, digest and upload instructions are in `artifacts/chatgpt/`.
Support, privacy and terms pages are live in English and Arabic. Public support
is `hello@openbudgetracker.app`; publisher is Daniel Awde.

The owner chose to upload the ZIP manually. OpenAI portal ZIP validation,
domain challenge (token available after upload), private review credentials,
submission attestations and OpenAI review remain portal steps. This preparation
does not mean the plugin is approved or published.

## OpenAI portal configuration — 2026-10-16

The owner uploaded version 0.1.0 to OpenAI Platform. Public-review plugin:
`plugin_asdk_app_6ad26418177481919ad77f2ef88d9783`; draft:
`appsub_6ad2641817d08191a6d60b56f297a9a0`.
This is separate from the owner's original personal ChatGPT installation.

Configured the portal MCP connection using the dedicated synthetic reviewer
space. The portal reports **Authorized**, **Domain verified**, **Configured**,
and **No findings in the latest MCP scan** with all three tools discovered.
The parent-domain challenge is served as exact plaintext at
`https://openbudgetracker.app/.well-known/openai-apps-challenge`. Frontend version:
`f53e006b-b466-4e12-96b0-61012f574b17`.

The listing has a non-blocking category warning for Productivity. Private
reviewer-access entry was started but a Brave extension popup blocked password
entry; the reviewer form still needs completion and saving. No submission
attestations were accepted, no review was submitted, and nothing was published.

### Reviewer-access completion

Resumed after the browser popup was dismissed. Saved the dedicated demo
username/password, login URL, synthetic tenant and detailed sign-in instructions
in the portal's private reviewer form. The blocking incomplete-review-information
finding disappeared. The final submission form is available; it shows only the
non-blocking Productivity category warning. Its six publisher attestations are
unchecked pending the owner's explicit confirmation, including agreement to
OpenAI's terms/guidelines, applicable-law compliance, no transfers/trades, content
and API rights, under-18 suitability, and no targeting/sharing under-13 data.
No submission or publication has occurred at this point.

### Submission confirmed

The owner explicitly confirmed all six publisher attestations and authorized
submission. On resuming, the browser already showed all attestations checked
and submission processing, so no duplicate submission was attempted. The portal
then returned to Plugins and reports **Open Budget Tracker: In review**, MCP
**Configured**, publication **Not published**. Its row displays version **1.0.0**
(the prepared ZIP manifest was 0.1.0). Evidence is saved locally in ignored
`artifacts/chatgpt/submitted-in-review.png`. OpenAI review/approval remains
external; no approval or public publication is claimed.
