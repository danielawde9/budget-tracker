# 49 — Recap preferences and delivery queue

**Layer:** DB. **Depends on:** 03,37. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Tables and capability boundary

Create `_recap_delivery_queue.sql`, `tests/db/recap-delivery-queue.integration.test.ts`.
`recap_preference_revisions`: id bigint identity PK,space_id uuid,member_id uuid,
enabled boolean,expected_revision_id nullable same-stream FK,request_id uuid,
actor_id uuid,created_at now. Default absent=false, self-only edits,01guards.
`recap_delivery_jobs`: id uuid PK,space_id uuid,member_id uuid,month_start normalized,
recap_revision bigint,content_digest bytea (32 bytes),state text pending/claimed/sent/failed/
cancelled/needs_review,attempts int0…3,provider_idempotency_key text UNIQUE,
created_at DEFAULT now(),claimed_until nullable timestamptz,sent_at nullable timestamptz,
provider_message_id nullable text≤200,last_error_token nullable text≤80,
UNIQUE(space_id,member_id,month_start,recap_revision). Operational queue is mutable
only through fixed transitions; it has RLS/revokes and state guards, not the
immutable-history UPDATE guard. Sent/cancelled terminal; failed can be reclaimed
only when confirmed retryable and attempts<3. needs_review never auto-retries.

`set_recap_preference(p_space_id uuid,p_request_id uuid,p_enabled boolean,
p_expected_revision_id bigint)`→JSON{revisionId}; member=self.
`enqueue_monthly_recap(p_space_id uuid,p_request_id uuid,p_month date,
p_recap_revision bigint,p_content_digest text)`→{jobId,state}; explicit member action,
opt-in required, digest must equal server preview DTO digest. Compute digest from
fixed typed month summary inputs; do not let arbitrary client digest claim reviewed
content. Member does not supply another recipient address or userID.

Worker RPCs: `claim_recap_jobs(p_limit int)`≤10→rows{id,spaceId,memberId,month,
recapRevision,contentDigest,idempotencyKey,leaseToken}; fixed 2-minute lease,
FOR UPDATE SKIP LOCKED. `authorize_recap_delivery(p_job_id uuid,p_lease_token uuid)`
→{allowed,recipientAddress} only to delivery capability role, never browser.
Resolve recipient from existing verified invitation/mail identity boundary;
no return of arbitrary auth record. `finish_recap_delivery(p_job_id uuid,
p_lease_token uuid,p_outcome text,p_provider_message_id text,p_error_token text)`
→{state}; outcome sent/confirmed_retryable/permanent_failure/ambiguous.
Add lease_token uuid nullable to job table, renew token on claim, reject stale token.

Use existing server capability pattern verified from invitation worker SQL. If
none exists, introduce a narrowly privileged `budget_recap_worker` NOLOGIN role
and a fixed authenticated-server binding in the later Worker task; never grant
browser/service_role global queue reads as a shortcut. This narrowly named worker
role is an explicit exception to01's no-new-broad-app-role default. Grant only
these three functions, no table ownership or arbitrary SQL. Privileged setup of
credentials is separately deployment work; disposable DB can SET ROLE for tests.

Check current membership and opt-in at enqueue, claim and authorization-before-
send; opt-out invalidates pending work. A removal after authorization but before
external send is an unavoidable boundary race without a transactional provider;
minimize window and test observed behavior, never promise instantaneous revocation
of an already-dispatched message. Attempts increment on claim, not on every poll.
Max 3activejobs/member; retention30days operational metadata, no stored report body.

Test duplicate enqueue/replay, claim race, expired lease/stale completion, disabled
member/opt-out, cross-space access, ambiguous->needs_review, fourth attempt denied,
provider ID cap, no recipient payload to authenticated/anon and no ledger changes.

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
