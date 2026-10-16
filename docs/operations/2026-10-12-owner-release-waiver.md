# Owner release waiver — 2026-10-12

Daniel's instruction, relayed by the coordinating chat, is “skip github action in
all”. GitHub Actions being unavailable or blocked by account billing is not a
release prerequisite. Do not request another GitHub Actions exception. Describe
the Actions result as **waived**, never **passed**.

Retain fresh local tests, repository gates, browser/DB acceptance, and applicable
hosted verification. This exception does not authorize disabling workflows,
changing branch protection, bypassing actual failures, or expanding production
permissions. Include this waiver in future handoffs and continuation chats.

## Current work handoff

The policy update does not resume lower-priority implementation or authorize
deployment. Daniel's current finish/go-live priorities are Services and
scheduling. No implementation or deployment was resumed for this update.

At the October 12 handoff, Budget Tracker's income vs spending and savings
history charts were unfinished in the working tree. The history RPC, API/schema
additions, and tests had been started; the chart components and browser acceptance
were outstanding. The owner resumed this work on October 16, as recorded below.

## Resumed dashboard work — 2026-10-16

Daniel requested a visual redesign of the logged-in dashboards, with more useful
charts on Home, Plan and Activity and a UI-only Accounts refresh. The frontend
now includes income/spending history, savings history, plan comparisons, funding
and goal progress, and filtered activity counts. The existing local history
migration was applied to the local preview without resetting its data.

Database tests and real local-browser acceptance now supplement the original
fixture-only visual checks. The earlier claim that the local database was offline
was incorrect: the availability check used port 54321 instead of this project's
54421. Current evidence is saved in
`docs/feedback/dashboard-redesign-2026-10-16/verification.json`.

The dashboard, expense popup and hosted MCP integration were merged into main
and deployed on October 16. The two remaining expense-source/history migrations
were applied to the active production project. The Actions waiver above still
applies; release verification is recorded below.


## Production integration verification — 2026-10-16

- Only `20261016140000_expense_sources.sql` and
  `20261016140100_money_history.sql` were applied. Historical migrations covered
  by the aggregate v2 baseline were not replayed; the MCP migration was already
  present.
- A private budget-schema/data backup restored all 20 tables / 590 rows exactly
  into an isolated Supabase Postgres container with Auth ID stand-ins. Both
  migrations and authenticated history, source-payment, replay and reversal
  checks passed there. This is a Budget restore bundle, not a full Auth backup.
- Production used one guarded transaction checking the backup fingerprints.
  All 20 budget table hashes remained unchanged after application and again
  after a synthetic payment/replay/reversal check that rolled back completely.
  Both new definitions match the rehearsal; all 114 existing functions are
  unchanged. Execution is restricted to authenticated users with empty search
  paths. Read checks used three owner contexts; synthetic password sign-in and
  seven typed HTTP reads also passed, including anonymous and cross-space denial.
- The complete real local-browser suite passed 72/72 checks across desktop,
  mobile and 320px in English/Arabic. Existing test selectors were updated
  for the current action chooser and monthly Home view; money reconciliation,
  idempotent recovery and full-table cancellation assertions remain.
- The combined code passed 257 database tests, 232 UI tests, 11 MCP tests,
  application/Worker typechecks, production build and both deployment dry runs.
  Two MCP limit mismatches were corrected with regressions that first failed:
  notes now respect the ledger's 200-character limit, and valid large catalogs
  have a bounded 1 MiB context response allowance.
- Frontend version: `eca72f9c-4ca2-400c-827a-38ad7ba8d229`.
  MCP Worker version: `d7f90bd9-8cc9-46fa-b006-772a9121f122`.
  Six referenced live assets match the local build byte for byte. Public policy,
  review, domain-challenge, Worker health and OAuth discovery checks passed.
- Real production Chrome passed 31 checks across 1440/390/320px in English and
  Arabic using only the synthetic reviewer account, with no runtime errors.
  Live MCP DCR/PKCE, context, refresh, tool annotations and revocation passed;
  that MCP verification made no financial calls.
- The active local Supabase link now targets `dfuxxzlhmxscgvxdmwti`.
  Machine-local CLI/link caches are no longer tracked by Git. Generated plugin
  archives, review evidence and private credentials remain ignored and local.

All feature histories are consolidated on main. Previously squash-merged
branches were checked for patch equivalence before recording their ancestry;
the plugin and expense-popup branches received ordinary merges. Cleanup removes
only branches whose tips are ancestors of the verified, pushed main. The plugin
checkout is preserved detached so ignored review assets and credentials remain
local.
