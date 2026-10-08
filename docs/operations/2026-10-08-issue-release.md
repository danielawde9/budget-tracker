# Mobile and issue backlog release — 2026-10-08

Owner authorized fixing valid reports, replying as the owner, closing obsolete/external reports, merging the open PR and releasing. PR: https://github.com/danielawde9/budget-tracker/pull/10. Application code: `a708a771e43de1a2acc3f293af12e9383a9886c8` (plus prior bill commits in the same PR), squash-merged as `a2e6445ddd7c64a0f2a0349406e66eaef418e59e` at 06:01 UTC. All nine issues are closed with owner replies; no open PRs remain.

## Verified release

- 202 database tests, 160 UI tests, TypeScript and production build passed.
- All 60 local database-backed browser tests passed on desktop, 390px and 320px, including English/Arabic lost-response replay and full-table cancellation snapshots. The final run repaired a real 320px onboarding header overflow rather than forcing the click.
- Production public-variable guard and Cloudflare dry run passed.
- Frontend Worker `budget-tracker`, version `2aa84954-51c9-4491-99b9-d470bf043889`, deployed successfully using the CLI.
- Live URL: https://budget-tracker.danielawde9.workers.dev. HTTP 200, every referenced asset matches the released local build byte for byte, and real Chrome loads sign-in without horizontal overflow or runtime errors at 320px and 390px.
- The custom domain `budget.danielawde9.com` recorded in the October 4 notes does not resolve during this release. The README's workers.dev address is verified; no domain or DNS configuration changed.

## Additive database release

Explicit production target: Supabase project `dfuxxzlhmxscgvxdmwti`. A single guarded transaction applied:

1. `20261006082542_space_invitations.sql` — present in main but absent in production.
2. `20261008120000_bill_payment_links.sql`.
3. `20261008130000_budget_clock.sql`.
4. `20261008140000_wallet_statement.sql`.

The transaction recorded only these missing migration versions and notified PostgREST to reload its schema. It did not replay the six core files already covered by the atomic v2 production baseline or modify historical v1 migration records.

Before release, an authenticated Management API snapshot exported all 15 budget tables (258 rows), 85 function definitions and the schema catalog. Private files are outside Git at `/Users/daniel/Desktop/Daniel/budget-tracking-backups/2026-10-08-issue-release`, mode 0600 in a mode 0700 directory, with a SHA-256 manifest. This is a budget-schema/data restore bundle with Auth IDs for foreign keys, not a full Supabase Auth backup. Failed zero-byte dump files and the temporary credential-bearing dump script were removed.

An isolated Supabase Postgres restored the snapshot, matched columns/constraints/enums/indexes/policies and all immutable money-row hashes, then successfully rehearsed every additive migration. Production guard locked the money tables and aborted on any change from the verified backup. Post-release verification confirmed all three immutable money-table hashes unchanged, 43 entries, one space and six Auth users; new tables have RLS, the statement read is granted to authenticated users, and the private clock is not client-executable. Authenticated reads of spaces, Home, accounts, bills, invitations and wallet statement passed inside a rolled-back transaction.

## Honest issue dispositions and limits

Issues #3–#9 have implemented fixes/coverage. Save recovery is memory-only until reload/sign-out and warns users to finish before leaving. The loan identity limitation for historical fee-only payments is documented in the PR and decisions. No money history was rewritten.

Issue #2's exact-index planner assertion was removed with v1 in commit `43309b2ba263ccbf3010ffe3b0869486be140431`, so it is closed as obsolete. Issue #1's historical external OAuth URL still returns HTTP 422 `Unrecognized client_id`; the current docs-only plugin configuration does not expose that historical authenticate tool here. It is closed as not planned in this app repository, with the external limitation explained, not marked repaired.

GitGuardian passed. The Cloudflare automatic Git build check for code commit `a708a77` failed (build `88842de3-7aa3-458e-a5d0-422ca46c6455`). Its GitHub summary supplies no error details; the existing Wrangler OAuth session receives HTTP 403 from the Builds/logs API, and the dashboard requires login. A second PR-branch build also failed. After the normal merge, the automatic build on merged `main` **passed** (build `dd86291d-268a-4a50-b33d-60d964ba1e09`, Worker version `81da5856-46f8-43d0-b7f6-3d8751148077`). PR-branch build failure cause remains unverified; production automation on main is green. The independently successful guarded build/dry run/manual deployment and live checks above are the release evidence; no check result was forged or required branch protection overridden. Dashboard: https://dash.cloudflare.com/d8748edbef8b17443728cb5be64bdf19/workers/services/view/budget-tracker/production/builds/88842de3-7aa3-458e-a5d0-422ca46c6455.

Authenticated production password sign-in and a physical phone keyboard were not exercised. Complete money flows were verified against the local demo database; production verification used read-only authenticated SQL and the public browser page.
