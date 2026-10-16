# Open Budget Tracker for ChatGPT

This is the prepared portable plugin for the hosted Budget MCP server. It records
expenses and income in one authorized budget space. All execution is on
Cloudflare Workers and Supabase; no local computer is required by the server.
The plugin does not move money or connect to banks.

## Verified personal installation — 2026-10-16

Created the personal cloud plugin through the owner's ChatGPT account in Brave:
[Open Budget Tracker](https://chatgpt.com/plugins/plugin_asdk_app_6ad253bba1608191b181e2a1c4e3917c).
ChatGPT Settings reports OAuth connected and lists one write and two read tools.
The actual ChatGPT connector's `get_context` call succeeded and returned only
the authorized space's context. The owner confirmed this plugin appears in
ChatGPT mobile. No expense or income was created for verification. Desktop ChatGPT write scenarios were subsequently exercised with a separate synthetic account; a write from the mobile app itself remains unverified.
This personal installation is not a public directory publication.

Build the ZIP from the repository root:

```sh
pnpm package:chatgpt-plugin
```

Output: `artifacts/chatgpt/open-budget-tracker-0.1.0.zip`. The archive includes
only `plugin.json`, `mcp.json`, and the existing product icon. It has no API
keys, OAuth tokens, credentials, or personal financial data. The build script
checks the remote endpoint, DCR/OAuth scopes, review-case counts, paths, icon
dimensions, and exact archive membership. Generated artifacts live outside the
frontend asset directory so a frontend deployment does not publish the ZIP.

The root manifest and MCP transport core were also checked against the official
Agent Plugins 1.0.0 JSON schemas. The currently published generic MCP schema does
not declare OpenAI's documented per-server `extensions` field, so transport-core
validation excludes that host-specific field; the builder separately checks
the OAuth extension. OpenAI portal validation of the complete ZIP is still
pending. Do not describe this as a completed portal review.

## Connect to an individual ChatGPT account

In [ChatGPT Plugins](https://chatgpt.com/plugins), select **Add → Add custom MCP
server**. Name it **Open Budget Tracker**, use
`https://mcp.openbudgetracker.app/mcp`, and choose OAuth. OAuth discovery supplies
the endpoints and Dynamic Client Registration. Request `budget:read`,
`budget:write`, and `offline_access`. Sign into Budget Tracker, choose an owned
space, and approve access. Never paste API keys into chats or configure this
protected server as unauthenticated.

This installs a personal connection, not a public directory listing. Each
ChatGPT account needs its own connection and each Budget user authorizes their
own space. ChatGPT account and workspace policies govern available surfaces,
tools, and write confirmations. Mobile availability must be verified on the
actual mobile account; a successful desktop setup alone is not proof.

After connecting, test **get_context** without adding a transaction. Then open
the same account/workspace in ChatGPT mobile and check whether the plugin is
selectable. If it is not, do not claim mobile support for the personal install.

## Upload and public review

The support, privacy and terms URLs in the manifest are live. The publisher is
Daniel Awde and the public contact is hello@openbudgetracker.app. The dedicated
synthetic demo account has Cash USD and Cash LBP wallets and a Groceries item.
Five positive and three negative review scenarios were exercised in ChatGPT on
2026-10-16 using only that account. Posted USD expense/income and LBP amounts
were independently checked in its budget activity. Ten hosted integration
checks also passed, including OAuth, isolation, idempotency and revocation.

The [captioned review walkthrough](https://openbudgetracker.app/review/) contains
actual ChatGPT captures, edited with pauses on results, and a transcript. Its
public URL is included as `review.demo_recording_url`. No credentials are in
the recording, archive or public pages.

1. Open [OpenAI Platform Plugins](https://platform.openai.com/plugins).
2. Select **Upload new or existing plugin**, choose the verified **Individual —
   DANIEL AWDE** developer identity, and upload the generated ZIP. Use the
   **With MCP** workflow where shown.
3. Wait for validation. Resolve any portal findings before submission; complete
   ZIP validation is still pending until this upload.
4. Connect `https://mcp.openbudgetracker.app/mcp` with OAuth. Sign into the
   dedicated demo Budget account and authorize its synthetic space.
5. Complete the domain challenge at the exact HTTPS origin shown by the portal.
   Its token is generated after upload and is not knowable in advance. Do not
   replace a challenge belonging to another plugin.
6. Provide the demo login privately in the reviewer-access section. Local
   reviewer credentials are in `.wrangler/chatgpt-review/reviewer.json` (ignored,
   mode 600); never publish or add that file to the ZIP. Use the demo credentials,
   not the owner's budget login. The demo account needs no OTP/MFA.
7. Review and confirm the submission attestations, then submit for OpenAI
   review. Approval and publication have not happened yet.

Each user connects their own Budget account through OAuth and authorizes one
owned space. Public listing availability remains subject to OpenAI review and
ChatGPT account/workspace eligibility. The owner's personal installation was
confirmed visible on mobile; the hosted service needs no running Mac.

## References checked on 2026-10-16

- [Package format and OAuth](https://developers.openai.com/plugins/build/plugins)
- [Submission and review fields](https://developers.openai.com/plugins/deploy/submission)
- [Plugin guidelines, including mobile](https://developers.openai.com/plugins/plugin-guidelines)

## Data handling facts for the privacy page

The connector returns the authorized space's identity, timezone/current date,
active wallet names/currencies, and plan-item names. Saves send the chosen
wallet/item IDs, kind, currency, exact minor-unit amount, date, memo, and request
ID to Budget. A receipt confirms a save. User requests and tool responses pass
through ChatGPT. Cloudflare operates the hosted gateway and OAuth storage;
Supabase operates Budget's database and login. Grants last 90 days and can be
revoked in Budget Settings. The Worker receives a delegated opaque credential,
not a Supabase password, login JWT, or service-role key. Logs omit financial
payloads and credentials. These are implementation facts, not a complete
privacy policy or a statement of retention/deletion practices for each provider.
