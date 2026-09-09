# Budget UAT 18-Migration Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision and verify one disposable, tailnet-private Budget UAT stack for release `6af62c1b0105b75a9796cfb299791f4c26a7dd2e` with exactly the reviewed 18-migration schema, without changing the existing Budget development stack or any Sandooq/POS resource.

**Architecture:** Add a fail-closed operator entrypoint for one exact environment, `budget-uat-18`, rooted at `/home/lelabo/budget-uat-18` on `lelabo@100.76.160.91`. Run only PostgreSQL 17, GoTrue, PostgREST, and a path-routing Kong gateway in a dedicated Docker Compose project, network, and volume; pin the image digests already measured on the Budget development host, bind published ports to loopback, keep restart policy `no`, and add private HTTPS through an additive Tailscale Serve handler only if the existing configuration can be preserved byte-for-byte apart from the new handler. Generate credentials on Ubuntu into a mode-`0600` ignored environment file, copy only reviewed infrastructure inputs and the 18 release migrations, and retain only sanitized receipts in Git.

**Tech Stack:** Bash with bounded SSH/curl/Docker operations, Docker Compose, Supabase PostgreSQL 17.6.1.165, GoTrue 2.196.0, PostgREST 16.1, Kong 2.8.1, Tailscale Serve 1.102.3, Vitest, PostgreSQL catalog checks, and SHA-256 manifests.

---

## Fixed identity and safety contract

- Release head: `6af62c1b0105b75a9796cfb299791f4c26a7dd2e`.
- SSH target: `lelabo@100.76.160.91`; remote hostname and Tailscale IPv4 must be `lelabo` and `100.76.160.91`.
- UAT directory/project/marker: `/home/lelabo/budget-uat-18`, `budget-uat-18`, `.budget-uat-18-project`.
- Loopback ports: gateway `54521`, PostgreSQL `54522`; no other host port is published.
- Docker identities: containers `budget-uat-18-{db,auth,rest,kong}`, network `budget-uat-18-net`, volume `budget-uat-18-db-data`.
- Restart policy: `no`; UAT remains opt-in across host reboots.
- Existing development invariant: project `budget-supabase`, 12 containers, PostgreSQL system identifier `7683090997378195493`, 31 ordered migrations ending `20260908180000`, restart counts zero at the recorded before-snapshot. Re-measure rather than trust the recorded values.
- Candidate HTTPS: `https://lelabo-ubuntu-server.tail944994.ts.net:54521/`, tailnet only. If the installed Tailscale configuration cannot add this handler without changing existing TCP routes, keep HTTPS blocked and do not substitute public HTTP, Funnel, LAN binding, or weak TLS.

### Task 1: Add the exact UAT environment contract and red tests

**Files:**

- Create: `ops/uat/budget-uat-18.env.example`
- Create: `ops/uat/docker-compose.yml`
- Create: `ops/uat/kong.yml`
- Create: `scripts/ops/budget-uat-18.sh`
- Create: `tests/ops/budget-uat-18.test.ts`
- Modify: `scripts/ops/check-budget.sh`
- Modify: `package.json`

- [ ] **Step 1: Write failing static contract tests**

  Assert exact host, root, project, marker, ports, container/network/volume names, four pinned image digests, loopback-only port mappings, restart policy `no`, no privileged containers, no existing-resource lifecycle command, no `supabase start|stop|db reset|nuke`, no secret value in tracked files, a 300-second health bound, and cleanup refusal unless the exact marker and Docker labels match.

- [ ] **Step 2: Verify RED**

  Run `pnpm exec vitest run tests/ops/budget-uat-18.test.ts --pool=forks --no-file-parallelism`. Expected: fail because the UAT files and entrypoint do not exist.

- [ ] **Step 3: Implement the minimal static inputs and command dispatcher**

  The dispatcher exposes only `preflight`, `sync`, `provision`, `verify`, `stop`, and `cleanup`; sets `umask 077`; uses fixed SSH timeout options; checks exact Git head and clean migration inputs; validates the canonical 18-row manifest before SSH; rejects occupied ports/names/paths; snapshots existing Budget development identities before and after every mutating command; never prints or requests secret values; and delegates remote work only to the synchronized, hash-verified script snapshot.

- [ ] **Step 4: Verify GREEN**

  Run the focused Vitest file, `bash -n scripts/ops/budget-uat-18.sh`, and `BUDGET_OPS_STATIC_ONLY=1 pnpm check:ops`. Expected: all pass and the secret scan names files only.

- [ ] **Step 5: Commit**

  Commit `feat(ops): enforce isolated budget uat contract`.

### Task 2: Add deterministic migration, secret, health, and cleanup mechanics

**Files:**

- Create: `ops/uat/budget-uat-18-migrations.sha256`
- Create: `ops/uat/remote-budget-uat-18.sh`
- Modify: `tests/ops/budget-uat-18.test.ts`
- Modify: `scripts/ops/check-budget.sh`

- [ ] **Step 1: Write failing behavior tests**

  In a private fixture root with fake Docker/SSH adapters, prove the remote helper rejects a missing/wrong marker, nonempty migration journal, manifest count other than 18, reversed/duplicate/unknown versions, a changed SQL hash, unsafe file mode, reused secret file, occupied port, pre-existing foreign container/network/volume, and cleanup labels that do not exactly equal `budget-uat-18`. Prove error text never includes injected secret fixtures.

- [ ] **Step 2: Verify RED**

  Run the focused Vitest file. Expected: the new behavior tests fail on missing commands.

- [ ] **Step 3: Implement minimal remote mechanics**

  Generate PostgreSQL/JWT/admin credentials and anon/service JWTs with host CSPRNGs only when `.env` is absent; write directly through a no-follow exclusive descriptor at mode `0600`; never emit them. Validate the release manifest and remote SQL hashes before `docker compose up`; wait at most 60 five-second polls; apply each migration in one transaction and insert its version/name into `supabase_migrations.schema_migrations`; verify exactly 18 ordered rows; and make stop/cleanup exact-label, exact-root, marker-gated operations. Cleanup removes only the four named UAT containers, its named network, named volume, and exact marked root after the operator invokes `cleanup`.

- [ ] **Step 4: Verify GREEN and the redaction ratchet**

  Run the focused tests, all ops tests, shell syntax, and the tracked secret scan. Expected: all pass; no test or command output contains the fixture secret.

- [ ] **Step 5: Commit**

  Commit `feat(ops): add disposable budget uat lifecycle`.

### Task 3: Provision and verify the isolated stack

**Files:**

- Create: `docs/operations/private-uat-infrastructure.md`
- Create: `artifacts/private-uat/2026-09-09-uat-infrastructure-receipt.md`

- [ ] **Step 1: Repeat read-only preflight**

  Run `scripts/ops/budget-uat-18.sh preflight`. It must recheck host/Tailscale identity, capacity, candidate ports, exact path absence or matching marker, Docker collisions, existing Tailscale Serve configuration, Budget development container IDs/restart counts/health, system identifier, and ordered 31-row journal. Stop on ambiguity.

- [ ] **Step 2: Synchronize only reviewed inputs**

  Run `scripts/ops/budget-uat-18.sh sync`. Re-read the remote inventory and verify restrictive modes before proceeding.

- [ ] **Step 3: Provision once**

  Run `scripts/ops/budget-uat-18.sh provision`. It must create only the named UAT Docker resources, generate host-only secrets, start four containers with restart policy `no`, and apply only the 18 manifest rows.

- [ ] **Step 4: Verify platform, schema, Auth, API, and RLS**

  Run `scripts/ops/budget-uat-18.sh verify`. The receipt must prove PostgreSQL 17 and a new system identifier, exactly 18 ordered journal rows, 18/18 SQL hashes, expected RLS/table/function ACL catalog invariants, real `.test` Auth signup/sign-in/refresh/global-signout with revoked refresh rejection, PostgREST and at least one protected RPC execution, anonymous read/RPC rejection, two-user cross-tenant rejection, healthy containers, restart policy `no`, loopback-only ports, and unchanged development-stack identity/restart counts/journal. Use synthetic data only and delete the disposable Auth/data by removing the UAT stack later, not by weakening immutable ledger guards.

- [ ] **Step 5: Write sanitized evidence and operator runbook**

  Record exact non-secret identities, commands, status tuples, file permissions, start/stop/cleanup/recovery instructions, and browser-emulation versus physical-device boundaries. Never include keys, passwords, tokens, credential-bearing URLs, synthetic email addresses, or raw personal data.

- [ ] **Step 6: Commit**

  Commit `docs(ops): record exact-schema uat infrastructure`.

### Task 4: Add private HTTPS only through a preserved Serve configuration

**Files:**

- Modify: `ops/uat/remote-budget-uat-18.sh`
- Modify: `tests/ops/budget-uat-18.test.ts`
- Modify: `docs/operations/private-uat-infrastructure.md`
- Modify: `artifacts/private-uat/2026-09-09-uat-infrastructure-receipt.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Write a failing preservation test**

  Model the exact before Serve JSON and prove the helper refuses Funnel/public handlers, removal or mutation of any existing TCP key, hostname drift, a non-loopback proxy target, or any HTTPS origin other than port `54521` on the measured tailnet hostname.

- [ ] **Step 2: Verify RED**

  Run the focused Vitest file. Expected: fail because no Serve merge validator exists.

- [ ] **Step 3: Implement the minimal additive route**

  Use `tailscale serve --bg --https=54521 http://127.0.0.1:54521` only after saving and validating the before JSON. Re-read status and require every pre-existing TCP forward to remain identical, Funnel to remain absent, and the new HTTPS handler to be tailnet-only. If any check fails, remove only the new handler or restore the saved configuration, mark HTTPS blocked, and leave the loopback UAT API otherwise healthy.

- [ ] **Step 4: Verify HTTPS or record the blocker**

  From the Mac, use bounded `curl` through the tailnet hostname for `/auth/v1/health` and `/rest/v1/`; verify the certificate and origin without bypass flags. Do not claim physical-device readiness from this browser/network emulation.

- [ ] **Step 5: Append the decision and refresh evidence**

  Append the measured default—four-service minimal stack, loopback `54521/54522`, restart `no`, additive private HTTPS if preserved—and what changes if the owner chooses a different UAT lifecycle. Update the runbook and sanitized receipt.

- [ ] **Step 6: Commit**

  Commit `feat(ops): expose budget uat through private https` when HTTPS passes, otherwise `docs(ops): record private https blocker`.

### Task 5: Full verification and independent review

**Files:**

- Modify only files required to address validated review findings.

- [ ] **Step 1: Run the complete local gate**

  Run frozen install, focused UAT tests, all ops tests, typecheck, UI tests, production build, offline E2E, migration hash verification, shell syntax, `git diff --check`, and the bounded tracked/artifact secret scan.

- [ ] **Step 2: Run a fresh remote verification**

  Re-run `scripts/ops/budget-uat-18.sh verify` and a read-only existing-stack snapshot. Compare exact before/after tuples and retain only sanitized results.

- [ ] **Step 3: Request independent review**

  Give the reviewer the user request, fixed release SHA, full branch diff, runbook, receipt, and verification output. Require findings by severity for isolation, secret handling, migration exactness, Auth/session lifecycle, RLS/tenant rejection, Tailscale preservation, cleanup safety, and evidence accuracy.

- [ ] **Step 4: Resolve every critical/important finding and rerun gates**

  Use systematic debugging and a red test for each verified defect. Commit each green fix conventionally.

- [ ] **Step 5: Leave the approved stack state explicit**

  Keep the stack running only if health/security/HTTPS checks pass and the runbook has exact stop/cleanup commands. Otherwise stop it without removing the volume, record the blocker, and do not claim formal UAT readiness.
