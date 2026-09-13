# 52 — Offline entry and replay feasibility

**Layer:** evidence/specification only. **Roadmap:** E4.
**Depends on:** current core plans; no application implementation permission.
Read [00-start-here.md](00-start-here.md). Execute this bounded discovery task,
not a guessed database integration.

## Deliverables and missing-input handling

Deliver `docs/product/evidence/offline-entry.md` and a disposable browser test
harness under `artifacts/offline-entry-research/` excluded from production bundling.
No service worker installed in the live app. Test current supported desktop/mobile
browsers for IndexedDB persistence, quota, private mode, eviction and shared-device
sign-out behavior; record actual browser/version and blocked surfaces.

## Ordered work and acceptance

1. Inventory supplied inputs, consent and source dates; distinguish real from
   synthetic evidence. Do independent schema/fixture work while inputs are pending.
2. Follow the fixed investigation contract below.
3. Write a result matrix: proven, failed, blocked with exact missing input. List
   executable next-layer files only when their financial/provider contract closes.
4. Validate fixture syntax, links and numerical examples; commit documentation
   and sanitized fixtures only. No external upload/send/production SQL.

Candidate outbox record: version1,request UUID,actorUUID,spaceUUID,commandName,
validatedPayload,createdAtLocal(non-audit),state draft/queued/ambiguous/accepted/
rejected. Cap100 records/1MiB, no tokens/receipts/attachments; never silently evict
unsubmitted money intent. Default sync requires explicit review after reauth;
server assigns audit time and rechecks membership, wallet/category lifecycle and
idempotency. Lost response reconciles journal/planning receipt correctly. Sign-out
must clearly handle pending drafts before deletion; shared-device policy requires
owner decision. Simulate duplicate replay, crash-after-commit, revoked membership,
archived wallet, stalehead, clockchange and two tabs. Measure success and data-loss
cases; produce exact migration/gateway/UI follow-up files only after policy is
selected. Installable shell26b is independent of offline financial writes.

A smaller model may finish this evidence deliverable with named blocked rows;
it must not label the dependent feature implementation-ready or implemented.
The task has no fake success quota when real inputs are absent.
