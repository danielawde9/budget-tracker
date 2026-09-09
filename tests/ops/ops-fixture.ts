import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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

export function makeBackupFixture() {
  const base = mkdtempSync(join(tmpdir(), 'budget-ops-backup-'));
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

  makeExecutable(
    timeout,
    'seconds="$1"; shift; printf "timeout:%s:%s\\n" "$seconds" "${1##*/}" >> "$BUDGET_FAKE_LOG"; "$@"',
  );
  makeExecutable(
    pgDump,
    'output=""; for argument in "$@"; do case "$argument" in --file=*) output="${argument#--file=}" ;; esac; done; test -n "$output"; printf "fixture custom archive\\n" > "$output"; printf "pg_dump\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    pgDumpall,
    'printf "CREATE ROLE budget_authenticated;\\n"; printf "pg_dumpall\\n" >> "$BUDGET_FAKE_LOG"',
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
    'printf "offsite:%s\\n" "$1" >> "$BUDGET_FAKE_LOG"; exit 0',
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BUDGET_ENV: 'live',
    BUDGET_ROOT: root,
    BUDGET_MARKER_PATH: marker,
    BUDGET_PROJECT_ID: 'budget-live',
    BUDGET_HOSTNAME: 'budget-live.tailnet.example',
    BUDGET_VOLUME: 'budget-live-db',
    BUDGET_NETWORK: 'budget-live-net',
    BUDGET_PORT_RANGE: '54620-54629',
    BUDGET_EXPECTED_SYSTEM_ID: '7000000000000000001',
    BUDGET_ACTUAL_SYSTEM_ID: '7000000000000000001',
    BUDGET_AGE_RECIPIENT: 'age1fixturepublicrecipient000000000000000000000000000000',
    BUDGET_OFFSITE_DESTINATION: 'configured-budget-live-offsite',
    BUDGET_RUN_ID: '2026-09-09T021500Z-fixture',
    BUDGET_PGPASS_FILE: passfile,
    BUDGET_DATABASE_HOST: 'fixture-budget-db.internal',
    BUDGET_DATABASE_PORT: '5432',
    BUDGET_DATABASE_NAME: 'budget',
    BUDGET_DATABASE_USER: 'budget_backup',
    BUDGET_POSTGRES_MAJOR: '17',
    BUDGET_PG_DUMP_MAJOR: '17',
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
    BUDGET_FAKE_LOG: log,
  };

  return { base, env, log, marker, root };
}

export function makeRestoreFixture() {
  const backup = makeBackupFixture();
  const scratchRoot = join(backup.base, 'budget-restore-scratch');
  const scratchMarker = join(scratchRoot, '.budget-ops-marker');
  const identity = join(backup.base, 'age-identity');
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

  const hashes: string[] = [];
  for (const [filename, contents] of [
    ['archive.dump.age', 'fixture custom archive\n'],
    ['roles.sql.age', 'CREATE ROLE budget_authenticated;\n'],
    ['catalog.txt.age', 'catalog_hash=fixture-catalog-hash\n'],
  ]) {
    writeFileSync(join(remotePoint, filename), contents, { mode: 0o600 });
    const hash = createHash('sha256').update(contents).digest('hex');
    hashes.push(`${hash}  ${filename}`);
  }
  writeFileSync(
    join(remotePoint, 'manifest.txt'),
    [
      'backup_manifest_version=1',
      `run_id=${recoveryPoint}`,
      'environment=live',
      'project=budget-live',
      'system_id=7000000000000000001',
      'postgres_major=17',
      'pg_dump_major=17',
      'release_id=release-fixture',
      'migration_manifest_sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ...hashes,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  const pgRestore = join(backup.base, 'bin', 'pg_restore');
  const psql = join(backup.base, 'bin', 'psql');
  const roleFilter = join(backup.base, 'bin', 'role-filter');
  const compare = join(backup.base, 'bin', 'compare');
  makeExecutable(
    pgRestore,
    'if [[ "$*" == *"--list"* ]]; then printf "fixture archive list\\n"; exit 0; fi; printf "pg_restore\\n" >> "$BUDGET_FAKE_LOG"; if [[ "${BUDGET_FAKE_RESTORE_FAIL:-0}" == "1" ]]; then exit 19; fi',
  );
  makeExecutable(psql, 'printf "psql\\n" >> "$BUDGET_FAKE_LOG"');
  makeExecutable(
    roleFilter,
    'cp "$1" "$2"; printf "role-filter\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    compare,
    'printf "comparison=verified\\n"; printf "compare\\n" >> "$BUDGET_FAKE_LOG"',
  );
  makeExecutable(
    backup.env.BUDGET_OFFSITE_BIN as string,
    'printf "offsite:%s\\n" "$1" >> "$BUDGET_FAKE_LOG"; case "$1" in get) cp "$BUDGET_OFFSITE_FIXTURE_ROOT/$3" "$4" ;; *) exit 64 ;; esac',
  );

  const env: NodeJS.ProcessEnv = {
    ...backup.env,
    BUDGET_RESTORE_TARGET: 'scratch',
    BUDGET_RECOVERY_POINT: recoveryPoint,
    BUDGET_AGE_IDENTITY_FILE: identity,
    BUDGET_OFFSITE_FIXTURE_ROOT: offsiteRoot,
    BUDGET_SCRATCH_ROOT: scratchRoot,
    BUDGET_SCRATCH_MARKER_PATH: scratchMarker,
    BUDGET_SCRATCH_PROJECT_ID: 'budget-restore-scratch',
    BUDGET_SCRATCH_PORT: '54722',
    BUDGET_SCRATCH_EXPECTED_SYSTEM_ID: '8000000000000000001',
    BUDGET_SCRATCH_ACTUAL_SYSTEM_ID: '8000000000000000001',
    BUDGET_SCRATCH_EMPTY: '1',
    BUDGET_SCRATCH_POSTGRES_MAJOR: '17',
    BUDGET_SCRATCH_REQUIRED_BYTES: '1024',
    BUDGET_SCRATCH_AVAILABLE_BYTES: '10485760',
    BUDGET_PG_RESTORE_BIN: pgRestore,
    BUDGET_PSQL_BIN: psql,
    BUDGET_ROLE_FILTER_BIN: roleFilter,
    BUDGET_COMPARE_BIN: compare,
    BUDGET_ROLE_ALLOWLIST: 'budget_authenticated,budget_anon,budget_service',
  };

  return {
    ...backup,
    env,
    identity,
    offsiteRoot,
    recoveryPoint,
    scratchMarker,
    scratchRoot,
  };
}
