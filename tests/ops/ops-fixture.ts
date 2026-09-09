import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeExecutable(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
    mode: 0o700,
  });
  chmodSync(path, 0o700);
}

function fileSha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function makeBackupFixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'budget-ops-backup-'));
  const root = join(base, 'budget-live');
  const bin = join(base, 'bin');
  const log = join(base, 'commands.log');
  const marker = join(root, '.budget-ops-marker');
  const passfile = join(base, 'pgpass');
  const migrationManifest = join(base, 'migrations.sha256');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(
    marker,
    [
      'budget-ops-marker-v1',
      'environment=live',
      'project=budget-live',
      'system_id=7000000000000000001',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  writeFileSync(passfile, 'fixture-host:5432:budget:budget_backup:fixture-only\n', {
    mode: 0o600,
  });
  writeFileSync(
    migrationManifest,
    '20260907000000|fixture.sql|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    { mode: 0o600 },
  );

  const timeout = join(bin, 'timeout');
  const pgDump = join(bin, 'pg_dump');
  const pgDumpall = join(bin, 'pg_dumpall');
  const age = join(bin, 'age');
  const catalog = join(bin, 'catalog');
  const offsite = join(bin, 'offsite');
  const clock = join(bin, 'clock');
  const verifyPsql = join(bin, 'verify-psql');

  makeExecutable(
    timeout,
    'seconds="$1"; shift; printf "timeout:%s:%s\\n" "$seconds" "${1##*/}" >> "$BUDGET_FAKE_LOG"; "$@"',
  );
  makeExecutable(
    pgDump,
    'if [[ "${1:-}" == "--version" ]]; then printf "pg_dump (PostgreSQL) %s\\n" "${BUDGET_FAKE_PG_VERSION:-17.6}"; exit 0; fi; output=""; for argument in "$@"; do case "$argument" in --file=*) output="${argument#--file=}" ;; esac; done; test -n "$output"; printf "fixture custom archive\\n" > "$output"; printf "pg_dump\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    pgDumpall,
    'if [[ "${1:-}" == "--version" ]]; then printf "pg_dumpall (PostgreSQL) %s\\n" "${BUDGET_FAKE_PG_VERSION:-17.6}"; exit 0; fi; printf "CREATE ROLE budget_authenticated;\\n"; printf "pg_dumpall\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    age,
    'if [[ "${BUDGET_FAKE_AGE_FAIL:-0}" == "1" ]]; then exit 17; fi; output=""; input=""; while (($#)); do case "$1" in -o) output="$2"; shift 2 ;; -r) shift 2 ;; *) input="$1"; shift ;; esac; done; cp "$input" "$output"; printf "age\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    catalog,
    'printf "row_summary=wallets:0\\ncatalog_hash=fixture-catalog-hash\\n"; printf "catalog\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    offsite,
    [
      'printf "offsite:%s\\n" "$1" >> "$BUDGET_FAKE_LOG"',
      '[[ "$1" == "put" ]] && exit 0',
      '[[ "$1" == "verify" ]] || exit 64',
      '[[ "${BUDGET_FAKE_OFFSITE_RECEIPT_INVALID:-0}" == "1" ]] && { printf "verified\\n"; exit 0; }',
      'size="$(/usr/bin/wc -c < "$2")"; size="${size//[[:space:]]/}"',
      'hash="$(/usr/bin/shasum -a 256 "$2")"; hash="${hash%% *}"',
      'printf "receipt_version=1|provider=%s|object_key=%s|object_version=fixture-v1|remote_size=%s|remote_sha256=%s|immutable=1|monitoring=1\\n" "$BUDGET_OFFSITE_PROVIDER_ID" "$4" "$size" "$hash"',
    ].join('\n'),
  );
  makeExecutable(clock, 'printf "2026-09-09T02:15:00Z\\n"');
  makeExecutable(
    verifyPsql,
    [
      'counter_file="$BUDGET_FAKE_VERIFY_COUNTER"',
      'if [[ "${1:-}" == "--version" ]]; then printf "psql (PostgreSQL) %s\\n" "${BUDGET_FAKE_PG_VERSION:-17.6}"; exit 0; fi',
      'counter=0',
      '[[ -f "$counter_file" ]] && counter="$(<"$counter_file")"',
      'counter=$((counter + 1))',
      'printf "%s\\n" "$counter" > "$counter_file"',
      'printf "db-verify:%s\\n" "$counter" >> "$BUDGET_FAKE_LOG"',
      'if [[ "$counter" == "1" && -n "${BUDGET_FAKE_SWAP_MARKER_PATH:-}" ]]; then',
      '  mv -- "$BUDGET_FAKE_SWAP_MARKER_PATH" "${BUDGET_FAKE_SWAP_MARKER_PATH}.real"',
      '  ln -s -- "${BUDGET_FAKE_SWAP_MARKER_PATH}.real" "$BUDGET_FAKE_SWAP_MARKER_PATH"',
      'fi',
      'if [[ "$counter" == "1" && -n "${BUDGET_FAKE_SWAP_ROOT_PATH:-}" ]]; then',
      '  mv -- "$BUDGET_FAKE_SWAP_ROOT_PATH" "${BUDGET_FAKE_SWAP_ROOT_PATH}.real"',
      '  ln -s -- "${BUDGET_FAKE_SWAP_ROOT_PATH}.real" "$BUDGET_FAKE_SWAP_ROOT_PATH"',
      'fi',
      'system_id="${BUDGET_FAKE_VERIFY_SYSTEM_ID:-7000000000000000001}"',
      'database_name="${BUDGET_VERIFY_DATABASE_NAME:?}"',
      'database_oid="${BUDGET_FAKE_VERIFY_DATABASE_OID:-17001}"',
      'relation_count="${BUDGET_FAKE_VERIFY_RELATION_COUNT:-7}"',
      'if [[ "$database_name" == "budget_restore_scratch" ]]; then',
      '  system_id="${BUDGET_FAKE_VERIFY_SYSTEM_ID:-8000000000000000001}"',
      '  database_oid="${BUDGET_FAKE_VERIFY_DATABASE_OID:-18001}"',
      '  relation_count="${BUDGET_FAKE_VERIFY_RELATION_COUNT:-0}"',
      'fi',
      '[[ "$counter" == "2" && -n "${BUDGET_FAKE_VERIFY_SECOND_SYSTEM_ID:-}" ]] && system_id="$BUDGET_FAKE_VERIFY_SECOND_SYSTEM_ID"',
      'printf "%s|17|%s|%s|%s\\n" "$system_id" "$database_name" "$database_oid" "$relation_count"',
    ].join('\n'),
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BUDGET_ENV: 'live',
    BUDGET_ROOT: root,
    BUDGET_TRUSTED_PARENT: base,
    BUDGET_MARKER_PATH: marker,
    BUDGET_PROJECT_ID: 'budget-live',
    BUDGET_HOSTNAME: 'budget-live.tailnet.example',
    BUDGET_VOLUME: 'budget-live-db',
    BUDGET_NETWORK: 'budget-live-net',
    BUDGET_PORT_RANGE: '54620-54629',
    BUDGET_EXPECTED_SYSTEM_ID: '7000000000000000001',
    BUDGET_EXPECTED_DATABASE_OID: '17001',
    BUDGET_AGE_RECIPIENT: 'age1fixturepublicrecipient000000000000000000000000000000',
    BUDGET_OFFSITE_DESTINATION: 'configured-budget-live-offsite',
    BUDGET_OFFSITE_ALLOWED_PREFIX: 'configured-budget-live-offsite',
    BUDGET_OFFSITE_PROVIDER_ID: 'fixture-provider',
    BUDGET_RUN_ID: '2026-09-09T021500Z-fixture',
    BUDGET_PGPASS_FILE: passfile,
    BUDGET_DATABASE_HOST: 'fixture-budget-db.internal',
    BUDGET_DATABASE_PORT: '5432',
    BUDGET_DATABASE_NAME: 'budget',
    BUDGET_DATABASE_USER: 'budget_backup',
    BUDGET_POSTGRES_MAJOR: '17',
    BUDGET_PG_DUMP_MAJOR: '17',
    BUDGET_PG_DUMP_VERSION: '17.6',
    BUDGET_PG_DUMP_SHA256: fileSha256(pgDump),
    BUDGET_PG_DUMPALL_SHA256: fileSha256(pgDumpall),
    BUDGET_VERIFY_PSQL_SHA256: fileSha256(verifyPsql),
    BUDGET_DB_VERIFY_SHA256: fileSha256(
      join(process.cwd(), 'scripts/ops/verify-budget-db.sh'),
    ),
    BUDGET_SOURCE_COMMIT: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim(),
    BUDGET_RELEASE_ID: 'release-fixture',
    BUDGET_MIGRATION_MANIFEST: migrationManifest,
    BUDGET_REQUIRED_BYTES: '1024',
    BUDGET_AVAILABLE_BYTES: '10485760',
    BUDGET_TIMEOUT_BIN: timeout,
    BUDGET_PG_DUMP_BIN: pgDump,
    BUDGET_PG_DUMPALL_BIN: pgDumpall,
    BUDGET_AGE_BIN: age,
    BUDGET_CATALOG_BIN: catalog,
    BUDGET_OFFSITE_BIN: offsite,
    BUDGET_CLOCK_BIN: clock,
    BUDGET_DB_VERIFY_BIN: join(process.cwd(), 'scripts/ops/verify-budget-db.sh'),
    BUDGET_VERIFY_PSQL_BIN: verifyPsql,
    BUDGET_FAKE_VERIFY_COUNTER: join(base, 'verify-counter'),
    BUDGET_FAKE_LOG: log,
  };

  return { base, env, log, marker, passfile, pgDump, root };
}

export function makeRestoreFixture() {
  const backup = makeBackupFixture();
  const scratchRoot = join(backup.base, 'budget-restore-scratch');
  const scratchMarker = join(scratchRoot, '.budget-ops-marker');
  const identity = join(backup.base, 'age-identity');
  const targetRoleManifest = join(backup.base, 'target-roles.txt');
  const offsiteRoot = join(backup.base, 'offsite');
  const recoveryPoint = '2026-09-09T021500Z-fixture';
  const remotePoint = join(offsiteRoot, recoveryPoint);
  mkdirSync(scratchRoot, { mode: 0o700 });
  mkdirSync(remotePoint, { recursive: true, mode: 0o700 });
  writeFileSync(
    scratchMarker,
    [
      'budget-restore-marker-v1',
      'target=scratch',
      'project=budget-restore-scratch',
      'system_id=8000000000000000001',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  writeFileSync(identity, 'AGE-SECRET-KEY-fixture-only\n', { mode: 0o600 });
  writeFileSync(
    targetRoleManifest,
    [
      'postgres',
      'budget_authenticated',
      'budget_anon',
      'budget_service',
      'authenticated',
      'service_role',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  const hashes: string[] = [];
  const catalogContents = 'catalog_hash=fixture-catalog-hash\n';
  const restorePayloads: ReadonlyArray<readonly [string, string]> = [
    ['archive.dump.age', 'fixture custom archive\n'],
    [
      'roles.sql.age',
      'CREATE ROLE budget_authenticated;\nGRANT budget_authenticated TO authenticated;\nGRANT budget_authenticated TO service_role;\n',
    ],
    ['catalog.txt.age', catalogContents],
  ];
  for (const [filename, contents] of restorePayloads) {
    writeFileSync(join(remotePoint, filename), contents, { mode: 0o600 });
    const hash = createHash('sha256').update(contents).digest('hex');
    hashes.push(`${hash}  ${filename}`);
  }
  const manifest = [
      'backup_manifest_version=1',
      `run_id=${recoveryPoint}`,
      'environment=live',
      'project=budget-live',
      'system_id=7000000000000000001',
      'postgres_major=17',
      'pg_dump_major=17',
      `source_commit=${backup.env.BUDGET_SOURCE_COMMIT}`,
      'release_id=release-fixture',
      'migration_manifest_sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      `catalog_metadata_sha256=${createHash('sha256').update(catalogContents).digest('hex')}`,
      ...hashes,
      '',
    ].join('\n');
  writeFileSync(join(remotePoint, 'manifest.txt'), manifest, { mode: 0o600 });
  const manifestHash = createHash('sha256').update(manifest).digest('hex');

  const pgRestore = join(backup.base, 'bin', 'pg_restore');
  const psql = join(backup.base, 'bin', 'psql');
  const roleFilter = join(backup.base, 'bin', 'role-filter');
  const compare = join(backup.base, 'bin', 'compare');
  makeExecutable(
    pgRestore,
    'if [[ "${1:-}" == "--version" ]]; then printf "pg_restore (PostgreSQL) %s\\n" "${BUDGET_FAKE_PG_VERSION:-17.6}"; exit 0; fi; if [[ "$*" == *"--list"* ]]; then printf "215; 1259 16384 TABLE public wallets %s\\n" "${BUDGET_FAKE_TOC_OWNER:-budget_service}"; exit 0; fi; printf "pg_restore\\n" >> "$BUDGET_FAKE_LOG"; if [[ "${BUDGET_FAKE_RESTORE_FAIL:-0}" == "1" ]]; then exit 19; fi',
  );
  makeExecutable(
    psql,
    'if [[ "${1:-}" == "--version" ]]; then printf "psql (PostgreSQL) %s\\n" "${BUDGET_FAKE_PG_VERSION:-17.6}"; exit 0; fi; printf "psql\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    roleFilter,
    'cp "$1" "$2"; printf "role-filter\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    compare,
    [
      'printf "compare\\n" >> "$BUDGET_FAKE_LOG"',
      'manifest=""; catalog=""',
      'for argument in "$@"; do case "$argument" in --source-manifest=*) manifest="${argument#--source-manifest=}" ;; --source-catalog=*) catalog="${argument#--source-catalog=}" ;; esac; done',
      'manifest_hash="$(/usr/bin/shasum -a 256 "$manifest")"; manifest_hash="${manifest_hash%% *}"',
      'catalog_hash="$(/usr/bin/shasum -a 256 "$catalog")"; catalog_hash="${catalog_hash%% *}"',
      'printf "comparison_version=1|status=verified|target=scratch|manifest_sha256=%s|catalog_sha256=%s\\n" "$manifest_hash" "$catalog_hash"',
    ].join('\n'),
  );
  makeExecutable(
    backup.env.BUDGET_OFFSITE_BIN as string,
    [
      'printf "offsite:%s\\n" "$1" >> "$BUDGET_FAKE_LOG"',
      '[[ "$1" == "get" ]] || exit 64',
      'cp "$BUDGET_OFFSITE_FIXTURE_ROOT/$3" "$4"',
      'size="$(/usr/bin/wc -c < "$4")"; size="${size//[[:space:]]/}"',
      'hash="$(/usr/bin/shasum -a 256 "$4")"; hash="${hash%% *}"',
      'printf "receipt_version=1|provider=%s|object_key=%s|object_version=fixture-v1|remote_size=%s|remote_sha256=%s|immutable=1|monitoring=1\\n" "$BUDGET_OFFSITE_PROVIDER_ID" "$3" "$size" "$hash"',
    ].join('\n'),
  );

  const env: NodeJS.ProcessEnv = {
    ...backup.env,
    BUDGET_RESTORE_TARGET: 'scratch',
    BUDGET_RECOVERY_POINT: recoveryPoint,
    BUDGET_AGE_IDENTITY_FILE: identity,
    BUDGET_OFFSITE_FIXTURE_ROOT: offsiteRoot,
    BUDGET_SCRATCH_ROOT: scratchRoot,
    BUDGET_SCRATCH_TRUSTED_PARENT: backup.base,
    BUDGET_SCRATCH_MARKER_PATH: scratchMarker,
    BUDGET_SCRATCH_PROJECT_ID: 'budget-restore-scratch',
    BUDGET_SCRATCH_PORT: '54722',
    BUDGET_SCRATCH_EXPECTED_SYSTEM_ID: '8000000000000000001',
    BUDGET_SCRATCH_EXPECTED_DATABASE_OID: '18001',
    BUDGET_SCRATCH_DATABASE_NAME: 'budget_restore_scratch',
    BUDGET_SCRATCH_POSTGRES_MAJOR: '17',
    BUDGET_SCRATCH_REQUIRED_BYTES: '1024',
    BUDGET_SCRATCH_AVAILABLE_BYTES: '10485760',
    BUDGET_PG_RESTORE_BIN: pgRestore,
    BUDGET_PSQL_BIN: psql,
    BUDGET_PG_RESTORE_SHA256: fileSha256(pgRestore),
    BUDGET_PSQL_SHA256: fileSha256(psql),
    BUDGET_ROLE_FILTER_BIN: roleFilter,
    BUDGET_COMPARE_BIN: compare,
    BUDGET_ROLE_ALLOWLIST: 'postgres,budget_authenticated,budget_anon,budget_service,authenticated,service_role',
    BUDGET_TARGET_ROLE_MANIFEST: targetRoleManifest,
    BUDGET_ROLE_VALIDATOR_BIN: join(
      process.cwd(),
      'scripts/ops/validate-restore-roles.sh',
    ),
    BUDGET_ROLE_VALIDATOR_SHA256: fileSha256(
      join(process.cwd(), 'scripts/ops/validate-restore-roles.sh'),
    ),
    BUDGET_EXPECTED_MANIFEST_SHA256: manifestHash,
  };

  return {
    ...backup,
    env,
    identity,
    offsiteRoot,
    recoveryPoint,
    scratchMarker,
    scratchRoot,
    targetRoleManifest,
  };
}
