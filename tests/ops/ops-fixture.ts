import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
