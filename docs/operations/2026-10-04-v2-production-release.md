# v2 production release — 2026-10-04

The owner chose to remove the old Budget application data and re-enter it in
v2. This supersedes the proposed history-preserving migration. Login accounts
were preserved. No other Supabase project was changed.

## Database

Target: `dfuxxzlhmxscgvxdmwti`. The project is reachable by explicit connector
project ID even though it was absent from the connector's project listing.
The repository's cached CLI project reference is stale; do not use `--linked`
without verifying/relinking the target.

The production schema and public/private data were exported using the CLI's
explicit `--project-ref`. Backups and the owner's CSV are stored outside Git at
`/Users/daniel/Desktop/Daniel/budget-tracking-backups/2026-10-04-pre-v2/`, with
private permissions and a SHA-256 manifest. The backup contains private
application configuration and must not be committed or shared publicly.

A local scratch database restored the application schema/data with mock Auth
identities and the verified restricted household owner role. It reproduced
23 financial events and 357000 USD wallet minor units. Auth itself was not
reset or restored. The scratch rehearsal then applied the complete v2 release
successfully before the production operation.

The atomic hosted migration `budget_v2_owner_authorized_fresh_start`:

- Refused to run if v2 already existed or the backed-up journal count/balance
  had changed.
- Removed the old application-only public/private schemas, recreated public
  with the intended API grants, and installed all six v2 migration files in
  filename order. Extensions reside outside these schemas; no outside foreign
  keys or triggers depended on the removed app schemas in the preflight.
- Left Auth accounts intact and requested a PostgREST schema-cache reload.

Post-apply checks: 4 Auth accounts, 0 spaces, 0 wallets, 0 entries, all 15 v2
base tables protected by RLS, authenticated access to my_spaces, no old public
base tables and no old private schema.

A rolled-back authenticated SQL smoke test created a default plan and USD/LBP
wallets, performed a $1 → LBP 89,500 exchange, and read the overview. Subsequent
checks confirmed 0 persistent spaces/entries; no smoke data was retained.

The release SQL and source hashes are retained with the backup. Hosted history
records the six local v2 files as one atomic release; a future automated
migration runner must account for this covered baseline rather than blindly
reapplying these six files. The old journal remains as historical evidence.

## Frontend

`pnpm deploy:cloudflare:frontend` completed successfully after the production
build and dry run. Worker: `budget-tracker`.

- Existing custom domain: https://budget.danielawde9.com (HTTP 200 and correct branding verified).
- Worker address: https://budget-tracker.danielawde9.workers.dev
- Version: `d05db49a-179e-4fb3-af99-8457d025e8be`
- Product title, sign-in branding and installed-app name: `openbudgetracker.app`.
- Live Chrome check: HTTP 200, correct title/branding, visible Sign in action,
  no page errors.

Cloudflare lists budget.danielawde9.com on this Worker and no zone named
openbudgetracker.app. The product rename does not register or configure that
hostname. Both existing HTTPS addresses were tested.

## Validation and limits

- 165 SQL tests passed.
- 110 UI tests passed.
- All 5 local database-backed Chrome end-to-end tests passed after updating
  selectors for the existing owner redesign (disclosures and labels).
- Production build and Cloudflare dry run passed.
- Real password-based production sign-in was not performed; the existing
  account passwords remain unchanged. SQL command smoke testing was rolled back.
- Earlier interaction-audit findings remain recorded in the audit document;
  this release is not an exhaustive UX or accessibility sign-off.

On the next sign-in, existing users have no v2 space and enter onboarding.
The owner can re-enter wallets, plans, loans and journal entries from scratch.
