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
`scripts/ops/check-budget.sh` to include them in the same bounded scan:

- at most 4,096 files; `check-budget.sh` refuses a larger tracked-plus-explicit
  set with exit `69` before scanning;
- at most 10 MiB per file, enforced on the bytes actually read;
- at most 64 MiB in total, summed from `lstat` sizes before any content is
  read;
- a 180-second monotonic deadline, checked before each file is opened, so one
  file already being scanned (at most 10 MiB) can finish first.

Inside the scan, a bound failure exits `64` and detected secret material exits
`69`. A passing scan prints `secret scan passed for N file(s), B byte(s)`. Compare
those numbers with the bounds as the tree grows, and follow the 2026-09-11
secret-scan entry in [`docs/decisions.md`](../decisions.md) before changing a
bound. Each candidate is read once through a no-follow file descriptor, under a
five-second alarm that the scan deadline can shorten, after matching its
regular-file identity and size. Secret assignments exempt only an empty value,
the exact matching `${NAME:?required}` form, or the exact
`<external-secret-reference>` token; mixed values fail closed. If `shellcheck` is
installed it runs that too; absence is reported rather than hidden.

Every real command requires explicit, validated environment variables. Do not
put their values in Git, shell history, tickets, screenshots, logs, or this
runbook. Secret files must be outside Git, operator-owned, mode `0600`, and
injected by the service manager. Only the age public recipient belongs on the
backup host; the private identity belongs in separately custodied recovery
material. Ops entrypoints replace ambient `PATH` before their first utility
lookup with the fixed system/toolchain allowlist documented in source; adapters
still require reviewed absolute executable paths.

Backup and restore dry-runs create only ephemeral, operator-private validation
snapshots under the system temporary directory. Those snapshots pin the reviewed
executables and private inputs while configuration and version checks run, are
removed before the dry-run exits, and are never written beneath the operation
root. A dry-run still performs no database, encryption, or network operation.

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

Operational descendants (`locks`, `tmp`, `backups/live`, and their exact run
directories) are created component by component with no-follow metadata checks.
Every component must remain an operator-owned private directory; the active
run directory is revalidated immediately around writes and before cleanup.
Existing or swapped descendant symlinks are never followed.
Cleanup starts a fresh five-second monotonic deadline, independent of an expired
operation deadline, and shares it across run-directory and executable-snapshot
cleanup. The cleanup helper opens each directory without following links,
enumerates at most 32 flat safe-name entries, unlinks entries relative to the
opened directory descriptor, verifies the target identity again, and removes
the directory relative to its opened parent. Nested directories fail closed.
The host therefore requires `/usr/bin/python3` with `dir_fd` unlink/rmdir support.

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

Every configured adapter path must resolve to a canonical, regular, executable,
non-group/world-writable file and have an exact configured SHA-256; placeholder
`true`/`false` commands are refused. At operation start, each opened file is
copied and hashed into one private snapshot directory, which is sealed read-only
before any adapter runs. All later execution uses those validated copies, so a
source-path replacement cannot change operation content. PostgreSQL snapshots
also run the exact expected `--version`. Snapshotting, hash/version probes, and
the source-commit check consume the same monotonic operation deadline as later
adapters; non-regular inputs fail before being opened. The current repository
commit must match `BUDGET_SOURCE_COMMIT`, which is recorded in every backup
manifest and
must match exactly during restore before decryption or PostgreSQL execution.

- `BUDGET_OFFSITE_BIN put LOCAL DESTINATION KEY` uploads one ciphertext or safe
  manifest.
- `BUDGET_OFFSITE_BIN verify LOCAL DESTINATION KEY` compares remote size and
  SHA-256 with the local file and fails on any mismatch.
- `BUDGET_OFFSITE_BIN get DESTINATION KEY LOCAL` fetches one named file; it must
  reject prefixes, wildcards, and implicit newest selection. Every `verify` or
  `get` must emit one bounded receipt containing the exact configured provider,
  object key, nonempty object version, remote size/SHA-256, `immutable=1`, and
  `monitoring=1`. The output must be exactly one canonical record: trailing
  lines, control bytes, duplicate fields, and a successful exit without that
  receipt fail closed.
- `BUDGET_CATALOG_BIN --database=NAME --max-row-summaries=100` emits bounded row
  summaries/catalog hashes without rows, emails, tokens, or secrets.
- `BUDGET_ROLE_FILTER_BIN INPUT OUTPUT ALLOWLIST` emits only reviewed roles and
  rejects role passwords or a role outside the allowlist.
- `scripts/ops/validate-restore-roles.sh ARCHIVE_LIST FILTERED_ROLES TARGET_ROLES`
  parses every archive TOC owner and filtered-SQL grantee against an exact,
  operator-owned target-role manifest that must include `authenticated` and
  `service_role`. Filtered SQL is a bounded canonical subset (`CREATE ROLE` and
  role-membership `GRANT`/`REVOKE` only); comments, quoted values/identifiers,
  dollar quoting, unknown statements, and unallowlisted roles fail closed.
  Validation completes before `psql`. This is deterministic
  fixture evidence only; proof against a real PostgreSQL 17 archive remains
  **BLOCKED** until an approved database-contact session.
- `BUDGET_COMPARE_BIN ... --max-row-summaries=100 --max-content-hashes=100`
  compares migrations, schema/object and bounded row/content hashes, Auth count,
  RLS/policies, ACLs, owners/function bodies, triggers, constraints, indexes,
  and protected financial-command inventory. It must return the exact scratch
  target plus the independently measured manifest and plaintext catalog hashes;
  exactly one canonical record is accepted, and exit status alone is not
  recovery evidence.
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
3. Run `dry-run`; it validates configuration but takes no operation lock and
   creates only the ephemeral validation snapshots described above. It invokes
   no database, encryption, or network operation.
4. In an approved window, run `backup`. It takes a nonblocking live lock,
   starts one 30-minute deadline from a monotonic clock, and measures and pins
   the database receipt. Every adapter receives only the remaining operation
   time; no child starts a fresh budget. The same immutable endpoint is measured
   again immediately before `pg_dump`. Payload sizes are measured by passing the
   file path to `wc` only after the deadline wrapper has started; shell input
   redirection never opens a candidate before that bound.
5. It creates a full custom-format dump, a roles-only/no-role-passwords dump,
   and bounded catalog metadata.
6. The three plaintexts live under one mode-`0700` directory and are age
   encrypted. A trap removes each exact plaintext on success, failure, signal,
   or timeout.
7. The safe manifest records source system ID, versions, release, migration
   manifest hash, and ciphertext hashes; it contains no row or secret value.
8. Each ciphertext and manifest is uploaded and verified. Local `SUCCESS` is
   created only afterward and records the four validated provider receipts.
   Those fixture-validated receipt contracts are not real provider durability
   proof; retain the provider's independent redacted immutable receipt.

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
4. Run `dry-run`. The default is `scratch`; it creates only the ephemeral
   validation snapshots described above and invokes no database, encryption, or
   network operation.
5. Run `restore`. It locks scratch, measures the scratch database identity and
   emptiness, and fetches only the named manifest and three ciphertexts. The
   trusted manifest receipt, source identity, system ID, major version, and all
   ciphertext hashes are verified before age or PostgreSQL runs. The same
   immutable scratch endpoint must produce the same empty receipt again before
   `psql` or `pg_restore`.
6. Decryption stays in private scratch temp. Each decrypted/listed/filtered
   artifact must be nonempty, operator-owned, and inaccessible to group/other.
   The archive TOC owners and filtered role grantees are validated independently
   against the private target-role manifest. `psql` uses `ON_ERROR_STOP`;
   `pg_restore` uses one job and
   `--exit-on-error` within one monotonic 60-minute whole-operation deadline.
   Every fetch, hash, decrypt, list, filter, database, and comparison adapter
   receives only the remaining time.
7. The bounded comparison adapter must emit the exact structured receipt for
   the independently hashed manifest and plaintext catalog. Process exit without
   that catalog/data comparison receipt is not a verified restore.
8. The trap removes the exact bounded temp directory as one validated unit,
   including adapter-created flat sibling artifacts. Export redacted
   timings/comparison, then
   use a separately approved cleanup that revalidates markers and identities.
   Trap validation, descriptor-relative unlinking, temp/lock directory removal,
   and executable-snapshot removal share one five-second deadline so an expired
   restore operation cannot suppress cleanup. This repository deletes no
   database, volume, service, or persistent directory.

The script deliberately refuses every live restore, even when incident fields
are present. A live extension needs a separate review with incident ID, typed
target, stopped-app proof, fresh pre-restore backup, owner approval, and an
accepted reconciliation/loss decision. Never run `supabase db reset` live.

## Migration integrity

[`ops/budget-migrations.sha256`](../../ops/budget-migrations.sha256) describes
the 18 migrations at approved source head `00f4bf8`. Regenerate only for a
separately approved release. Do not overwrite a manifest or edit an applied
migration.

Before release, export applied versions to an operator-owned file, one 14-digit
version per line, with a reviewed read-only query. An untouched database has an
empty applied file; otherwise the rows must equal an ordered contiguous prefix
of the manifest. Applied exports are capped at 256 physical lines and 4 KiB;
manifests are capped at 258 physical lines and 128 KiB. `verify-manifest`
requires manifest versions to be strictly increasing and each manifest row to
match the canonical local journal at the same position. It rejects a wrong
source SHA, duplicate versions, changed/missing applied files, unmanifested
local files, and applied rows that are unknown, duplicated, gapped, or out of
order. It never applies, replays, rolls back, or auto-retries a migration.

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
| Backup | Named local/off-site ciphertexts, matching hashes/sizes, receipt | **BLOCKED — no encrypted backup performed** (2026-09-11 drill used a plaintext local dump only) |
| Restore | Named fetch, decrypt, restore, full comparison, cleanup | **PARTIAL — 2026-09-11 drill restored a plaintext CLI dump into exact-version scratch and passed full comparison; no encrypted off-site fetch or decrypt yet** |
| RPO/RTO | Backup age at most 24h; verified restore below four hours | **PARTIAL — 2026-09-11 drill: dumps 162 s, restore and verification under 5 s at current volume; no scheduled backup exists, so RPO is unmeasured** |
| Migration | Release SHA, manifest/applied rows, empty/upgrade DB proof | **PARTIAL — offline integrity; 2026-09-11 drill restored the 32-row live journal exactly** |
| Isolation | Before/after Budget and Sandooq/POS identities unchanged | **BLOCKED — host audit not authorized** |
| Approval | Named operator and Daniel's real-data authorization | **BLOCKED** |

Fixture tests and dry-runs are repository proof only, never a substitute for an
actual encrypted off-site backup, measured scratch restore, or launch approval.

## Hosted Supabase scratch-restore drill — 2026-09-11

This is **measured drill evidence**, not the encrypted off-site recovery point
this runbook requires, and it does not change the real-data gate above. The
tooling above targets a self-hosted `budget-live` PostgreSQL; live Budget runs on
hosted Supabase project `hqblhzqitrbvpyoxtmew` (`ap-south-1`, image
`17.6.1.166`), which those scripts do not cover. The drill used Supabase CLI
`2.109.1` directly plus throwaway scripts that are not committed.

### Boundary

- Production contact was read-only: dump dry-runs, six `supabase db dump
  --linked` runs, one `auth.schema_migrations` read, and catalog metadata and
  fingerprint queries. No migration, write, reset, or hosted configuration
  change. The database password was supplied by environment reference so the
  CLI did not mint a temporary login role on production.
- The dump was plaintext on the operator Mac in a mode-`0700` session
  directory, neither encrypted nor off-site. It includes the Auth user row
  (password hash) and the Household invitation key, and it is retained only
  until owner-approved cleanup.
- Live session-credential tables (`auth.sessions`, `auth.refresh_tokens`,
  `auth.mfa_amr_claims`, `auth.one_time_tokens`, `auth.flow_state`) were
  excluded from the data dump; a real recovery invalidates sessions anyway.
- The target was a loopback-only Docker container from the exact production
  image `supabase/postgres:17.6.1.166`, restored in one `psql`
  single-transaction as `supabase_admin`.

### Result (run 3, fresh container)

| Check | Result |
| --- | --- |
| Production drift | None: pre- and post-dump fingerprints identical; a later fingerprint showed the same row and sequence state |
| Catalog and data fingerprint (969 objects) | 936/936 application objects match; the excluded session tables differ as designed; 26/27 platform objects match (the image's `postgres` role attributes differ from hosted) |
| Foreign keys (data loaded with triggers disabled) | 52 constraints, 0 orphan rows |
| RLS row visibility | Owner JWT sees 1 space, 1 wallet, 23 categories, 1 membership; an unrelated JWT sees 0 |
| Privilege boundary | `authenticated` denied on `private.household_invitation_keys` and on a direct `public.spaces` insert; `anon` denied on `public.spaces` and `public.categories` |
| Timing | Dumps 162 s (six CLI runs, mostly container start-up); container ready about 2 s with the image cached; restore, fingerprint, FK, and smoke steps each under 1 s |

The dataset is tiny (one user, one space, 23 categories), so timings bound
procedure overhead, not large-volume restore time.

### Defects found and the restore steps that fixed them

1. **Missing platform role.** The CLI role dump comments out reserved-role
   `CREATE`, `ALTER`, and membership statements but not
   `GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin"`.
   The bare image lacks that Realtime-provisioned role, so run 1 failed and
   rolled back. Create the role in the target first (all attributes false;
   member of `anon`, `authenticated`, `service_role`, recovered from the
   production fingerprint). The backup artifact stays unmodified.
2. **Silent privilege widening (security).** Supabase databases, production
   included, carry per-schema default privileges in `public` for `postgres` and
   `supabase_admin` that grant `anon`, `authenticated`, and `service_role`
   everything when an object is created. The schema dump restates ACLs only
   relative to built-in defaults: it emitted `GRANT`s and no
   `REVOKE ... FROM "anon"`. Run 2 therefore restored "successfully", with
   row-visibility smoke checks passing, while `anon` could `SELECT`
   `public.spaces` and `EXECUTE` the `SECURITY DEFINER`
   `leave_household_space`, both denied in production. Inside the restore
   transaction, revoke every item from the `public` default-privilege rows of
   both roles (a per-schema row disappears only when empty), assert none remain,
   restore, then re-grant the original items. Verify ACL parity by catalog
   comparison, and expect `permission denied` rather than merely zero rows.

Restore order that passed: drop the image's placeholder `auth` schema, create
the platform role, neutralize `public` default privileges, then roles, `auth`
schema, `supabase_migrations` schema, application schema, data (empty `storage`
blocks removed because scratch runs no storage service), migration history,
`auth.schema_migrations` versions, and finally reinstate the default privileges.

### CLI hazards measured with 2.109.1

- `db dump --dry-run` prints the database password in clear text; never run it
  where output is logged.
- In schema mode, `--schema a,b` renders an unquoted `a|b` that the generated
  shell script treats as a pipe; dump one schema per invocation.
- The default schema dump excludes `auth`, `storage`, and `supabase_migrations`;
  the default data dump includes `auth` rows but excludes `supabase_migrations`
  and `auth.schema_migrations`.

## Supabase CLI dump scratch restore (repository procedure)

`scripts/ops/supabase-scratch-restore.sh` replaces the drill's throwaway
scripts with a reviewed, fail-closed procedure. It is offline tooling: it never
connects to a hosted project, and every database command runs through
`docker exec` inside one labelled scratch container. Producing a bundle or a
fingerprint from Budget Production is production contact and requires
Daniel's explicit approval; the CLI hazards above still apply.

### Bundle

An operator-owned directory with no group/other permissions, holding
operator-owned files with no group/other permissions (dumps up to 512 MiB each,
the versions file up to 16 MiB):

| File | Supabase CLI 2.109.1 source |
| --- | --- |
| `roles.sql` | `db dump --role-only` |
| `auth-schema.sql` | `db dump -s auth` |
| `supabase-migrations-schema.sql` | `db dump -s supabase_migrations` |
| `schema.sql` | `db dump` |
| `data.sql` | `db dump --data-only --use-copy` with `-x` for `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_amr_claims`, `auth.one_time_tokens`, `auth.flow_state` |
| `migration-history.sql` | `db dump --data-only --use-copy -s supabase_migrations` |
| `auth-schema-migrations.txt` | one `auth.schema_migrations` version per line: 2–14 digits, unique, at most 512 |

Before any target is contacted the script refuses a psql meta-command or
transaction-control statement outside COPY data, an unterminated COPY block,
any `storage` row (scratch runs no storage service; only empty `storage` COPY
blocks are dropped), and an invalid versions file. The transaction-control
check is line-based and conservative: a function body line beginning with
`COMMIT` or `ROLLBACK` is refused for review rather than parsed.

### Scratch target

`BUDGET_SCRATCH_CONTAINER` names one running container that:

- carries the label `budget.restore-target=supabase-scratch`;
- runs `supabase/postgres:17.6.1.166` by index digest
  `sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86`
  (identical on Docker Hub and `public.ecr.aws`, measured 2026-09-11);
- publishes no port, or only on `127.0.0.1`/`::1`, and does not use host
  networking; and
- is reached through a local unix-socket or SSH Docker endpoint (`tcp://` is
  refused).

The container ID is resolved and pinned before any database command. A real-data
scratch on the shared Ubuntu host remains subject to the isolation audit above.

### Commands

```bash
scripts/ops/supabase-scratch-restore.sh render /absolute/bundle
BUDGET_SCRATCH_CONTAINER=name scripts/ops/supabase-scratch-restore.sh restore /absolute/bundle
BUDGET_SCRATCH_CONTAINER=name scripts/ops/supabase-scratch-restore.sh verify /absolute/production.fingerprint
BUDGET_SCRATCH_CONTAINER=name scripts/ops/supabase-scratch-restore.sh fingerprint /absolute/new.fingerprint
scripts/ops/supabase-scratch-restore.sh compare /absolute/expected /absolute/actual
```

`render` prints the exact transaction for review. It contains the dump data, so
keep any saved copy inside the private bundle directory. Exit codes: `64` usage,
`65` bundle or input refused, `66` target refused, `67` database command failed
or restore rolled back, `68` verification failed.

### Transaction

`restore` pipes the rendered stream to `psql --single-transaction` with
`ON_ERROR_STOP` as `supabase_admin`, in this order:

1. `prepare-target.sql` records the transaction, refuses a target that is not a
   pristine image, and drops the placeholder `auth` schema without `CASCADE`.
2. `platform-role-supabase_realtime_admin.sql`, only when `roles.sql`
   references that role, creates it when absent.
3. `neutralize-default-privileges.sql` snapshots and revokes every item of the
   `public` default-privilege rows of `postgres` and `supabase_admin`, then
   asserts none remain.
4. `roles.sql`, `auth-schema.sql`, `supabase-migrations-schema.sql`, `schema.sql`,
   `data.sql`, `migration-history.sql`, then the `auth.schema_migrations`
   versions. Each segment first resets role, session authorization, and
   settings and asserts it is still in the same transaction; data segments load
   with `session_replication_role = replica`.
5. `reinstate-default-privileges.sql` grants the snapshot back and asserts
   every item is present.
6. The completion segment marks the stream complete. A deferred constraint
   trigger, enabled in every replication role, refuses the commit otherwise, so
   a stream that ends early commits nothing.

### Verification

`verify` requires all three checks and reports every failure:

- **Fingerprint:** `ops/supabase-restore/fingerprint.sql`, run as `postgres`,
  must match the production fingerprint line for line. It covers role and
  function settings (non-allowlisted values as md5), schema, relation, function,
  and type owners and ACLs with NULL normalized to `acldefault()`, columns by
  position among non-dropped columns, constraints, indexes, RLS flags,
  policies, triggers, default ACLs, sequences, and per-table `count:md5`. Scope
  is every CLI application schema plus `auth` and `supabase_migrations`; row
  data of the five excluded session tables is not hashed. Role attributes are
  not compared.
- **Foreign keys:** `foreign-key-orphans.sql` counts child rows without a
  parent for every foreign key; any orphan fails, because data loads with
  triggers disabled.
- **Privileges:** every probe in `ops/supabase-restore/privilege-probes.txt`
  must raise SQLSTATE `42501`. A probe that succeeds, even on zero rows, fails.

The production side runs the same file read-only, as `postgres`, only with
Daniel's approval (**BLOCKED**):
`psql "<approved connection by reference>" -X -f ops/supabase-restore/fingerprint.sql > production.fingerprint`.
This definition has not yet been run against production. The drill used a
throwaway query, so the first comparison may surface differences that need a
reviewed decision rather than an ad hoc exclusion.

### Tests

`pnpm check:ops` runs `tests/ops/supabase-scratch-restore.test.ts` against the
real image through Testcontainers with synthetic fixtures only: a
Supabase-shaped source is dumped through the CLI 2.109.1 pipelines copied
verbatim into `tests/ops/fixtures/supabase-restore/cli-2.109.1-dump.sh`. It
needs a Docker endpoint that Testcontainers can reach as a unix socket;
Testcontainers 12.1.0 does not speak `ssh://`. Tailscale SSH on the Le Labo
Ubuntu host refuses unix-socket forwarding (`socket path "/var/run/docker.sock"
is not in an allowed directory`, measured 2026-09-11) but allows exec sessions.
Reach that daemon through a local socket that runs
`ssh lelabo@100.76.160.91 docker system dial-stdio` for each connection,
multiplexed over one SSH master whose `ControlPath` fits the 104-byte macOS
socket limit. Disable the Ryuk reaper, which cannot connect back through such a
bridge:

```bash
DOCKER_HOST="unix://<local bridge socket>" TESTCONTAINERS_RYUK_DISABLED=true pnpm check:ops
```

The suite stops its own containers; each carries the label
`budget.restore-test=supabase-scratch-restore` for manual cleanup after an
interrupted run.

Encryption, off-site storage, key custody, scheduling, and any live restore
remain outside this procedure and **BLOCKED** on owner decisions.
