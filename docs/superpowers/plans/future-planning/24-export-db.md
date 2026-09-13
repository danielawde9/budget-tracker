# 24 — Frozen export manifests

**Layer:** DB. **Depends on:** 23. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Owned files

Create `_journal_export_manifests.sql`, `tests/db/journal-export.integration.test.ts`.
Export snapshot consistency needs captured rows, not MAX(timestamp)/MAX(uuid).
Temporary export data is operational storage, explicitly exempt from financial
append-only retention; it never edits the source journal.

## Schema

`journal_export_jobs`: id uuid PK,space_id uuid FK,actor_id uuid FK,currency nullable,
from_date/to_date dates,filter_json jsonb≤4096bytes,request_id uuid,fingerprint bytea (32 bytes),
state preparing/ready/expired/failed,created_at DEFAULT now(),expires_at DEFAULT now()+24h,
row_count int0…100000,bytes_count int0…20971520, UNIQUE(space_id,actor_id,request_id).
`journal_export_rows`: job_id uuid FK ON DELETE CASCADE,ordinal int1…100000,
event_id uuid,payload jsonb≤64KiB, PK(job_id,ordinal),UNIQUE(job_id,event_id).
Payload is task 23 event DTO including captured metadata/labels and money as text.
Only job owner and current active member may read through RPC; no raw API writes.
Operational UPDATE/DELETE are allowed only through private job transitions/cleanup;
RLS and revokes still required. Add index jobs(expires_at),rows(job_id,ordinal).

## RPCs and materialization

`prepare_journal_export(p_space_id uuid,p_request_id uuid,p_from_date date,
p_to_date date,p_filters jsonb)` → {jobId,rowCount,bytesCount,expiresAt,state}.
Filters exact keys walletId,rootId,payee,minMinor,maxMinor,query,currency (nullable),uncategorizedOnly (required boolean);
reuse23 validations; inclusive range≤366days. Max 3 unexpired jobs per actor.
Use one statement snapshot CTE to collect **entire payloads**, not IDs that later
join changed metadata. Count and byte total first within that statement; abort
whole transaction if caps exceeded. Insert ordinal in deterministic event order;
no row truncation. Plan replay plus ownership bound; ready job never appends rows.

`journal_export_page(p_space_id uuid,p_job_id uuid,p_after_ordinal int,p_limit int)`
→ {rows,nextOrdinal,hasMore,expiresAt}; after≥0,limit1…100, exact ordinal order.
Row: ordinal,eventId,payload. Check member+owner+not expired every page.
`discard_journal_export(p_space_id uuid,p_job_id uuid)` → {discarded:boolean};
owner-only, idempotent, removes payloads, retains minimal expiry audit if required.
Private cleanup function removes expired payloads in batches≤100 jobs,≤100000rows
per transaction; no scheduler in this task. Job creation can opportunistically
remove only caller-owned expired jobs using that bounded helper.

## Red cases

Prepare snapshot then add event/change note/reverse prior event: export remains
unchanged; next export reflects new facts. Same timestamp late commit cannot add
rows to existing manifest. Concurrent prepares capped3 under actor lock; UUID
replay stable. Another member cannot download owner's job; removed owner denied.
100001rows or 20MiB+1 rejects,100000 exact passes within timeout fixture. No service
key read bypass. Event totals per currency equal manifest captured totals.

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
