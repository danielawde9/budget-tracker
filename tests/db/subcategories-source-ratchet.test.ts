import { closeSync, fstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const maximumMigrationFiles = 256;
const maximumMigrationBytes = 1_048_576;
const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const subcategoryFilename = '20260910100000_subcategories_foundation.sql';

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
        throw new Error('source ratchet migration directory exceeds its 256-file cap');
      }
      if (!entry.isFile() || !/^\d{14}_[a-z0-9_]+\.sql$/.test(entry.name)) {
        throw new Error('source ratchet encountered an unclassified migration entry');
      }
      names.push(entry.name);
    }
    throw new Error('source ratchet exceeded its directory iteration bound');
  } finally {
    directory.closeSync();
  }
}

function readMigration(name: string): string {
  const descriptor = openSync(join(migrationDirectory, name), 'r');
  try {
    const size = fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || size < 1 || size > maximumMigrationBytes) {
      throw new Error('source ratchet migration must contain between 1 byte and 1 MiB');
    }
    const contents = Buffer.alloc(size);
    let offset = 0;
    for (let attempt = 0; attempt < maximumMigrationBytes && offset < size; attempt += 1) {
      const bytesRead = readSync(descriptor, contents, offset, size - offset, offset);
      if (bytesRead < 1) {
        throw new Error('source ratchet migration ended before its declared size');
      }
      offset += bytesRead;
    }
    if (offset !== size) {
      throw new Error('source ratchet exceeded its file read bound');
    }
    return contents.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

const migrations = migrationNames().map((name) => ({ name, sql: readMigration(name) }));
const subcategoryMigration = migrations.find(({ name }) => name === subcategoryFilename)?.sql;
if (!subcategoryMigration) {
  throw new Error('the exact subcategory foundation migration is required');
}
const compactMigration = subcategoryMigration.replace(/\s+/g, ' ').trim();

describe('subcategory source boundaries', () => {
  it('allows only the three classified public category writers across the bounded journal', () => {
    const writers = new Set<string>();
    for (const { sql } of migrations) {
      const functions = sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_]+)\s*\([\s\S]*?\bas\s+(\$(?:[a-z_][a-z0-9_]*)?\$)([\s\S]*?)\2\s*;/gi,
      );
      // Each match consumes source text, bounded by the 1 MiB per-file cap.
      for (const match of functions) {
        const name = match[1];
        const body = match[3];
        if (!name || body === undefined) {
          throw new Error('source ratchet could not classify a public function');
        }
        if (/\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?)\s+public\.categories\b/i.test(body)) {
          writers.add(name);
        }
      }
    }
    const publicCategoryWriters = [...writers].sort();
    expect(publicCategoryWriters).toEqual([
      'archive_category',
      'create_category',
      'create_subcategory',
    ]);
  });

  it('defines one creation command and forbids recursive hierarchy or financial backfills', () => {
    expect(subcategoryMigration.match(/create function public\.create_subcategory/g)).toHaveLength(1);
    expect(subcategoryMigration).not.toMatch(/with\s+recursive|\bpath\b|\bdepth\b\s+(integer|bigint)/i);
    expect(subcategoryMigration).not.toMatch(/update\s+public\.financial_events|update\s+public\.financial_event_categories/i);
  });

  it('requires the exact composite parent constraint and both hierarchy index contracts', () => {
    expect(compactMigration).toContain(
      'add constraint categories_parent_not_self_check check (parent_category_id is null or parent_category_id <> id)',
    );
    expect(compactMigration).toContain(
      'add constraint categories_parent_space_kind_fkey foreign key (parent_category_id, space_id, kind) references public.categories (id, space_id, kind) on delete restrict;',
    );
    expect(compactMigration).toContain(
      'create index categories_parent_fk_idx on public.categories (parent_category_id, space_id, kind) where parent_category_id is not null;',
    );
    expect(compactMigration).toContain(
      'create index categories_active_hierarchy_idx on public.categories (space_id, kind, parent_category_id, created_at, id) where archived_at is null;',
    );
  });

  it('requires the parent trigger, request kind, fixed search path, and exact command ACL statements', () => {
    expect(compactMigration).toContain(
      'create trigger categories_validate_parent_insert before insert on public.categories for each row execute function private.validate_category_parent();',
    );
    expect(compactMigration).toContain(
      "add constraint category_command_requests_command_kind_check check (command_kind in ( 'create_category', 'create_subcategory', 'archive_category' ));",
    );
    expect(compactMigration).toContain(
      'create function public.create_subcategory( p_space_id uuid, p_request_id uuid, p_parent_category_id uuid, p_name_en text, p_name_ar text ) returns table (id uuid) language plpgsql security definer set search_path = pg_catalog, extensions',
    );
    expect(compactMigration).toContain(
      'revoke all on function public.create_subcategory(uuid, uuid, uuid, text, text) from public, anon, service_role;',
    );
    expect(compactMigration).toContain(
      'grant execute on function public.create_subcategory(uuid, uuid, uuid, text, text) to authenticated;',
    );
    expect(compactMigration).toContain(
      'revoke all on function private.validate_category_parent() from public, anon, authenticated, service_role;',
    );
  });
});
