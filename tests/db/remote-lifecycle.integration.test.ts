import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Budget remote Supabase lifecycle', () => {
  it('reports a Budget-only remote project identifier', () => {
    const output = execFileSync('./scripts/remote-supabase.sh', ['status'], {
      encoding: 'utf8',
      env: { ...process.env, BUDGET_REMOTE_CHECK_ONLY: '1' },
    });

    expect(output).toContain('budget-supabase');
  });

  it('synchronizes the Supabase configuration with the available secure-copy client', () => {
    const script = readFileSync('./scripts/remote-supabase.sh', 'utf8');

    expect(script).toContain('scp -r "${local_dir}" "${remote_host}:${remote_dir}/"');
    expect(script).not.toContain('rsync');
  });

  it('forces Budget containers to stay stopped after a host reboot', () => {
    const script = readFileSync('./scripts/remote-supabase.sh', 'utf8');

    expect(script).toContain('docker update --restart=no');
  });
});
