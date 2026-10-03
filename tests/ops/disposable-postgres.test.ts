import { describe, expect, it } from 'vitest';

import { validateTestDatabaseUrl } from '../support/disposable-postgres.js';

describe('disposable PostgreSQL target validation', () => {
  it('accepts the documented dedicated Budget dev database', () => {
    expect(validateTestDatabaseUrl('postgresql://tester:secret@100.76.160.91:54422/postgres'))
      .toBe('postgresql://tester:secret@100.76.160.91:54422/postgres');
  });

  it('continues to accept an explicit local disposable PostgreSQL URL', () => {
    expect(validateTestDatabaseUrl('postgresql://tester:secret@127.0.0.1:5432/postgres'))
      .toBe('postgresql://tester:secret@127.0.0.1:5432/postgres');
  });

  it('rejects any other remote PostgreSQL target', () => {
    expect(() => validateTestDatabaseUrl('postgresql://tester:secret@example.com:5432/postgres'))
      .toThrow();
  });

  it('rejects the dedicated host on any port other than its test port', () => {
    expect(() => validateTestDatabaseUrl('postgresql://tester:secret@100.76.160.91:5432/postgres'))
      .toThrow();
  });
});
