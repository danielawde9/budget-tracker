# v2 live-data preservation assessment — 2026-10-04

Status: superseded by the owner's explicit fresh-start choice on 2026-10-04.
The inventory below records the pre-reset state. Production app data was
backed up and reset; four Auth accounts were preserved. See
2026-10-04-v2-production-release.md for the actual release.

## Verified inventory

The configured hosted Budget project is `dfuxxzlhmxscgvxdmwti`. A direct
connector query succeeds even though this project is absent from the connector's
project listing. The `budget` v2 schema is absent; the existing tables are v1.

There are two spaces: one with a wallet and journal activity, and one without
wallets or events. Each has one active member. The active space has 23 events,
4 loans, 4 goals, and 1 schedule. Its USD cash wallet holds 357000 minor units
($3,570.00).

The supplied journal export is a snapshot from 2026-10-03. It has 22 wallet
journal rows whose net USD movement is also 357000. The extra live event is a
2026-09-28 loan opening, which has no wallet movement and therefore is absent
from the CSV. The export is not a full backup or complete migration source.
Do not commit the raw export or production row data to Git.

## Preservation requirements

- Preserve both spaces and their memberships; never reset auth or public data.
- Capture a fresh backup and prove restoration before a production write.
- Rehearse v2 installation against a scratch copy of the v1 schema first.
- Check every public RPC identity and its defaults for signature collisions.
- Map v1 wallet movements, loans, reversals, categories, goals, plans, and
  schedules explicitly into v2; keep original identifiers in a migration map.
- Reconcile wallet balances, loan principal, reversal links, counts, and
  purpose balances before switching the frontend.
- Preserve old tables and history until validation and rollback requirements
  are met. No destructive cleanup is part of this release.
- Detect changes since the captured snapshot and reconcile them before cutover.

## Open migration decision

The recommended path is full-history preservation. An alternative is opening
v2 at current balances with the old journal retained as an archive. That
alternative changes how past history appears in the app and needs an explicit
choice. The owner has been asked; no migration method has been selected yet.

## Release boundary

Do not push main or deploy the frontend until SQL installation, tenant
conversion, and reconciliation succeed. The existing six v2 migrations create
an empty model; applying them alone does not import the live tenant. Installing
those tables without importing data would make existing users appear to have
no space in v2, despite the original rows remaining in public.
