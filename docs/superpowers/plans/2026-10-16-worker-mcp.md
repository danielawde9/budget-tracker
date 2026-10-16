# Worker MCP Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** Save requested income and expenses directly from Codex through Cloudflare.
**Architecture:** Worker-issued opaque OAuth tokens and hashed per-client grants;
stateless MCP Worker; bilingual consent/revocation in Budget.
**Tech Stack:** TypeScript, MCP SDK, Workers OAuth Provider, Supabase/Postgres, React.
**Spec:** `docs/superpowers/specs/2026-10-16-worker-mcp-design.md`

## Global Constraints
- Existing browser commands and ledger invariants remain authoritative.
- Resource: `https://mcp.openbudgetracker.app/mcp`; backend role: `anon` with narrow credential-bearing RPCs.
- Direct posting was explicitly authorized; no draft approval screen.
- No service-role credentials, passwords or refresh tokens in the Worker.

## Review Focus
- MCP tokens cannot be used as Supabase login tokens or bypass the narrow API.
- Revocation and concurrent retry never allow partial or duplicate writes.
- Integer money and wallet currency agree, including LBP.
- Stale authorization responses cannot switch the user/client/space.
- Deployment must bind OAuth KV, public backend key, custom domain and consent origin.

### Task 1: Database boundary
Files: new MCP migration, `tests/db/mcp-connector.test.ts`.
Interfaces: owner `mcp_grant_client`, `mcp_connections`, `mcp_revoke_client`;
connector `mcp_context`, `mcp_record_entry`, `mcp_entry_status`;
Connection `mcp_exchange_code` consumes a five-minute one-time code.
- [x] Write database tests for grants, direct posting, receipts, retries,
  conflict, isolation, exact money and revocation; run and observe failures.
- [x] Implement hashed grants, one-time codes and RPCs composing existing commands.
- [x] Run database suite and correct failures.

### Task 2: Hosted MCP transport
Files: `worker/mcp/*`, `wrangler.mcp.jsonc`, worker test/typecheck config, package scripts.
Interfaces: authenticated stateless `/mcp`, protected-resource discovery, health.
- [x] Write OAuth/HTTP/tool validation tests and observe failures.
- [x] Implement opaque OAuth/resource validation, tools, bounds and rate limits.
- [x] Run Worker tests, typecheck and Wrangler dry run.

### Task 3: Consent and connection management
Files: consent and connection components, API methods, app/settings integration.
Interfaces: `/oauth/consent?connection_id=...`; existing signed-in gate.
- [x] Write consent tests for client/space binding and failure handling.
- [x] Implement bilingual approval, denial and revocation.
- [x] Run UI suite, typecheck and production build.

### Task 4: Deployment and acceptance
Files: operations runbook; config/script corrections as needed.
- [x] Review privilege and authentication boundaries and run complete checks.
- [x] Deploy migration/consent/Worker and configure Worker OAuth and KV.
- [x] Smoke-test health, discovery, unauthorized MCP and authenticated local flow.
- [x] Register Codex MCP endpoint and start user-controlled OAuth sign-in.
- [x] Record any access or login step that prevents end-to-end acceptance.

## Execution record

Executing inline in the existing managed worktree. The user's “yes build it”
approves the hosted/direct-post design and authorizes implementation; no further
planning approval is needed. Production data-entry tests use a local test user.

Ruling: preserve the app's automatic coverage from Ready to assign. Inspection
of `budget.charge_item` showed this is existing expense behavior; requiring a
new coverage confirmation would contradict the requested direct-save flow.

Ruling: independent security review found native Supabase OAuth JWTs can reach
Auth account-management APIs despite a restricted database role. Replaced that
approach with Cloudflare-issued opaque tokens and hashed connection credentials.
Supabase native OAuth and token hooks were never enabled. Second review found
no deployment blockers. Migration applied as `20261016134130_mcp_connector.sql`.

Validation: 242 database tests, 208 UI tests and 5 MCP tests passed; production
build and both Wrangler dry runs passed. Browser sign-in by the owner is the
remaining connection acceptance step; no production financial test entries made.
