# Open Budget Tracker for ChatGPT

This is a draft portable plugin for the hosted Budget MCP server. It records
expenses and income in one authorized budget space. All execution is on
Cloudflare Workers and Supabase; no local computer is required by the server.
The plugin does not move money or connect to banks.

## Verified personal installation — 2026-10-16

Created the personal cloud plugin through the owner's ChatGPT account in Brave:
[Open Budget Tracker](https://chatgpt.com/plugins/plugin_asdk_app_6ad253bba1608191b181e2a1c4e3917c).
ChatGPT Settings reports OAuth connected and lists one write and two read tools.
The actual ChatGPT connector's `get_context` call succeeded and returned only
the authorized space's context. The owner confirmed this plugin appears in
ChatGPT mobile. No expense or income was created for verification. A real
expense request from the mobile app remains the first write acceptance check.
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

## Public directory submission remains unfinished

This ZIP is prepared for draft upload, not submission-ready. Do not invent
working legal/support URLs or claim the review scenarios have been executed.
Before submitting:

1. Confirm the verified publisher name and update `developerName` if needed.
2. Publish genuine support, privacy, and terms pages. Add their HTTPS URLs to
   the listing as `supportURL`, `privacyPolicyURL`, and `termsOfServiceURL`.
3. Prepare a dedicated demo Budget account with sample data, wallets named
   **Cash USD** and **Cash LBP**, and a **Groceries** expense item. Keep adequate
   sample funding. Do not use the owner's personal account as a reviewer login.
4. Execute all five positive and three negative cases using that demo account.
   Capture evidence and record a walkthrough; then add its accessible URL as
   `review.demo_recording_url` in `extensions.com.openai`.
5. Rebuild and upload the ZIP in [OpenAI Platform Plugins](https://platform.openai.com/plugins)
   under **With MCP**. Complete identity verification if requested.
6. Connect the remote MCP, authorize the demo account, and satisfy the domain
   challenge at the exact HTTPS origin shown in the portal. Do not replace
   another plugin's existing challenge token.
7. Enter reviewer credentials only in the portal's private review form. Resolve
   automated findings, confirm submission attestations with the owner, and
   submit for review. After approval, the owner chooses when to publish.

Published plugins are expected to work on mobile, but approval and mobile
behavior are not established by generating this package. A private connection
or a public listing must still enforce OAuth per user. Publishing a listing
does not share one user's authorized budget with other users.

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
