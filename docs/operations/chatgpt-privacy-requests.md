# Budget support and privacy requests

Public contact: hello@openbudgetracker.app. Operator/publisher: Daniel Awde.
Public policies: /support, /privacy, /terms (also /ar equivalents).

## Verify and minimize

Handle requests in the private support mailbox, never in a public GitHub issue.
Verify the requester controls the email associated with the Budget account.
Do not ask for passwords, authentication codes, API keys, or a complete budget
in an email. Establish which account and spaces are in scope and whether the
request concerns a correction, an export, connector revocation, or deletion.
Record the request, verification, authorized scope, action, and response without
copying unnecessary financial data into support notes.

## Access, export, and corrections

Return only data the verified requester is entitled to access. A membership
alone does not authorize exporting other users' authentication details.
Use the app's supported correction commands, retaining its ledger integrity.
For exports, provide an authenticated, private delivery method; do not send
financial records to an unverified address or place them at a public URL.

## Revoke first when ending access

Revoke the account's MCP grants and active sessions before account deletion.
Deleting a Supabase Auth user alone does not revoke an already issued JWT.
MCP calls recheck a live grant and owner membership on every operation.
Explain that revocation stops new access but cannot remove tool responses from
ChatGPT conversations; the requester must manage those in ChatGPT.

## Deletion scope and shared budgets

Inspect dependencies and ownership before deleting anything. A user can own or
belong to a shared budget. Do not delete a shared space, another member's
records, or cascading account dependencies without explicit authority and an
appropriate ownership/retention decision. Do not equate deleting an Auth login
with safely deleting all budget data. Prepare a scoped action and confirm it
with the verified requester before irreversible deletion.

Complete the agreed live-data deletion, verify the result, and tell the user
what was removed, what remains, why, and when it will expire. Determine the
actual Supabase recovery/backup retention for the current plan before promising
an erasure timeline. Retained backups must stay protected and must not be used
to restore deleted data into normal service without reapplying the deletion.

## Retention facts

- Account and budget data remain while active, until an authorized deletion is
  processed; these records are not automatically aged out.
- Pending connector consent: 10 minutes. One-time connection codes: 5 minutes.
- Active grant validity: 90 days; an earlier revocation stops access immediately.
- Expired/revoked grant and idempotency receipt records remain with the account
  until scoped deletion. Expiry is an access limit, not a record purge.
- Application diagnostics contain phase/status/error kind, no money payload,
  credential, password or auth header; Cloudflare Workers logs currently retain
  up to 7 days. Invocation logging is disabled on the MCP Worker.
- Supabase operational logs and backups follow project-plan retention. Verify
  actual settings before a deletion response; do not invent a fixed window.
- Support correspondence is kept while a case remains open; process subsequent
  deletion requests once the support purpose and any specific retention needs
  have been reviewed.

Review these facts whenever hosting, logging, auth, account-deletion handling,
sharing, or providers change; update both language versions of the public policy
before changing the connector's data use.
