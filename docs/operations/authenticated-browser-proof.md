# Signed-in browser proof on a deployed origin

This procedure collects the evidence for the **authenticated** half of the
post-deploy smoke checks in `docs/operations/cloudflare-deployment.md` (its
"Post-deploy smoke checks" items 2–4). The deployment runbook is the release
boundary; this file only says how to *prove*, on a real deployed origin, that an
authenticated session reads its own RLS-scoped data and that one permitted
financial mutation persists.

Use **only a synthetic or replaceable account** created for this proof, with its
own space, wallets and categories. Never use a customer account or live customer
financial data. Retain only non-sensitive evidence: no access tokens, refresh
tokens, service keys, or full request headers.

## Preconditions

- A deployed origin (the generated `workers.dev` address, or another approved
  origin). Record it verbatim — the proof is scoped to that origin and time.
- The release version/hash under test (the Cloudflare version you deployed).
- A synthetic account you can sign in and out of, plus a **second** synthetic
  account (or space) you do **not** have membership in, for the negative RLS
  check.
- Browser developer tools open on the Network tab, with "preserve log" on.

## Evidence to capture

For every step, record: UTC timestamp, the origin URL, the release version/hash,
the request method + path (not the token), the response status, and a screenshot
with any credential masked. Redact `Authorization`, `apikey`, and cookie values
from any captured request.

## Procedure

### 1. Authenticated session (deployment runbook item 2)

1. Load `/` over HTTPS and confirm the app shell renders.
2. Sign in as the **synthetic** account. Confirm the session is established
   (the app shows the account's space; a hard refresh keeps you signed in).
3. Confirm no token appears in the URL bar, console output, or screenshots.
4. Reload a deep application URL and confirm it refreshes back to the SPA shell
   (deployment runbook item 1).

Evidence: screenshot of the signed-in shell; note that no token is captured.

### 2. RLS-visible read (deployment runbook item 3)

1. Open the synthetic account's own wallet/categories/ledger. The values shown
   must match the synthetic fixture you created, and **only** that space.
2. In the Network tab, capture the read the app issued (a PostgREST select or an
   approved read RPC). Confirm the response contains only the synthetic
   account's rows.
3. Negative check — prove the boundary holds, not just that a read succeeded.
   With the synthetic account's own session (e.g. read its access token from
   `supabase.auth.getSession()` in the console and use it out-of-band, or issue
   the equivalent request from the app's own client), attempt to read a
   **different** account's space/wallet/ledger row directly by id. The request
   must be **refused** — RLS returns zero rows, or the command is rejected
   (HTTP 401/403, or a permission error in the body).

Evidence: the read request path + status and row counts for the allowed read;
the refused request path + status/error body for the cross-tenant read; a
screenshot of the app showing the synthetic data. Record row counts, not row
contents, for the negative check.

### 3. One permitted financial mutation (deployment runbook item 4)

Choose the app's **approved command path** for a small synthetic movement (for
example, recording a small expense from a synthetic wallet). Do not call a
mutation RPC directly from a script: the point is to prove the app's own path.

1. Note the synthetic wallet's **before** balance (from the app).
2. Perform the single mutation in the UI. Capture the command request (path and
   the idempotency/request id if the payload carries one) and its success
   response.
3. Reload the page. Confirm:
   - the derived balance moved by exactly the mutated amount; and
   - the immutable history/ledger shows the new event with the expected date and
     amount, and the event is not repeated after the reload.

Evidence: before/after balance screenshots; the command request path + status;
the history entry after reload. One mutation only — do not use this procedure to
exercise volume, concurrency, or repeated submission.

### 4. Sign out (deployment runbook item 2)

Sign out and confirm the session is cleared (protected routes no longer render
the account's data) without printing tokens.

## What this proves

On that deployed origin, at that time, for that release:

- Auth issues a usable session for the synthetic account.
- RLS-scoped reads return the authenticated tenant's rows, and a direct
  cross-tenant read is refused.
- The approved command surface accepts one financial mutation, persists it, and
  the derived read reflects it after a reload.

## What this does **not** prove

- Nothing about a custom domain, DNS, routes, or access policy (owner-gated,
  separate from this proof).
- Nothing about production Auth configuration beyond this one synthetic
  session.
- Not that **every** RLS policy is correct — only the specific paths probed.
- Not idempotency/retry behaviour under uncertain transport, nor concurrency,
  load, or partial-failure handling.
- Not database persistence beyond the reloaded read, and not backup,
  restore, or rollback. A successful local build, a Cloudflare dry-run, a
  successful upload, or the offline browser suite are **not** substitutes.
- Nothing about any live customer's data, and no authorization for email sends,
  hosted-secret changes, or deployment.

If any step fails, follow the deployment runbook's *Rollback and recovery
evidence* section: stop rollout, roll back via the Cloudflare version controls,
and record the release version, time, operator, symptom, rollback result, and
follow-up owner.
