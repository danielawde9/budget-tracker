# Budget encrypted backup and scratch-restore runbook

## Status and authority boundary

This repository contains provider-neutral, fail-closed backup and scratch-restore
tooling. It is **implementation evidence only**. It does not prove that a live
database, age key, off-site destination, timer, encrypted recovery point, or
measured restore exists.

Do not enter real financial data until the evidence form below is complete and
Daniel has explicitly approved real-data entry. These scripts must not target
Sandooq/POS, the active Budget development database, or an unmarked directory.
They do not provision infrastructure, create markers, start services, reset
Supabase, apply migrations, delete recovery points, or perform a live restore.

## Commands and checks

```bash
pnpm check:ops
scripts/ops/backup-budget.sh dry-run
scripts/ops/backup-budget.sh backup
scripts/ops/backup-budget.sh retention-plan /absolute/path/to/retention.index
scripts/ops/restore-budget.sh dry-run
scripts/ops/restore-budget.sh restore
scripts/ops/migrate-budget.sh create-manifest MIGRATIONS OUTPUT SOURCE_SHA
scripts/ops/migrate-budget.sh verify-manifest MIGRATIONS EXPECTED APPLIED ACTUAL_SOURCE_SHA
```

`check:ops` runs deterministic ops tests, Bash syntax checks, and a bounded
tracked-text secret scan. Pass explicit absolute artifact/log files to
`scripts/ops/check-budget.sh` to include them in the same 256-file, 10 MiB-per-
file bound. Secret assignments exempt only an empty value, the exact matching
`${NAME:?required}` form, or the exact `<external-secret-reference>` token;
mixed values fail closed. If `shellcheck` is installed it runs that too;
absence is reported rather than hidden.

Every real command requires explicit, validated environment variables. Do not
put their values in Git, shell history, tickets, screenshots, logs, or this
runbook. Secret files must be outside Git, operator-owned, mode `0600`, and
injected by the service manager. Only the age public recipient belongs on the
backup host; the private identity belongs in separately custodied recovery
material.

## Exact target and marker contract

`BUDGET_ENV` accepts only `development`, `uat`, or `live`; backup requires
`live`.

| Environment | Project | Port range |
| --- | --- | --- |
| development | `budget-supabase` | `54420-54429` |
| uat | `budget-uat` | `54520-54529` |
| live | `budget-live` | `54620-54629` |

The validated root must be absolute and environment-specific, with a basename
equal to the project. `BUDGET_TRUSTED_PARENT` names its canonical, existing
operator-owned parent. The configured parent and root must already equal their
resolved paths; the parent, root, and every component between them must be real
directories owned by the operator with no group/other permission bits. Symlink
components are refused. The root cannot be `/`, a home root, the repository
root, `/home/lelabo`, contain `..`, a wildcard, or an unresolved variable. Its
marker must be exactly `<validated-root>/.budget-ops-marker`:

```text
budget-ops-marker-v1
environment=<exact environment>
project=<exact project>
system_id=<exact PostgreSQL system identifier>
```

Markers must be operator-owned regular files with mode `0600` and at most
4 KiB. They are opened with a no-follow descriptor and matched byte-for-byte.
The root and marker are checked again after each database identity verifier and
immediately before database effects, so an adapter-side path or marker swap
fails closed. Scratch applies the same rules through
`BUDGET_SCRATCH_TRUSTED_PARENT`.

The operator configures the expected system identifier and database OID. The
tracked read-only verifier measures the system identifier, PostgreSQL server
major, database name/OID, and relation count from the exact host, port,
database, and user used by the operation. The scripts compare that bounded
receipt with the expected identity after taking the operation lock and again
immediately before database effects. Caller-supplied declarations of the
actual identity or scratch emptiness are not accepted as evidence.
Any tokenized Sandooq/POS identifier in a root, marker, project, hostname,
volume, network, off-site destination, or retention prefix is refused.

Scratch restore has its own exact marker:

```text
budget-restore-marker-v1
target=scratch
project=budget-restore-scratch
system_id=<scratch PostgreSQL system identifier>
```

Scratch uses port `54722`, PostgreSQL major 17, an empty database, and a system
identifier different from live. These are validation inputs, not authorization
to create the scratch service. Emptiness is measured by the verifier as zero
non-system relations at both checks.

## Provider-neutral adapters

Configure only reviewed absolute executable paths. Each adapter is wall-time
bounded and must emit safe metadata only.

- `BUDGET_OFFSITE_BIN put LOCAL DESTINATION KEY` uploads one ciphertext or safe
  manifest.
- `BUDGET_OFFSITE_BIN verify LOCAL DESTINATION KEY` compares remote size and
  SHA-256 with the local file and fails on any mismatch.
- `BUDGET_OFFSITE_BIN get DESTINATION KEY LOCAL` fetches one named file; it must
  reject prefixes, wildcards, and implicit newest selection.
- `BUDGET_CATALOG_BIN --database=NAME --max-row-summaries=100` emits bounded row
  summaries/catalog hashes without rows, emails, tokens, or secrets.
- `BUDGET_ROLE_FILTER_BIN INPUT OUTPUT ALLOWLIST` emits only reviewed roles and
  rejects role passwords or a role outside the allowlist.
- `BUDGET_COMPARE_BIN ... --max-row-summaries=100 --max-content-hashes=100`
  compares migrations, schema/object and bounded row/content hashes, Auth count,
  RLS/policies, ACLs, owners/function bodies, triggers, constraints, indexes,
  and protected financial-command inventory.
- `BUDGET_DB_VERIFY_BIN` must be the tracked `verify-budget-db.sh` executable.
  It invokes the configured absolute `BUDGET_VERIFY_PSQL_BIN` with a five-second
  connection and statement bound, read-only transaction/session settings, no
  password prompt, and the immutable operation endpoint.

Until Daniel selects the off-site provider, location, immutability/versioning,
cost ceiling, and key custodian, adapter configuration and every external
receipt remain **BLOCKED**.

## Backup procedure

1. Record the approved release ID, current migration manifest, PostgreSQL 17
   client major, exact marker/system ID/database OID, and declared free-space
   evidence.
2. Supply a mode-`0600` pgpass file by reference. Its value is never printed or
   passed on the command line.
3. Run `dry-run`; it validates configuration but takes no lock, creates no file,
   and invokes no database, encryption, or network binary.
4. In an approved window, run `backup`. It takes a nonblocking live lock,
   measures and pins the database receipt, uses a five-second connection
   timeout, 30-second lock wait, and 30-minute wall bound, then measures the
   same immutable endpoint again immediately before `pg_dump`.
5. It creates a full custom-format dump, a roles-only/no-role-passwords dump,
   and bounded catalog metadata.
6. The three plaintexts live under one mode-`0700` directory and are age
   encrypted. A trap removes each exact plaintext on success, failure, signal,
   or timeout.
7. The safe manifest records source system ID, versions, release, migration
   manifest hash, and ciphertext hashes; it contains no row or secret value.
8. Each ciphertext and manifest is uploaded and verified. Local `SUCCESS` is
   created only afterward, but is not proof of provider durability; retain the
   provider's redacted immutable receipt.

### Retention

`retention-plan` accepts at most 1,000 exact rows:

```text
budget-live-ID|2026-09-09T02:15:00Z|daily|normal|verified
budget-live-ID|2026-09-07T02:15:00Z|weekly|pinned|verified
budget-live-ID|2026-09-01T02:15:00Z|monthly|normal|verified
```

Rows in each tier are newest-first. The plan keeps 14 daily, eight weekly, and
12 monthly recovery points, plus the globally newest, incident-pinned, and
unverified points. Weekly eligibility is derived from a valid UTC Sunday and
monthly eligibility from the first UTC calendar day; comparisons use parsed UTC
instants rather than caller-supplied lexical ordering. Duplicate or conflicting
recovery IDs fail before any plan is emitted. It proposes deletion only for
exact `budget-live-` IDs.
Review the plan before a separately approved adapter deletes anything; this
repository intentionally includes no deletion command.

## Scratch restore procedure

1. Select one exact recovery-point ID; never use an implicit newest prefix.
2. Independently provision an isolated, empty PostgreSQL 17 scratch target with
   the exact marker/port contract and record denial/free-space evidence.
3. Supply the off-site destination, mode-`0600` age identity and pgpass paths,
   trusted manifest SHA-256 from the independent backup receipt, reviewed role
   allowlist, and absolute adapters.
4. Run `dry-run`. The default is `scratch`; it creates nothing and invokes no
   adapter.
5. Run `restore`. It locks scratch, measures the scratch database identity and
   emptiness, and fetches only the named manifest and three ciphertexts. The
   trusted manifest receipt, source identity, system ID, major version, and all
   ciphertext hashes are verified before age or PostgreSQL runs. The same
   immutable scratch endpoint must produce the same empty receipt again before
   `psql` or `pg_restore`.
6. Decryption stays in private scratch temp. The archive is listed; roles are
   filtered. `psql` uses `ON_ERROR_STOP`; `pg_restore` uses one job and
   `--exit-on-error` within 60 minutes.
7. The bounded comparison adapter must pass. Process exit without catalog/data
   comparison is not a verified restore.
8. The trap removes exact temp files. Export redacted timings/comparison, then
   use a separately approved cleanup that revalidates markers and identities.
   This repository deletes no database, volume, service, or directory.

The script deliberately refuses every live restore, even when incident fields
are present. A live extension needs a separate review with incident ID, typed
target, stopped-app proof, fresh pre-restore backup, owner approval, and an
accepted reconciliation/loss decision. Never run `supabase db reset` live.

## Migration integrity

[`ops/budget-migrations.sha256`](../../ops/budget-migrations.sha256) describes
the 14 migrations at approved source head `4150456`. Regenerate only for a
separately approved release. Do not overwrite a manifest or edit an applied
migration.

Before release, export applied versions to an operator-owned file, one 14-digit
version per line, with a reviewed read-only query. `verify-manifest` rejects a
wrong source SHA, duplicate versions, changed/missing applied files,
unmanifested local files, and unknown/duplicate applied rows. It never applies,
replays, rolls back, or auto-retries a migration.

## Key loss and disaster recovery

- Lost public recipient: stop scheduling, recover the approved recipient, then
  complete a new backup and scratch restore.
- Lost private identity with another verified copy: declare key risk, test that
  copy in scratch, rotate, and retain old points through policy expiry.
- Lost last private identity: ciphertext is unrecoverable. Preserve evidence,
  declare the recovery objective missed, and escalate; do not weaken encryption.
- Suspected corruption: fail closed, preserve bounded safe logs, restore to
  scratch first, reconcile, and request explicit live-recovery approval.

## Evidence required before real data

| Evidence | Required result | Current state |
| --- | --- | --- |
| Live identity | Approved marker, project, ports, system ID, operator | **BLOCKED — no live provisioning authorized** |
| Off-site | Approved provider/location, immutability, cost, verified adapter | **BLOCKED — owner decision required** |
| Key custody | Real recipient, recovery record, tested private identity | **BLOCKED — no real key authorized** |
| Backup | Named local/off-site ciphertexts, matching hashes/sizes, receipt | **BLOCKED — no actual backup performed** |
| Restore | Named fetch, decrypt, restore, full comparison, cleanup | **BLOCKED — fixtures are not a measured restore** |
| RPO/RTO | Backup age at most 24h; verified restore below four hours | **BLOCKED — measured drill required** |
| Migration | Release SHA, manifest/applied rows, empty/upgrade DB proof | **PARTIAL — offline integrity only** |
| Isolation | Before/after Budget and Sandooq/POS identities unchanged | **BLOCKED — host audit not authorized** |
| Approval | Named operator and Daniel's real-data authorization | **BLOCKED** |

Fixture tests and dry-runs are repository proof only, never a substitute for an
actual encrypted off-site backup, measured scratch restore, or launch approval.
