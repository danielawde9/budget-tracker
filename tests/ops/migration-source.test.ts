import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { migrationFiles } from '../support/disposable-postgres.js';

describe('integration-test migration history', () => {
  it('keeps the historical test journal separate from the production release journal', () => {
    const files = migrationFiles();
    const releaseFiles = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql'));

    expect(files).toHaveLength(65);
    expect(files[0]?.version).toBe('20260907100000');
    expect(files.at(-1)?.version).toBe('20261003121000');
    expect(releaseFiles).toHaveLength(26);
  });
});
