# Claude directory preparation — 2026-10-09

## Status

**Not submitted, approved, or published.** Preparation is blocked on locating the
existing remote MCP server named in the request. No legal terms were accepted.
No personal financial records or credentials were submitted to Anthropic.

Inspected local source and GitHub main at
`05f59b950d6b5b8e27d4fcf400d77e6bbeeb7603`. The repository contains a future
connector plan, `docs/superpowers/plans/2026-09-13-private-account-mcp-connector.md`,
but no MCP implementation, OAuth connector implementation, or deployed MCP URL.
`wrangler.frontend.jsonc` deploys frontend assets only. The prior completed Codex
submission belongs to Sandooq, a separate project with a public documentation MCP.
Do not use its server or submission details as Budget's.

Brave's logged-in Claude account is on Max and can access the submission portal.
The connector form is open at
https://claude.ai/directory/manage/new/connector, step 1 of 10. Its only existing
custom connector is unrelated to Budget. No Budget listing has been created.

## Verified listing facts and available assets

- Product: **Open Budget Tracker**.
- Website: https://openbudgetracker.app (preserve the actual domain spelling).
- Repository: https://github.com/danielawde9/budget-tracker.
- Product documentation: https://openbudgetracker.app/how-it-works.
- Currency guide: https://openbudgetracker.app/budgeting-usd-lbp.
- Existing public issue channel: https://github.com/danielawde9/budget-tracker/issues.
  Reports should use demonstration data and omit personal financial details.
- Existing branding: `public/brand/logo-mark.png`, `public/brand/logo.png`.
- Product capabilities: English/Arabic with RTL, USD/LBP wallets, monthly plans,
  append-only journal. These are app capabilities, not verified MCP capabilities.
- No public privacy policy route or dedicated support contact was found in source.
  Confirm operational data handling and a monitored private contact before writing
  or publishing a connector privacy policy.

## Current Claude requirements

Authoritative documentation read in Brave on 2026-10-09:

- https://claude.com/docs/build/overview
- https://claude.com/docs/directory/publish
- https://claude.com/docs/connectors/building/review-criteria
- https://claude.com/docs/connectors/building/submission

A remote MCP server can be submitted directly as a connector without a GitHub
bundle. A bundle is appropriate for skills and workflows; if it references the
same remote server, submit that server separately and use the same URL to avoid
duplicate tools. Do not create a bundle that points at a nonexistent server.

The ten portal steps are Connection, Tools, Listing, Use cases, Company,
Authentication, Data handling, Test & launch, Compliance, Review and submit.

Required preparation:

- Live HTTPS MCP endpoint; OAuth 2.0 for private account data.
- Every tool has a title, a name of at most 64 characters, and the applicable
  `readOnlyHint` or `destructiveHint`. Reads and writes are separate tools.
- Accurate tool descriptions, bounded responses and actionable input errors.
- Listing name (100 characters maximum), one-liner (200), description (2,000),
  one to five categories, documentation, privacy URL, support contact, icon,
  permanent listing slug, company details and review contact.
- A fully populated reviewer account using synthetic financial data, with private
  access instructions. Never use the owner's live account or commit credentials.
- Exercise every tool in MCP Inspector AND in a Claude custom-connector conversation
  before claiming that testing is complete.
- If an MCP App is present: 3–5 PNG screenshots at least 1,000 pixels wide,
  cropped to the app response, with separate paired prompt text. Videos/GIFs do
  not satisfy that carousel requirement. Use synthetic data.
- Review the seven required compliance acknowledgments and directory terms.
  Finish preparation before asking the owner to accept them.

Claude does not accept connectors that transfer money or financial assets.
Recording a budget entry must be described accurately and never imply bank
payments or transfers. No production posting has been attempted here.

## Private-data gates before testing or submission

The future plan proposes grants bound to one selected personal space. Its design
is not proof of an implemented access boundary. Verify the actual server:

1. Unauthenticated requests cannot read personal records.
2. OAuth validates issuer, audience/resource, expiry, scopes and live revocation.
3. Identity and space come from verified authorization, not model arguments.
4. Two synthetic users cannot read or change one another's wallets, entries,
   drafts, receipts or grants; wrong-space IDs do not leak existence or content.
5. Read-only grants cannot mutate. Revoked grants and lost membership block access.
6. Tool input cannot invoke arbitrary SQL/RPC or select a privileged database role.
7. Any posting uses authenticated, explicit review; `confirmed: true` from the
   model alone is not approval. Retry behavior prevents duplicate entries.
8. Logs, listing assets and review evidence omit financial records, tokens and
   secrets. Privacy disclosures match actual storage, retention and recipients.

## Evidence and next action

Portal screenshot:
`/Users/daniel/.codex-personal/visualizations/2026/10/09/01a12093-8120-7c00-9e1d-beb25b06acda/claude-connector-awaiting-server.jpg`.

Asked the owner for the existing Budget MCP URL/source location, or clarification
that the intended project was Sandooq. Once resolved, inspect the correct server,
prepare missing materials, validate/test, complete the portal, obtain the required
legal acceptance confirmation, submit, and record the portal's resulting status.
