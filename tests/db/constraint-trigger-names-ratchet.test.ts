import { closeSync, fstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// CREATE CONSTRAINT TRIGGER registers a pg_constraint row in the same
// (conrelid, contypid, conname) namespace as ordinary CHECK constraints, and
// Postgres auto-names an unnamed multi-column CHECK `<table>_check`,
// `<table>_check1`, ... A constraint trigger named `<table>_check` therefore
// collides the moment its table has such a CHECK. This bit task 04 and again
// task 20, so the naming convention is enforced here rather than remembered.

const maximumMigrationFiles = 256;
const maximumMigrationBytes = 1_048_576;
const maximumTriggersPerFile = 256;
const migrationDirectory = join(process.cwd(), 'supabase/migrations');

function migrationNames(): string[] {
  const directory = opendirSync(migrationDirectory);
  const names: string[] = [];
  try {
    for (let inspected = 0; inspected <= maximumMigrationFiles; inspected += 1) {
      const entry = directory.readSync();
      if (!entry) {
        return names.sort();
      }
      if (inspected === maximumMigrationFiles) {
        throw new Error('constraint trigger ratchet directory exceeds its 256-file cap');
      }
      if (entry.isFile() && /^\d{14}_[a-z0-9_]+\.sql$/.test(entry.name)) {
        names.push(entry.name);
      }
    }
    throw new Error('constraint trigger ratchet exceeded its directory iteration bound');
  } finally {
    directory.closeSync();
  }
}

function readMigration(name: string): string {
  const descriptor = openSync(join(migrationDirectory, name), 'r');
  try {
    const size = fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || size < 1 || size > maximumMigrationBytes) {
      throw new Error('constraint trigger ratchet migration must contain between 1 byte and 1 MiB');
    }
    const contents = Buffer.alloc(size);
    let offset = 0;
    for (let attempt = 0; attempt < maximumMigrationBytes && offset < size; attempt += 1) {
      const bytesRead = readSync(descriptor, contents, offset, size - offset, offset);
      if (bytesRead < 1) {
        throw new Error('constraint trigger ratchet migration ended before its declared size');
      }
      offset += bytesRead;
    }
    return contents.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function collidingConstraintTriggerNames(sql: string): string[] {
  const pattern = /create\s+constraint\s+trigger\s+([a-z0-9_]+)/gi;
  const colliding: string[] = [];
  for (let found = 0; found <= maximumTriggersPerFile; found += 1) {
    const match = pattern.exec(sql);
    if (!match) {
      return colliding;
    }
    if (found === maximumTriggersPerFile) {
      throw new Error('constraint trigger ratchet exceeded its per-file trigger bound');
    }
    const name = match[1]!.toLowerCase();
    if (/_check\d*$/.test(name) && !name.endsWith('_publish_check')) {
      colliding.push(name);
    }
  }
  throw new Error('constraint trigger ratchet exceeded its match iteration bound');
}

describe('constraint trigger names', () => {
  it('flags the auto-CHECK-shaped names that collide, and accepts the _publish_check convention', () => {
    expect(collidingConstraintTriggerNames(
      'create constraint trigger budget_month_closes_check after insert on t;\n'
      + 'CREATE CONSTRAINT TRIGGER spaces_check1 after insert on t;\n'
      + 'create constraint trigger goals_publish_check after insert on t;\n'
      + 'create constraint trigger spaces_preserve_membership_invariants after insert on t;',
    )).toEqual(['budget_month_closes_check', 'spaces_check1']);
  });

  it('no migration names a constraint trigger like an auto-generated CHECK constraint', () => {
    const offenders = migrationNames().flatMap((name) =>
      collidingConstraintTriggerNames(readMigration(name)).map((trigger) => `${name}: ${trigger}`));
    expect(offenders).toEqual([]);
  });
});
