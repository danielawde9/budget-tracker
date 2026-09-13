# 43 — Reviewed CSV import batches

**Layer:** DB. **Depends on:** 03; existing ordinary posting commands. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Defaults and schema

Create `_import_drafts.sql`, `tests/db/csv-import.integration.test.ts`.
V1 fixed template only: row_key,effective_date,kind,wallet_id,currency,amount_minor,
category_id,payee,note. kind income/expense; canonical positive minor units; no opening
balances/transfers/loans/FX, no silent format guessing. User can convert other formats
to this template; other bank formats require a separate mapping-evidence task using a supplied
sanitized file; do not route CSV input through the SMS parser.

`import_batches`: id uuid PK,space_id,actor_id,source_digest bytea (32 bytes),
format_version int CHECK=1,row_count int1…1000,request_id,created_at;
`import_draft_rows`: batch_id uuid,row_key text1…80,ordinalint1…1000,payload jsonb≤4096,
fingerprint bytea (32 bytes),PK(batch_id,row_key),UNIQUE(batch_id,ordinal);
`import_row_decisions`: id bigint identity,batch_id,row_key,space_id,
action confirm/skip,financial_event_id uuid nullable,request_id,actor_id,created_at,
UNIQUE(batch_id,row_key) (terminal decision),CHECK confirm if and only if financial event is nonnull.
All same-space FKs,exact child count/immutable guards,RLS/commands.

`stage_import_batch(p_space_id uuid,p_request_id uuid,p_batch_id uuid,p_rows jsonb,
p_source_digest text)`→{batchId,rowCount}; ≤1000rows/1MiB specialized cap, per-row4KiB;
validate syntax for all rows, reject malformed batch before insert. Foreign wallet/category
rejected; archived references marked at validation and forbidden at confirmation. Source hash
is client file identity, never an authorization boundary. Duplicate fingerprint
within file flagged for review, not unconditionally dropped (two identical
purchases can be real). Store a stable caller row key; same UUID and payload replay is stable.

`import_batch_page(space,batch,after_ordinal,limit)`→{rows,hasMore,nextCursor};
row key,ordinal,payload,status pending/confirmed/skipped,duplicateCandidates≤5.
`confirm_import_rows(p_space_id uuid,p_request_id uuid,p_batch_id uuid,
p_row_keys jsonb,p_accept_duplicates boolean)`→{results}; max 100uniqueorderedkeys.
Atomic batch subset: revalidate all rows/current wallet/categories, require true for
known duplicate candidates, post using deterministic UUID(batch,row key) and existing
RPC+metadata commands, append decisions+receipt. One failure rolls back that subset.
`skip_import_rows(space,request,batch,row_keys)`→{skippedKeys}; max 100.
Subsequent explicit confirm cannot alter terminal skip; new batch is deliberate.

Cross-file duplicate lookup must be confined to this space and immutable normalized
payload fingerprints; return candidates, not automatic merge. Record acceptance in
receipt. Same batch replay cannot double post; new batch with identical entries needs
explicit duplicate acceptance and shows prior event IDs. No financial event on stage.
Use existing metadata command atomically; don't insert an untrusted note into the ledger.

Tests 1000rowscap,100subsetcap,2 identical valid purchases explicitly accepted,
sameUUIDtimeout, source file different name same content, partial batch progress,
wallet archived after preview, malformed amount/currency/date, outsider denial,
SQL apostrophes/Arabic, and unchanged financial digest for stage/skip.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.

## Exact dispatch and read signatures

`import_batch_page(p_space_id uuid,p_batch_id uuid,p_after_ordinal int,p_limit int)`:
after ordinal≥0, limit1…100, fetch limit+1; nextCursor is last returned ordinal.
`skip_import_rows(p_space_id uuid,p_request_id uuid,p_batch_id uuid,p_row_keys jsonb)`.
Authorize original batch actor and current membership, not arbitrary household
member access to another user's staged notes. Draft payload exact keys correspond
to the nine template columns, with absent optional category/payee/note normalized
to null. Row keys remain text; wallet/category IDs parse to UUID before storage.

For confirmation choose `record_categorized_financial_event(space,child_request,
kind,effective_date,movements,category_id)` when category is present; otherwise use
`record_financial_event(space,child_request,kind,effective_date,movements)`.
Movements are one `{wallet_id,amount_minor}` object in an array, expense negative,
income positive. After posting call `describe_financial_event(space,metadata_request,
event_id,payee_name,note)` when metadata is nonempty. Use a different derived child
request for posting and description. Any description failure rolls back the row
and subset. Batch stage/skip never invokes these financial commands.
