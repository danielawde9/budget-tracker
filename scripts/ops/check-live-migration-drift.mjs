#!/usr/bin/env node
// Pure comparison: local supabase/migrations/*.sql versions vs. the versions
// already applied on a live database (read from a JSON file the bash wrapper
// produced via `supabase db query --linked`). No network access here, so
// this half is testable without live credentials.
import { readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const migrationNamePattern = /^(\d{14})_[a-z0-9_]+\.sql$/;
const maxMigrationCount = 100;

function localMigrations(directory) {
  const names = readdirSync(directory).filter((name) => migrationNamePattern.test(name)).sort();
  if (names.length > maxMigrationCount) {
    throw new Error(`migration directory exceeds ${maxMigrationCount} entries`);
  }
  return names.map((name) => ({ name, version: migrationNamePattern.exec(name)[1] }));
}

function remoteVersions(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('remote migration history JSON must be an array of rows');
  }
  if (parsed.length === 0) return [];
  const row = parsed[0];
  if (!row || !Array.isArray(row.versions)) {
    throw new Error('remote migration history JSON row must have a "versions" array');
  }
  return row.versions.filter((value) => typeof value === 'string');
}

function main(migrationsDir, remoteJsonPath) {
  const local = localMigrations(migrationsDir);
  const remote = new Set(remoteVersions(remoteJsonPath));
  const localVersions = new Set(local.map((migration) => migration.version));

  const notOnRemote = local.filter((migration) => !remote.has(migration.version));
  const notLocal = [...remote].filter((version) => !localVersions.has(version)).sort();

  if (notOnRemote.length === 0 && notLocal.length === 0) {
    console.log(`local and the live database agree on all ${local.length} migrations`);
    return 0;
  }
  if (notOnRemote.length > 0) {
    console.error(
      `committed locally but NOT applied on the live database (${notOnRemote.length}): ` +
      notOnRemote.map((migration) => migration.name).join(', '),
    );
  }
  if (notLocal.length > 0) {
    console.error(
      `applied on the live database but missing from supabase/migrations (${notLocal.length}): ` +
      notLocal.join(', '),
    );
  }
  return 1;
}

const [migrationsDir, remoteJsonPath] = process.argv.slice(2);
if (!migrationsDir || !remoteJsonPath) {
  console.error('usage: check-live-migration-drift.mjs MIGRATIONS_DIR REMOTE_VERSIONS_JSON');
  process.exit(64);
}
process.exit(main(migrationsDir, remoteJsonPath));
