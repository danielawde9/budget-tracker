# 51 — Receipt draft privacy and extraction evidence

**Layer:** evidence/specification only. **Roadmap:** E2.
**Depends on:** current core plans; no application implementation permission.
Read [00-start-here.md](00-start-here.md). Execute this bounded discovery task,
not a guessed database integration.

## Deliverables and missing-input handling

Deliver `docs/product/evidence/receipt-drafts.md`, threat/data-flow diagram and
sanitized extraction fixtures under `tests/fixtures/receipts/` only from explicitly
supplied images. Need20 varied receipts including Arabic, glare, totals/tax/tip,
USD/LBP and handwritten changes. Do not upload receipts to a provider during this
task. Complete local validation fixtures without real receipt input if missing.

## Ordered work and acceptance

1. Inventory supplied inputs, consent and source dates; distinguish real from
   synthetic evidence. Do independent schema/fixture work while inputs are pending.
2. Follow the fixed investigation contract below.
3. Write a result matrix: proven, failed, blocked with exact missing input. List
   executable next-layer files only when their financial/provider contract closes.
4. Validate fixture syntax, links and numerical examples; commit documentation
   and sanitized fixtures only. No external upload/send/production SQL.

Fix candidate upload contract for review: private object UUID,space,owner,
SHA256,mime JPEG/PNG/PDF,size≤10MiB,pages≤5,created_at,expiry7days; no public URL,
SVG/HTML/executable formats denied. Image decode/OCR runs with resource timeout;
storage authorization tested on each read and signed URL expiry≤60seconds.
Delete original and derived text together on expiry; do not claim secure device
backup deletion. Compare only primary provider privacy/retention terms and local
OCR alternative; record cost/license/runtime evidence and owner selection needed.
Evaluate exact total/currency vs subtotal ambiguity, never guess a paid amount
from OCR confidence alone. Output a concrete storage SQL/RLS migration outline,
provider adapter shape extract->typed draft, and20 golden expected fields. This
is an evidence gate until provider/retention choice and consent exist; no adopted
service or upload is implied by writing the plan.

A smaller model may finish this evidence deliverable with named blocked rows;
it must not label the dependent feature implementation-ready or implemented.
The task has no fake success quota when real inputs are absent.
