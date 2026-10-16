# Budget MCP on Cloudflare

The owner approved a hosted Cloudflare Worker and direct expense/income saves
from Codex on 2026-10-16. This supersedes the September draft-only proposal.
A complete user request needs no second confirmation.

Cloudflare's Workers OAuth Provider implements OAuth 2.1, PKCE, registration,
resource-specific opaque access tokens and refresh. Budget hosts bilingual
consent after its existing login. Consent names the client and redirect URI,
explains direct saving and data sharing, and selects one owned space for 90 days.
Settings revokes the grant immediately. No Supabase user token, password,
refresh token or service-role credential is issued to an MCP client or Worker.
Native Supabase OAuth remains disabled.

During connection the browser generates a random 256-bit connection credential
and one-time code. An authenticated owner-only RPC stores only their SHA-256
hashes, bound to user/client/space. The browser posts both to the Worker's
same-site, exact-origin completion endpoint. The Worker consumes the expiring
code through the narrow anonymous RPC, verifies the cookie-bound consent with
the OAuth library, and issues opaque MCP tokens. The library stores connection
properties encrypted; no plaintext credential is returned in a tool result.
The library manages PKCE, authorization codes and token refresh/revocation.

The stateless MCP handler exposes context, direct posting and receipt lookup.
The backend uses the public publishable key and a narrow credential-bearing
RPC, never general RPC access as an authenticated user. Each RPC verifies the
hashed active credential and live owner membership. Private tables have RLS
and no API grants. SQL derives the actor and selected space from the verified
grant, sets that actor only inside the protected posting transaction and
composes the existing financial commands. The caller cannot select a user or
space or invoke arbitrary commands. Revocation and writes serialize against
the grant; money writes retain the existing per-space lock and journal checks.

Context returns wallet/currency and plan-item names without balances/history.
Posting takes one income/expense with existing IDs, matching currency, exact
positive integer-string minor units, explicit date, optional memo and request
UUID. USD 2000 means $20.00; LBP 2000 means LL 2,000. Expenses follow the app's
existing Ready-to-assign coverage and report the covered amount. No transfers,
account creation, item creation or other-item budget moves are exposed.

Request IDs are namespaced by user/client and receipts are transactional with
the ledger. Identical concurrent retries return the original receipt; changed
payloads conflict. After response loss, status lookup and retries must reuse
the original ID. Missing or ambiguous information is a question, not a guess.
Dates come from the selected space's database clock/timezone. Arabic names and
notes work. Browser origins, scopes, body size, output size, request deadlines
and rates are bounded. Logs omit credentials and financial payloads.

Verification covers actual OAuth library DCR/PKCE/consent/token/tool handling,
SQL privilege isolation, hashed credentials, one-time codes, revocation,
concurrent retry, payload conflicts, exact USD/LBP, UI consent/denial and the
existing suite. Production entry tests use no fabricated financial records.
