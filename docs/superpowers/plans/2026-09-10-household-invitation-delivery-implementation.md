# Household Invitation Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully testable Cloudflare Worker boundary that creates an existing protected Household invitation and submits one bilingual transactional email through Resend without exposing secrets or changing database behavior.

**Architecture:** A Worker route validates and bounds the HTTP request, applies injected Cloudflare rate limiters, forwards the caller JWT to the existing Supabase RPC, and hands the returned one-time token to a pure delivery service. Focused adapters own Supabase and Resend HTTP details; templates and audit events are typed, deterministic, redacted, and independently testable.

**Tech Stack:** TypeScript 7, Cloudflare Workers static assets and rate limiting bindings, native Fetch/Web Crypto APIs, Vitest 5, existing Supabase PostgREST RPC.

---

## File map

- `worker/household-invitations/contracts.ts`: shared request, port, result, error, binding, clock, and audit types.
- `worker/household-invitations/validation.ts`: bounded JSON/header/configuration validation and hashed limiter keys.
- `worker/household-invitations/templates.ts`: fixed accessible English and Arabic HTML/plain-text invitation content.
- `worker/household-invitations/supabase-invitations.ts`: bounded authenticated PostgREST RPC adapter.
- `worker/household-invitations/resend.ts`: bounded Resend single-email HTTP adapter and retry classification.
- `worker/household-invitations/deliver.ts`: command-to-provider orchestration, idempotency cutoff, retry loop, and redacted audit events.
- `worker/index.ts`: API routing, CORS, rate limiting, dependency composition, safe responses, and static asset fallback.
- `tests/worker/*.test.ts`: network-free contract, template, adapter, service, handler, and source-ratchet tests.
- `wrangler.jsonc`: Worker module, assets binding, and two rate-limit binding declarations.
- `tsconfig.json`: include Worker TypeScript in strict checking.
- `package.json`: add the focused Worker test command and include it in repository gates.
- `docs/operations/household-invitation-delivery.md`: configuration and live-send approval runbook.
- `docs/decisions.md`: append the approved runtime, idempotency, and rate-limit defaults.

### Task 1: Freeze validation and configuration contracts

**Files:**
- Create: `tests/worker/household-invitation-validation.test.ts`
- Create: `worker/household-invitations/contracts.ts`
- Create: `worker/household-invitations/validation.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing validation tests**

Cover canonical UUIDs, `en|ar`, 254-byte email maximum, control characters,
4 KiB request bodies, exact bearer syntax, HTTPS credential-free origins,
nonempty server bindings, and deterministic domain-separated SHA-256 keys.
Assert thrown errors contain only fixed field/category names and not supplied
values.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/household-invitation-validation.test.ts`

Expected: FAIL because `worker/household-invitations/validation.ts` does not exist.

- [ ] **Step 3: Add minimal strict types and validators**

Define `DeliveryRequest`, `WorkerBindings`, `RateLimiter`, `AuditSink`,
`SafeDeliveryError`, `readBoundedBody`, `parseBearerToken`,
`validateDeliveryRequest`, `validateBindings`, and `hashRateLimitKey`. Read the
body stream incrementally and cancel once the UTF-8 byte cap is exceeded.

- [ ] **Step 4: Verify focused green state**

Run: `pnpm exec vitest run tests/worker/household-invitation-validation.test.ts && pnpm typecheck`

Expected: all validation tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json tests/worker/household-invitation-validation.test.ts worker/household-invitations/contracts.ts worker/household-invitations/validation.ts
git commit -m "feat(delivery): validate invitation requests"
```

### Task 2: Build accessible bilingual templates

**Files:**
- Create: `tests/worker/household-invitation-templates.test.ts`
- Create: `worker/household-invitations/templates.ts`

- [ ] **Step 1: Write failing semantic template tests**

Assert English uses `lang="en" dir="ltr"`, Arabic uses
`lang="ar" dir="rtl"`, both repeat attributes on the direct body wrapper,
contain one `<title>` and one `<h1>`, provide a 44-pixel action target, include
seven-day expiry and unexpected-invitation guidance, escape interpolated values,
and provide equivalent plain text. Assert the raw token appears only after `#`
inside the acceptance URL and never in subjects.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/household-invitation-templates.test.ts`

Expected: FAIL because `worker/household-invitations/templates.ts` does not exist.

- [ ] **Step 3: Implement fixed locale templates**

Export `buildInvitationEmail({ locale, appOrigin, invitationToken, expiresAt })`
returning `{ subject, html, text }`. Construct
`<origin>/#household-invitation=<encoded token>`, use separate authored locale
copy, a single-column layout, no images or tracking markup, and safe escaping.

- [ ] **Step 4: Verify focused green state**

Run: `pnpm exec vitest run tests/worker/household-invitation-templates.test.ts && pnpm typecheck`

Expected: all template tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/worker/household-invitation-templates.test.ts worker/household-invitations/templates.ts
git commit -m "feat(delivery): add bilingual invitation emails"
```

### Task 3: Add bounded Supabase command adapter

**Files:**
- Create: `tests/worker/supabase-invitations.test.ts`
- Create: `worker/household-invitations/supabase-invitations.ts`
- Modify: `worker/household-invitations/contracts.ts`

- [ ] **Step 1: Write failing adapter tests**

Inject a fake fetch and assert one POST to
`/rest/v1/rpc/create_household_invitation`, exact parameter names, caller bearer
forwarding, publishable-key use, a ten-second abort deadline, bounded success
parsing, canonical returned UUID/time/token validation, and safe status-only
errors. Assert no service-role header, direct table path, retry, or supplied value
appears in error text.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/supabase-invitations.test.ts`

Expected: FAIL because the Supabase adapter does not exist.

- [ ] **Step 3: Implement the command-only adapter**

Create `createSupabaseInvitationCommand({ fetch, baseUrl, anonKey, timeoutMs })`
with one `create({ bearerToken, spaceId, requestId, inviteeEmail })` method. Use
an `AbortController`, clear its timer in `finally`, cap the success response at
4 KiB, validate the exact one-row response, and map failures to fixed safe
categories without reading provider error bodies.

- [ ] **Step 4: Verify focused green state**

Run: `pnpm exec vitest run tests/worker/supabase-invitations.test.ts && pnpm typecheck`

Expected: all Supabase adapter tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/worker/supabase-invitations.test.ts worker/household-invitations/contracts.ts worker/household-invitations/supabase-invitations.ts
git commit -m "feat(delivery): call protected invitation command"
```

### Task 4: Add bounded Resend provider adapter

**Files:**
- Create: `tests/worker/resend.test.ts`
- Create: `worker/household-invitations/resend.ts`
- Modify: `worker/household-invitations/contracts.ts`

- [ ] **Step 1: Write failing provider tests**

Inject fake fetch responses and assert the adapter POSTs to Resend's single-email
endpoint with bearer custody, one recipient, `from`, `reply_to`, subject, HTML,
text, fixed non-sensitive tags, and the supplied idempotency header. Cover the
ten-second abort, 1 KiB success cap, explicit success-body validation, retryable
network/429/5xx classification, permanent 4xx classification, and discarded
provider error text.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/resend.test.ts`

Expected: FAIL because the Resend adapter does not exist.

- [ ] **Step 3: Implement the narrow HTTP adapter**

Export `createResendProvider({ fetch, apiKey, timeoutMs })`. Its `send` method
returns only `{ providerMessageId }` on success and throws a typed provider error
with `{ category, retryable }` on failure. Never copy the response error message
or request payload into the error.

- [ ] **Step 4: Verify focused green state**

Run: `pnpm exec vitest run tests/worker/resend.test.ts && pnpm typecheck`

Expected: all provider tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/worker/resend.test.ts worker/household-invitations/contracts.ts worker/household-invitations/resend.ts
git commit -m "feat(delivery): add bounded Resend adapter"
```

### Task 5: Orchestrate idempotent delivery and redacted audit

**Files:**
- Create: `tests/worker/household-invitation-delivery.test.ts`
- Create: `worker/household-invitations/deliver.ts`
- Modify: `worker/household-invitations/contracts.ts`

- [ ] **Step 1: Write failing service tests**

Using in-memory command/provider/audit ports, prove exact command forwarding;
stable `household-invitation/<invitation-id>` idempotency; locale selection;
success mapping; retries only for transient categories; delays capped at two;
three provider attempts maximum; no command retry; immediate permanent failure;
23-hour cutoff derived from seven-day expiry; and a cancellable pending
invitation after provider failure. Inspect every audit event and public error for
absence of email, token, URL, JWT, raw IDs, raw IP, provider messages, and thrown
exception text.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/household-invitation-delivery.test.ts`

Expected: FAIL because the delivery service does not exist.

- [ ] **Step 3: Implement the delivery service**

Export `createHouseholdInvitationDelivery(dependencies)` with one `deliver`
method. Use exactly three loop iterations, injected bounded sleep/jitter/clock,
fixed audit-event constructors, the approved template builder, and typed safe
errors. Do not retain request data outside the method.

- [ ] **Step 4: Verify focused green state**

Run: `pnpm exec vitest run tests/worker/household-invitation-delivery.test.ts && pnpm typecheck`

Expected: all delivery-service tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/worker/household-invitation-delivery.test.ts worker/household-invitations/contracts.ts worker/household-invitations/deliver.ts
git commit -m "feat(delivery): orchestrate idempotent invitation mail"
```

### Task 6: Wire the Worker route and fail-closed throttles

**Files:**
- Create: `tests/worker/worker-handler.test.ts`
- Create: `worker/index.ts`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Write failing handler tests**

Use fake bindings to cover exact route/method/content type/origin/header/body
requirements, preflight, 4 KiB streaming rejection, IP limiter then actor-space
limiter order, fail-closed limiter errors, safe HTTP status mapping, no sensitive
response content, one dependency composition, and `ASSETS.fetch` fallback for
every non-API request. Prove rejected requests never reach Supabase or Resend.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/worker-handler.test.ts`

Expected: FAIL because `worker/index.ts` does not exist.

- [ ] **Step 3: Implement the Worker handler**

Export the Worker default handler and a dependency-injectable
`createWorkerHandler`. Validate bindings per API request, set CORS only for the
exact configured origin, hash limiter inputs before `.limit({ key })`, compose
the two adapters and delivery service, and map only `SafeDeliveryError` fields to
JSON. Route all other requests to `env.ASSETS.fetch(request)`.

- [ ] **Step 4: Configure the module and bindings**

Set `main` to `worker/index.ts`; preserve the current assets directory and SPA
fallback; name the assets binding `ASSETS`; run the Worker first for `/api/*`;
declare separate rate-limit namespaces for 20 requests per 60 seconds and three
requests per 3,600 seconds. Commit no binding values or secrets.

- [ ] **Step 5: Verify focused green state**

Run: `pnpm exec vitest run tests/worker/worker-handler.test.ts && pnpm typecheck && pnpm exec wrangler deploy --dry-run`

Expected: all handler tests pass, TypeScript reports no errors, and Wrangler
builds the Worker/static-assets bundle without deploying it.

- [ ] **Step 6: Commit**

```bash
git add tests/worker/worker-handler.test.ts worker/index.ts wrangler.jsonc
git commit -m "feat(delivery): expose guarded invitation endpoint"
```

### Task 7: Add source ratchets and operational handoff

**Files:**
- Create: `tests/worker/household-invitation-source-ratchet.test.ts`
- Create: `docs/operations/household-invitation-delivery.md`
- Modify: `tests/ops/cloudflare-deployment-contract.test.ts`
- Modify: `docs/operations/cloudflare-deployment.md`
- Modify: `docs/decisions.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing ratchet and configuration tests**

Scan tracked runtime files to reject `VITE_RESEND`, service-role names, direct
Household table mutations, console/logger calls with sensitive identifiers,
unbounded loops, missing Worker/rate-limit bindings, secret-shaped committed
values, and changed existing RPC signatures. Extend the Cloudflare contract test
to require the Worker entry/assets behavior without weakening current build and
deployment assertions.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/worker/household-invitation-source-ratchet.test.ts tests/ops/cloudflare-deployment-contract.test.ts`

Expected: FAIL until the runbooks and configuration contract describe the new
server boundary.

- [ ] **Step 3: Document the handoff and decision**

Append one decision recording Cloudflare Worker runtime, no database change,
three/hour actor-space and 20/minute IP defaults, 23-hour resend cutoff, and what
changes if those defaults change. Add a runbook that lists exact secret/binding,
domain authentication, tracking, synthetic test, bounce/complaint, deployment,
and Household UI approvals while explicitly forbidding real sends. Update the
existing Cloudflare runbook and README with offline verification only.

- [ ] **Step 4: Verify focused green state**

Run: `pnpm exec vitest run tests/worker tests/ops/cloudflare-deployment-contract.test.ts && pnpm typecheck && git diff --check`

Expected: all focused tests pass, TypeScript reports no errors, and Git finds no
whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/decisions.md docs/operations/cloudflare-deployment.md docs/operations/household-invitation-delivery.md tests/ops/cloudflare-deployment-contract.test.ts tests/worker/household-invitation-source-ratchet.test.ts
git commit -m "docs(delivery): record invitation email boundary"
```

### Task 8: Run complete verification and review scope

**Files:**
- Modify only if a verified defect in this milestone requires a red test and fix.

- [ ] **Step 1: Install the frozen graph**

Run: `pnpm install --frozen-lockfile`

Expected: exit 0 with no lockfile changes and no ignored build-script warning.

- [ ] **Step 2: Run Worker and offline application gates**

Run: `pnpm test:worker && pnpm check:ops && pnpm typecheck && pnpm test:ui && pnpm build && pnpm deploy:cloudflare:dry-run`

Expected: every command exits 0; the dry run creates no deployment.

- [ ] **Step 3: Run the real-Postgres regression gate**

Load the authoritative ignored `.env.test` without printing it, verify the
database identity/role contract, then run `pnpm test:db`.

Expected: all database integration tests pass against the intended isolated
Budget PostgreSQL engine with no migration or hosted-state change.

- [ ] **Step 4: Audit repository scope and secrets**

Run: `git diff 4018d81...HEAD --check`, inspect `git diff --stat
4018d81...HEAD`, run the repository source ratchets, confirm `git status
--short`, and inspect every commit since `4018d81`.

Expected: only the planned Worker, tests, configuration, documentation, and
decisions files changed; no secret, migration, browser Household UI, financial
file, or production value is present; the worktree is clean.

- [ ] **Step 5: Independent review**

Review the complete immutable diff for authorization preservation, secret
custody, timeout/retry bounds, idempotency window, rate-limit fail-closed
behavior, PII/token redaction, bilingual accessibility, Cloudflare deployment
regression, and live-send approval boundaries. Any finding requires a failing
test before correction and a separate conventional commit.

- [ ] **Step 6: Report exact evidence**

Report commit hashes, exact test counts and commands, dry-run result, database
identity and test count without credentials, scope status, and the separate
provider/DNS/Cloudflare/deployment/UI/operations approvals still required. State
explicitly that no real email was sent and nothing was deployed, pushed,
migrated, or changed in hosted systems.
