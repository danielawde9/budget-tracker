import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('Budget remote Supabase lifecycle', () => {
  it('reports a Budget-only remote project identifier', () => {
    const output = execFileSync('./scripts/remote-supabase.sh', ['status'], {
      encoding: 'utf8',
      env: { ...process.env, BUDGET_REMOTE_CHECK_ONLY: '1' },
    });

    expect(output).toContain('budget-supabase');
  });
});
