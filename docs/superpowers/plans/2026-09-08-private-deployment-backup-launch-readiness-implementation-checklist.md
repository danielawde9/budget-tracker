# Private Deployment, Backup, Restore, and Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a private, recoverable Budget release that can be used from
Daniel's approved devices without exposing Budget or Sandooq services, and
produce the evidence required before any real financial data is entered.

**Architecture:** Keep the Git source, release worktree, and Vite development
server on Daniel's Mac. Build an immutable static artifact on the Mac, copy only
that artifact and its manifest to Le Labo Ubuntu, and serve it with HTTPS only
inside the tailnet. Keep development, UAT, and live in separate Supabase
projects, directories, ports, credentials, volumes, auth users, and backup
destinations; no environment may share Sandooq/POS state.

**Tech Stack:** React/Vite static build, self-hosted Supabase/PostgreSQL 17,
Tailscale Serve and ACLs, systemd, age-encrypted PostgreSQL custom-format dumps,
SHA-256 manifests, Vitest, Playwright, and bounded POSIX shell scripts.

---

## Status on 2026-09-08

This document is a plan, not deployment evidence. Nothing in this checklist is
authorization to provision, reset, migrate, publish, send email, expose a port,
change DNS, push, merge, or enter real financial data.

The checked statements below are repository observations only:

- [x] `main` is `14bbf7c`. It contains the authenticated EN/AR application shell,
  Loans, Wallets, 14 forward-only migrations through `20260907149000`, the
  protected financial-command inventory, and the dedicated Budget development
  stack contract.
- [x] The current Ubuntu development evidence covers only
  `/home/lelabo/budget-supabase`, project `budget-supabase`, ports
  `54420`-`54429`, PostgreSQL 17, tailnet-only ingress, restart policy `no`, and
  synthetic tests. It is not UAT or live proof.
- [x] `codex/categories-application-ui` at `aa6da26` contains
  `codex/categories-foundation` at `46c0385`; do not merge both independently.
  That application branch adds four category migrations through
  `20260908103000` and a verified Categories workspace, but it is not integrated
  into `main`.
- [x] `codex/household-membership-foundation` at `bd53f2e` is independently based
  on `14bbf7c`. It adds the database membership/invitation lifecycle through
  `20260908180000`; its gateway, UI, SMTP delivery, DNS, and external sending are
  explicitly unimplemented.
- [x] Monthly Budgeting and Reporting are designs only. The current `main` README
  still says budgeting, reporting, live UAT, deployment, and launch are outside
  the implemented milestone.
- [x] Current Auth supports sign-in, sign-up, confirmation-required display, and
  sign-out. It does not implement password-reset request/completion, controlled
  live enrollment, security-alert email, or a production SMTP delivery proof.
- [x] Current `supabase/config.toml` is a development contract: confirmations are
  off, secure password changes are off, minimum password length is six, local
  Mailpit is enabled, and HTTP/tailnet development URLs are embedded. It must
  not be reused as the live config.

## Recommended target and alternatives

### Recommended: self-hosted, tailnet-only personal deployment

Use one always-on live Supabase stack and one static release origin on Le Labo
Ubuntu. Tailscale Serve terminates HTTPS and applies tailnet ACLs; Tailscale
Funnel remains disabled. Daniel's Mac remains the only source/build authority,
and Ubuntu receives only a versioned `dist` artifact, manifest, environment
configuration, and selected migration journal. The current development stack
stays opt-in and unchanged. UAT is a separate on-demand stack that uses
synthetic data and is stopped after each release rehearsal.

This is preferred because Tailscale Serve is private to the tailnet, supports
HTTPS, and applies tailnet access controls. Current Tailscale terms describe the
non-commercial Personal plan as free for up to six users with unlimited user
devices, but the owner must verify eligibility and limits again before work:

- <https://tailscale.com/docs/features/tailscale-serve>
- <https://tailscale.com/pricing>

Costs are the existing hardware/electricity, transactional email, and an
off-site encrypted backup target. Daniel owns uptime, patching, backups, restore
drills, and hardware recovery.

### Alternative A: managed Supabase and hosted static assets

Use separate hosted Supabase projects and a static provider such as Cloudflare
Pages/Workers behind Cloudflare Access. This improves availability but adds
public cloud control planes, vendor credentials, data-location decisions, and
recurring cost. Supabase's current Free plan has no automatic backups and may
pause after inactivity, so it is not acceptable as the sole live recovery
mechanism. Current Pro terms include daily backups with seven-day retention;
PITR is a separate paid add-on. Verify terms at implementation time:

- <https://supabase.com/pricing>
- <https://supabase.com/features/database-backups>
- <https://developers.cloudflare.com/pages/>
- <https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/private-web-app/>

Choose this only if Daniel prefers managed uptime and accepts the current
provider costs/data locations. Cloudflare Access is an outer access gate, not a
replacement for Supabase Auth, RLS, or protected commands.

### Alternative B: Mac-only private pilot

Serve the artifact and proxy the development backend through Tailscale on the
Mac. This is acceptable for short synthetic-data UAT, but not recommended live:
sleep, travel, updates, or disk failure can remove both application access and
the release workstation. Real data still requires the same off-host
backup/restore gate and explicit acceptance of the availability risk.

## Environment contract

No implementation may provision UAT or live until an operator records a port,
capacity, directory, Docker-project, tailnet-name, and firewall collision audit.
The values below are proposed inputs to that audit, not reservations.

| Property | Development (existing) | UAT (proposed) | Live (proposed) |
| --- | --- | --- | --- |
| Purpose | Resettable engineering/tests | Release rehearsal | Real financial data |
| Mac runtime | Vite dev server | Release build only | Release build only |
| Ubuntu project | `budget-supabase` | `budget-uat` | `budget-live` |
| Ubuntu directory | `/home/lelabo/budget-supabase` | `/home/lelabo/budget-uat` | `/home/lelabo/budget-live` |
| Candidate ports | `54420`-`54429` | `54520`-`54529` | `54620`-`54629` |
| Lifecycle | Explicit start, restart `no` | Explicit start, restart `no` | Enabled after launch approval |
| Data | Synthetic/resettable | Synthetic per release | Never reset; forward-only |
| Auth | Development users | Dedicated test users | Approved users only |
| Email | Mailpit | Sandbox/allowlisted inboxes | Verified transactional SMTP |
| Access | Tailnet HTTP today | Tailnet HTTPS | Tailnet HTTPS |
| Secrets | Development set | Independent UAT set | Independent live set |
| Backup | Optional snapshots | Rehearsal checkpoints | Encrypted 3-2-1 copies |

Implementation must fail closed if any candidate port, directory marker, Docker
project ID, volume, network, auth key, database system identifier, tailnet
hostname, or backup prefix overlaps another environment or Sandooq/POS. A
different URL with the same database is not separation.

## Recovery and availability objectives

Planning defaults:

- RPO: at most 24 hours of accepted live changes.
- RTO: verified read/write service within four hours after incident declaration.
- Schedule/retention: daily at 02:15 UTC; keep 14 daily, eight weekly, and 12
  monthly encrypted recovery points.
- Copies: live database, encrypted Ubuntu-local backup, and at least one verified
  encrypted off-site copy. A same-building Mac is off-machine, not off-site.
- Drill: before first real data, after backup format/key changes, and quarterly.
  Restore an off-site ciphertext to isolated scratch and measure the RTO.

If Daniel chooses a tighter RPO, add and prove WAL archiving/PITR or select a
managed PITR service; do not merely run `pg_dump` more often.

## Bounds shared by every operational script

Every script uses `set -euo pipefail`, `umask 077`, immutable configuration after
validation, a nonblocking single-run lock, exact environment allowlists, and
traps that remove plaintext temporary files. Empty/unknown environment names
are rejected rather than defaulting to live.

- SSH: `ConnectTimeout=10`, `ConnectionAttempts=2`,
  `ServerAliveInterval=15`, `ServerAliveCountMax=2`, batch mode.
- HTTP: five-second connect, 15-second request, at most two retries for
  idempotent probes, two-second delay, 45-second total retry budget.
- Stack health: five-second polls, at most 60 attempts (five minutes).
- Migration: one process, advisory lock, 10-minute wall timeout, no automatic
  replay after ambiguity.
- Backup: one process, 30-minute wall timeout, five-second database connect,
  30-second table-lock wait.
- Restore: one process, 60-minute wall timeout; at most four parallel jobs after
  the single-job path passes.
- Email: 10-second request timeout, at most three attempts for retryable
  `429`/`5xx`/network failures, same idempotency key; no other `4xx` retry.
- Cleanup: one validated environment root and exact IDs only. Never target an
  unresolved variable, `$HOME`, `~`, `/home/lelabo`, repo root, or wildcard.

## Planned file map

- Create `docs/operations/private-environments.md`: inventory, ownership,
  endpoints, system IDs, service names, safe health commands, escalation, and
  secret names without values.
- Create `docs/operations/backup-restore-runbook.md`: backup, retention, restore,
  disaster recovery, key-loss path, and evidence form.
- Create `docs/operations/release-runbook.md`: artifact, migration, smoke,
  rollback/roll-forward, launch, and incident procedures.
- Create `.env.uat.example` and `.env.live.example`: public browser variable names
  and secret references only.
- Create environment-specific Supabase configs from a typed, allowlisted
  manifest; never mutate `supabase/config.toml` in place to switch environments.
- Create UAT/live firewall units that preserve existing Sandooq and development
  rules, plus live app/backup systemd service/timer units.
- Create `scripts/ops/budget-common.sh`, `build-release.sh`,
  `promote-release.sh`, `migrate-budget.sh`, `backup-budget.sh`,
  `restore-budget.sh`, and `check-budget.sh` with the boundaries above.
- Create `tests/ops/*.test.ts`: target, timeout, marker, retention, redaction,
  no-Sandooq, and no-live-reset positive/negative controls.
- Modify `package.json` to expose `check:ops`, `check:release`, and `check:launch`;
  keep existing checks intact.
- Modify `README.md` only to link runbooks and state evidence boundaries.
- Append `docs/decisions.md` only when Daniel changes a default or approves a
  provider/topology choice.

## Task 1: Resolve owner gates

- [ ] Select self-hosted tailnet-only or managed hosting. If managed, record
  provider, region, cost ceiling, data-location acceptance, and account owner.
- [ ] Record approved users/devices and whether every device can join Tailscale.
- [ ] Define launch scope: Wallets + Loans + Categories, or also Household UI and
  email, Monthly Budgeting, and Reports. Database/design-only features remain
  unavailable.
- [ ] Approve RPO/RTO, retention, off-site destination, backup key custodian, and
  recovery contact.
- [ ] Select transactional provider/domain, monitored reply/support inbox, and
  provider spending cap. Marketing email is excluded.
- [ ] Select closed enrollment (recommended) or specify CAPTCHA, rate limits,
  abuse alerts, and deletion policy for open signup.
- [ ] Decide whether live auto-starts after Ubuntu reboot. Recommended: live only
  after firewall/backup/monitoring preconditions; dev/UAT stay opt-in.
- [ ] Append changed defaults to `docs/decisions.md`; commit
  `docs: record private launch owner decisions`.

## Task 2: Integrate one release candidate

- [ ] Create a new isolated integration worktree from current `main`; record SHA.
- [ ] Merge `codex/categories-application-ui` once. Prove its Categories
  foundation ancestor and migrations `20260908100000`-`20260908103000` occur
  exactly once.
- [ ] Merge `codex/household-membership-foundation` only if approved. Preserve
  both sides of overlapping README, decisions, test-helper, and operations docs.
- [ ] Keep Household database-only until separate gateway/UI/delivery evidence
  exists; SQL availability must not expose UI claims.
- [ ] Run frozen install, typecheck, DB/UI tests, build, and E2E on the combined
  branch. Report current exact counts/skips; historic branch counts are not
  integration proof.
- [ ] Prove the combined migration journal from empty and as a seeded upgrade
  from 14 migrations, including data, ownership, grants, RLS, triggers,
  constraints, function bodies, and migration history.
- [ ] Prove no version collision, unclassified financial writer, browser direct
  write, or credential/token/email sink.
- [ ] Commit each green resolution; do not push/merge without a later request.

## Task 3: Enforce environment isolation

- [ ] Write failing `tests/ops/environment-contract.test.ts` controls for three
  exact environments, unique IDs/directories/ports/hostnames/volumes/networks,
  marker files, and empty/unknown refusal.
- [ ] Prove helpers reject Sandooq/POS identifiers before file, SSH, Docker, or
  Supabase operations; keep benign Budget-name negative controls.
- [ ] Implement the manifest/common validator. Load secrets only after validating
  the target and operation.
- [ ] Read-only audit Ubuntu CPU/RAM/disk, ports, containers, volumes, networks,
  units, Tailscale routes, and firewall. Redact values.
- [ ] Record approved port blocks/markers. If proposed blocks conflict, choose a
  measured alternative and append its reason to decisions.
- [ ] Compare Sandooq/POS health and inventory before/after a disposable UAT
  start/stop. Any unexplained change fails the gate.
- [ ] Commit `feat(ops): enforce budget environment isolation`.

## Task 4: Inject and rotate secrets

- [ ] Inventory variable names, owners, consumers, rotation, and exposure class
  without values. `VITE_SUPABASE_URL` and anon key are browser-visible config.
- [ ] Prove no service-role key, DB password, JWT secret, SMTP credential, backup
  token, age private identity, or admin token has a `VITE_` prefix or enters
  `dist`, source maps, logs, screenshots, tests, manifests, shell tracing, or Git.
- [ ] Store server secrets in root-owned mode-`0600` files outside Git, referenced
  by systemd `EnvironmentFile=`. Keep Mac release config ignored/mode `0600`.
- [ ] Keep only the age public recipient live; custody the private identity
  off-host with Daniel's recovery material and test access.
- [ ] Add a redacting ratchet for tracked files, artifacts, logs, and manifests.
  It must never print a discovered value.
- [ ] Drill rotation for browser/JWT, DB, SMTP, off-host, and age keys, including
  new-key acceptance and old-key rejection.
- [ ] Commit `feat(ops): add budget secret injection contracts`.

## Task 5: Build and serve an immutable release

- [ ] Test release refusal for dirty tracked tree, unapproved source SHA, wrong
  Node/pnpm, missing public env, secret-shaped `VITE_`, failed test, and
  nondeterministic manifest.
- [ ] Build after the frozen release gate; hash artifacts and record source SHA,
  lockfile/migration hashes, tool versions, UTC time, and test receipts. Never
  copy env files; omit source maps unless separately approved.
- [ ] Package `dist` under a content-addressed release ID. Copy it to an inactive
  Ubuntu directory; never build from Git or copy source to Ubuntu.
- [ ] Verify inactive `/`, hashed assets, SPA fallback, headers, cache, build ID,
  and no source maps/secrets on loopback.
- [ ] Configure separate UAT/live Tailscale Serve HTTPS routes and default-deny
  ACLs; disable Funnel and LAN/public ingress.
- [ ] Set exact Auth `site_url`, external API URL, redirect allowlist, and CORS
  origins. Reject live wildcards.
- [ ] Promote via atomic `current` switch after health. Retain only the previous
  two app artifacts; prune by exact release ID.
- [ ] Verify approved desktop/mobile devices and denial outside the tailnet.
- [ ] Commit `feat(ops): add private immutable release delivery`.

## Task 6: Make Auth and email recoverable

- [ ] Verify support against pinned/current Supabase, then set live verified
  email, password length at least 12, secure password change, refresh rotation,
  closed enrollment, and bounded auth limits.
- [ ] Add password-reset request/completion to typed Auth and EN/AR UI. Supabase
  owns tokens; no reusable credential/provider response enters app state/logs.
- [ ] Test enumeration-safe response, expired/used/wrong link, session
  replacement, prior-user clearing, RTL/mobile/focus, and successful recovery.
- [ ] Configure a transactional subdomain with SPF, DKIM, and DMARC monitoring;
  tighten DMARC only after legitimate alignment is observed.
- [ ] Build EN/AR accessible HTML/plaintext verification, reset,
  password-changed, and approved invitation templates: correct `lang`/`dir`,
  clear actions, contrast, dark mode, and mobile targets.
- [ ] Keep bodies data-minimal: no balances, transactions, categories, member
  lists, internal IDs, secrets, or raw provider responses.
- [ ] Keep Household DB invitation creation separate from sending. Delivery uses
  one idempotency key, bounded retries/status, and terminal-failure alert;
  provider success is not acceptance.
- [ ] Prove delivery, spam observation, link expiry/HTTPS, reply, bounce, and
  redacted logs in approved real clients. Mailpit is development proof only.
- [ ] Disable public live signup after approved accounts are confirmed, or ship
  the explicitly approved open-signup controls.
- [ ] Commit `feat(auth): add production account recovery`; keep Household
  delivery a separate milestone.

## Task 7: Provision only after approval

- [ ] Capture Sandooq/POS and Budget-dev before-state: names/IDs, image digests,
  health, restart policies, networks, volumes, ports, units, firewall, disk,
  memory, and markers.
- [ ] Recheck capacity. Stop if free disk is below the greater of 20 GiB or three
  times the largest measured DB+backup footprint, or Sandooq headroom shrinks.
- [ ] Create only approved UAT resources and fail-closed firewall; prove
  LAN/public denial.
- [ ] Apply the release journal, seed synthetic bilingual data, create dedicated
  test users, and allow email only to approved inboxes.
- [ ] Compare Sandooq/POS after-state; unexplained changes block live work.
- [ ] After UAT/owner approval, create exact live resources. Never clone dev Auth,
  volume, JWT secret, or synthetic data into live.
- [ ] Enable live persistence only when firewall, secrets, health, backup timer,
  alerts, and restore prerequisites are active. Dev/UAT restart stays `no`.
- [ ] Record safe version/system-ID/migration/image/release/certificate/backup
  evidence without secrets.
- [ ] Commit `docs: record private environment provisioning evidence`.

## Task 8: Implement encrypted backups and retention

- [ ] Test refusal for wrong DB system ID, target, marker, concurrent run,
  insufficient space, missing recipient/destination, and unsafe path.
- [ ] Use an approved PostgreSQL client major version. Create a full custom dump
  preserving all schemas/Auth data and ownership/ACL intent; capture a separate
  global/role manifest without role passwords. Table-only dumps are insufficient.
- [ ] Manifest source system ID, versions, release, migration versions/hashes,
  tool version, UTC duration, size, bounded row summaries, and catalog hashes.
- [ ] Encrypt dump/role/metadata before leaving a private temp directory. Hash
  ciphertext, decrypt/list it privately, and always remove plaintext temp files.
- [ ] Upload ciphertext/manifest to one separately failed off-site destination
  with versioning/immutability where affordable; verify remote size/hash.
- [ ] Mark success only after dump, encryption, local check, off-site check,
  manifest finalization, and monitoring receipt.
- [ ] Prune only exact verified live prefixes: 14 daily, eight Sunday weekly, 12
  first-of-month monthly; never newest or incident-pinned backups.
- [ ] Alert after 26 hours without verified off-site recovery, timer failure, low
  space, key risk, or retention failure. Include safe metadata only.
- [ ] Run twice on synthetic candidate data and prove serialization, bounds,
  ciphertext-only off-host storage, hashes, retention, and alert recovery.
- [ ] Commit `feat(ops): add encrypted budget backups`.

## Task 9: Prove restore before reliance

- [ ] Default restore target to `scratch`. Live requires incident ID, typed exact
  target, stopped app, fresh pre-restore backup when readable, and explicit owner
  approval. Never `supabase db reset` live.
- [ ] Provision isolated scratch on the same Postgres major; validate marker,
  unique system ID/ports, empty target, access denial, and free space.
- [ ] Fetch one named off-site ciphertext, verify hash, decrypt privately, inspect
  archive, and restore allowlisted roles/ownership with exit-on-error.
- [ ] Compare migrations/hashes; schema/object and row counts; bounded content
  hashes; Auth user count; RLS; policies; ACLs; function owners/bodies; triggers;
  constraints; indexes; and financial-command inventory.
- [ ] Authenticate a drill account, perform one reversible synthetic protected
  flow, verify wallet/loan/category projections, reverse it, and verify history.
- [ ] Measure detection-to-start, fetch, decrypt, provision, restore, verify, and
  total time. Require RPO <=24 hours and verified RTO <4 hours.
- [ ] Export evidence, delete only exact scratch resources, and prove dev/UAT/live
  and Sandooq/POS identities unchanged.
- [ ] Schedule next quarterly drill and overdue alert.
- [ ] Commit `docs: record measured budget restore drill`.

## Task 10: Gate forward-only releases and recovery

- [ ] Build a manifest of migration version/name/SHA-256. Reject duplicates,
  changed applied files, missing files, unknown remote rows, or wrong source SHA.
- [ ] Prove full empty journal and upgrade from latest verified backup in UAT;
  run complete DB tests against the result.
- [ ] Require migrations compatible with old and new app artifacts. Use
  expand/migrate/contract; contract only after old artifacts/sessions retire.
- [ ] Require verified off-site pre-migration backup, restore status, DB identity,
  Sandooq before-state, disk, no concurrent backup, and exact manifests.
- [ ] Acquire one advisory lock and apply once within 10 minutes. On ambiguity,
  inspect journal/catalog; never auto-replay.
- [ ] Run catalog/RLS/ACL/writer/data/Auth/REST and old-artifact compatibility
  checks before app promotion.
- [ ] Promote, then run read-only smoke and one approved synthetic
  command/reversal. Never use real amounts as probes.
- [ ] If only the artifact fails, switch back. If an uncommitted migration fails,
  prove rollback before retry. If committed state is wrong, forward-fix; restore
  only for declared corruption/data loss because it discards later changes.
- [ ] Never edit/delete an applied migration. Record incident, impact, recovery
  point, accepted loss, and reconciliation.
- [ ] Commit `feat(ops): gate forward-only budget releases`.

## Task 11: Monitor and alert

- [ ] Probe app, TLS expiry, Auth, REST, Postgres readiness/system ID, migration
  head, container health/restarts, disk/inodes, backup/off-site age, and drill due.
- [ ] Run every five minutes with bounds. Require two reachability failures, but
  alert immediately on identity mismatch, public ingress, backup failure, or disk
  risk.
- [ ] Send one recovery notice; deduplicate repeated alerts for 30 minutes and
  retain a bounded local incident log.
- [ ] Use an approved channel with no finance, emails, tokens, secret URLs, SQL,
  or provider bodies. Daily checks must expose alert-channel failure.
- [ ] Rotate logs at 10 MiB, five files, maximum 30 days. Redact Auth/Cookie,
  queries, emails, tokens, rows, and env values.
- [ ] Test via UAT-only app stop, fixture certificate/backup/disk/system-ID
  failures. Never disrupt live or Sandooq/POS for monitoring tests.
- [ ] Commit `feat(ops): monitor private budget service`.

## Task 12: Complete real-device UAT

- [ ] Test the exact release artifact/private HTTPS/UAT backend, not Vite fixtures,
  with clean sessions on approved desktop/mobile browsers.
- [ ] Cover every screen/control in EN LTR and AR RTL: auth, recovery, onboarding,
  spaces, Wallets, Loans, integrated Categories, account actions, loading, empty,
  validation, rejection, ambiguity, reconciliation, retry, offline, expiry, and
  access loss.
- [ ] Verify `<bdi>`, logical layout, focus/keyboard/screen-reader/live regions,
  200% zoom, reduced motion, contrast, dark/light behavior, touch targets, safe
  area/keyboard, and no lost horizontal controls.
- [ ] Cover opening, income, expense, transfer, loan directions, repayment,
  target, correction, and categorized income/expense. Confirm server-derived
  balances, currency separation, duplicate blocking, and immutable history.
- [ ] Cover confirmation, reset, password change, enrollment policy, sign-out,
  session expiry, and prior-user clearing with real email delivery.
- [ ] If Household UI launches, cover invite/delivery/accept/cancel, wrong account,
  expiry/replay, roles, last owner, leave/remove, and space-data clearing;
  otherwise prove it is not claimed available.
- [ ] Test tailnet loss/recovery, app/Supabase restart, stale cache, old app/new
  schema compatibility, backup overlap, and monitoring.
- [ ] Record Pass/Fail/Blocked with release/environment/device/browser/locale/UTC
  and redacted evidence. Fixtures/screenshots are not live UAT.
- [ ] Require no severity-1/2 or privacy/security blockers and owner acceptance of
  lower-severity issues.
- [ ] Commit `test(uat): record private release acceptance evidence`.

## Task 13: Launch and operate

- [ ] Freeze release SHA/artifact/migrations/UAT/decisions/window/recovery point
  and operator; confirm no unrelated staged work.
- [ ] Confirm isolation, firewall/ACL/HTTPS/Funnel denial, secrets, Auth/CORS,
  SMTP/DNS, enrollment, monitoring, alerts, backup/off-site, capacity, and drill.
- [ ] Confirm latest off-site backup restored through the same format/key path
  within RPO/RTO and Sandooq/POS is healthy/outside every target.
- [ ] Run migration gate, promote artifact, health/catalog checks, and synthetic
  command/reversal.
- [ ] Test each approved account/device in EN/AR and live password recovery to the
  exact allowlisted HTTPS URL.
- [ ] Observe for 60 minutes: health, Auth/REST errors, restarts, disk,
  backup/alerts, browser errors, and public denial; collect no financial payload.
- [ ] Daniel explicitly approves real-data entry only after reviewing the evidence
  packet. Until then retain only accounts and reversible synthetic smoke data.
- [ ] Record release/migration/backup IDs, observation/approver/UTC launch, next
  patch, and next restore drill.
- [ ] Daily (<10 minutes): health, identity, certificate, disk/inodes, backup age,
  failed units, and alert channel.
- [ ] Weekly: update availability, backup trend, auth/rate/DMARC/bounce trends,
  redaction, and retention. Apply updates only through UAT.
- [ ] Monthly: patch through UAT, rotate due credentials, verify recovery keys,
  review Tailscale membership/ACLs, and capacity.
- [ ] Quarterly: off-site scratch restore, synthetic flow, RPO/RTO measurement,
  exact scratch cleanup, and evidence.
- [ ] Incident: fail closed, preserve bounded safe logs, rotate affected secrets,
  verify catalog/data, and restore only for proven corruption. Never reuse
  Sandooq/POS ports/volumes as an emergency shortcut.

## Evidence required before real financial data

The launch packet must contain, with secrets/PII redacted:

1. Owner-approved topology, feature scope, access list, provider, RPO/RTO,
   retention, off-site target, cost ceiling, and recovery owner.
2. Release SHA, lockfile/artifact/migration hashes, tool versions,
   dependency/license report, and clean scope audit.
3. Fresh combined frozen install, typecheck, DB/UI/E2E/build, ops ratchets, and
   launch checks with exact counts/skips.
4. Empty/seeded-upgrade migration proof and catalog fingerprints for roles,
   owners, grants, RLS, policies, triggers, constraints, indexes, functions, and
   financial writer inventory.
5. Environment/capacity audit and before/after proof Sandooq/POS containers,
   volumes, networks, ports, restart policies, and health did not change.
6. Tailnet ACL/HTTPS/Funnel-disabled/LAN-public-denial evidence, Auth redirects,
   CORS, certificate expiry, and approved-device access.
7. Secret ratchet and rotation drill proving no server secret in Git, artifacts,
   logs, screenshots, manifests, or browser config.
8. Real confirmation/password-recovery email evidence: SPF/DKIM/DMARC, expiry,
   EN/AR/mobile/accessibility, bounce/reply, and redacted logs. Include Household
   delivery only if launched.
9. Verified encrypted local/off-site backup receipt plus measured scratch restore
   from off-site ciphertext, full data/catalog comparison, synthetic flow,
   RPO/RTO, and cleanup proof.
10. Desktop/mobile EN/AR Pass/Fail/Blocked matrix from exact private HTTPS,
    covering every reachable normal/empty/error/ambiguous/offline/recovery/access
    state.
11. Monitoring failure/recovery and no-stale-backup evidence, alert proof,
    bounded/redacted logs, and next patch/drill dates.
12. Daniel's recorded launch approval and explicit authorization for real data.
    A build, container, or test-host screenshot is not approval.

## Self-review

- [x] Coverage: architecture/options, environments, Auth/email, secrets, HTTPS,
  backups, restore, migrations, rollback, monitoring, UAT, launch, operations,
  and real-data evidence map to explicit tasks.
- [x] Boundaries: Mac source/dev, Le Labo Ubuntu isolation, and no Sandooq/POS
  mutation are explicit; network/backup/restore/retention operations are bounded.
- [x] Proof: repo/branch observations are separate from integration,
  provisioning, deployment, email, UAT, live, and launch proof.
- [x] Placeholder scan: no unresolved placeholder marker or unspecified test step.
- [x] Scope: planning docs only; no infrastructure, DB, provider, email, DNS,
  deployment, merge, or push operation is authorized or performed.
