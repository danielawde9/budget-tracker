# 20 — Month copy, close and signed rollover DB

**Layer:** DB. **Depends on:** 06,11,14. **Own:** `_month_transitions.sql`,
`tests/db/month-copy.integration.test.ts`, `tests/db/month-close.integration.test.ts`,
`tests/db/rollover.integration.test.ts`, decisions/inventory/evidence20.
Read01. No scheduler or automatic rollover; every copy/close is explicit.

## 1. Relational contract

New history tables use audit columns, common guards/RLS/revokes, same-stream
predecessor FKs, first/successor UNIQUEs and indexed tenant FKs as in04:

| Table | Required columns beyond id bigint identity, space_id, currency and audit |
| --- | --- |
| `rollover_policy_revisions` | root_id uuid expense-root FK(space,kind); enabled boolean; expected_revision_id nullable; stream space/currency/root. Default absent=disabled. |
| `budget_month_closes` | month_start normalized date; source_snapshot_id composite FK month/currency/space; expected_close_id nullable same month stream; fact_digest bytea (32 bytes); fact_count bigint≥0; root_count int0…200; closed_income_minor numeric(30,0); closed_spending_minor numeric(30,0); UNIQUE(id,space,currency,month). |
| `budget_month_close_roots` | close_id bigint FK same scope/month; root_id uuid; policy_revision_id nullable; enabled boolean; base_target_minor bigint; incoming_carry_minor numeric(30,0); actual_minor numeric(30,0); outgoing_carry_minor numeric(30,0); PK(close_id,root_id). |
| `budget_month_carry_links` | id bigint identity; space,currency; source_close_id bigint; target_snapshot_id bigint; root_id uuid; carry_minor numeric(30,0); UNIQUE(target_snapshot_id,root_id); FKs same tenant/currency; audit. |

Expand every field to explicit DDL with NOT NULL unless marked nullable.
Add deferred exact root_count, policy scope, target month=source month+1,
source_close snapshot/month agreement, and carry formula constraints. The initial
close predecessor is NULL; restatement appends another close. A carry link uses
an exact source close ID and never silently changes when that close is restated.
A changed source flags the target month as needing review. No update to old rows.

## 2. Freeze, don't pretend a timestamp is a snapshot

For each preview/close build one SQL statement CTE that selects all relevant
month facts then aggregates root actuals, income and a SHA256 of sorted fact
identities+amounts+classification metadata revision IDs. Freeze amounts and
that digest together. Include effective reversals by **their own business date**;
include current categorization revision IDs because later categorization can
change attribution. Count is part of the digest inputs. Do not fingerprint only
MAX(created_at) or MAX(uuid); transactions may commit out of order.

The saved close is exact as observed by that statement. Ordinary posting does
not share the planning lock. A later committed/backdated event is a new fact and
makes current fact digest differ: return restatementRequired=true. Do not claim
all concurrently committing transactions were included. No need to retain every
ledger row ID merely to preserve frozen totals; the underlying journal remains
immutable and the close stores actual sums. Full export has a separate manifest.
Use ordered aggregate hashing with a documented cap of100000 facts/month; on
excess refuse close with range_too_large, not truncated totals. Return exact
fact count and exercise statement timeout in tests. Raise future cap only after
measurement; normal live summaries still compute all facts within date range.

## 3. Public command/read signatures

All return JSON and common space/request replay rules apply to mutations.

| RPC | Exact args after p_space_id uuid | Result |
| --- | --- | --- |
| `preview_month_copy` | p_currency currency_code,p_source_snapshot_id bigint,p_target_month date | previewHash,sourceSnapshotId,targetMonth,expectedTargetSnapshotId,incomeMinor,groups,roots,goals,omissions,carrySources |
| `copy_allocation_month` | p_request_id uuid,p_currency currency_code,p_source_snapshot_id bigint,p_target_month date,p_expected_target_snapshot_id bigint,p_accepted_preview_hash text | snapshotId,sourceSnapshotId,previewHash |
| `preview_budget_month_close` | p_currency currency_code,p_month date,p_expected_close_id bigint | previewHash,month,expectedCloseId,snapshotId,incomeMinor,spendingMinor,roots,restatementRequired |
| `close_budget_month` | p_request_id uuid,p_currency currency_code,p_month date,p_expected_close_id bigint,p_accepted_preview_hash text | closeId,previewHash,restatesCloseId |
| `set_rollover_policy` | p_request_id uuid,p_currency currency_code,p_root_id uuid,p_enabled boolean,p_expected_revision_id bigint | revisionId |

Preview hashes are lower-case64hex canonical normalized inputs+all read dependency
heads+fact digests, not signed bearer authorization. Commands reauthorize,
replay then recompute the preview under the space lock and compare hash. A new
posting between preview and final command changes the digest and rejects stale;
a posting after the command's statement snapshot is detected by restatement.
Store the accepted hash in the receipt fingerprint. Hash mismatch returns40001.
Roots in previews: categoryId,nameEn,nameAr,baseMinor,carryMinor,effectiveMinor,
actualMinor,outgoingCarryMinor (money text, close-only fields nullable for copy).
Goals: goalId,groupId nullable,targetMinor. Groups same fields as allocation
snapshot. Omission: entityId,kind,reason archived/closed/currency_mismatch.
carrySources: rootId,sourceCloseId,carryMinor. Omission lists bounded200 roots+
100 goals; do not silently omit. All existing positive target heads in destination
participate in the preview; copying requires explicit replace acknowledgement
represented by accepting that exact preview hash and expected target head.

Copy: validate target distinct from source, month normalized, ≤24 months from
source. Copy template percentages and base expected income, not actual salary,
spending or current earmarks. Exclude archived roots/closed goals from new
selection and show omissions; a zero clear is explicitly included for positive
destination targets being replaced. Reuse publish_allocation_month_v2 with derived
request UUID; the snapshot transaction records carry links. Recurring occurrences
are not duplicated by copy. Loan commitments are re-observed for target month.

Rollover: enabled root only, outgoing = baseTarget+incomingCarry−netActual,
**signed**, no clamp. Effective spend ceiling may be negative after overspending;
show it and never turn carry into salary. Percentage group targets continue to
sum to expected income; show carry as a distinct adjustment, not redistributed
percentages. Group effective capacity=base group target+sum root carry. Standalone
root carry stays standalone. Task 06/17 projections subtract actuals from effective
capacity after this task; all conservation fixtures must include carry separately.
Disabled roots outgoing0. Incoming comes from an accepted immediately prior
month close, never a live report. Cannot close current/future month; UTC month
must have ended. Re-close appends restatement with current snapshot/facts/policies;
copy does not auto-refresh existing carry links. User explicitly republishes
next month from new preview to accept changed carry.

## 4. Tests and exit

Base10000, actual8000 → carry2000; next base10000 → effective12000.
Base10000, actual12000 → carry−2000; next effective8000. Disabled→0.
Next-month income unchanged in both cases. Root overspend can outweigh group
remaining; include cross-root/group sum reconciliation. Refund/inverse by later
month's business date changes that later month; backdated event changes prior
fact digest and requires restatement. Equal timestamps and late commit cannot
silently preserve the same fact digest. Concurrent copy of same expected target
head: one success; same UUID replay stable. Mutated preview, tenant/currency
crosslinks, missing child, late child append, NULL/ACL and seeded-upgrade tests.

Run all three focused files and full env-loaded DB check; evidence20 must include
two connections demonstrating the documented late-commit/restatement behavior.
Commit `feat(planning): add explicit month copy and signed rollover`; stop DB.
