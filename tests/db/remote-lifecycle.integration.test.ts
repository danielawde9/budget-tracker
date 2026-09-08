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

  it('targets the isolated Budget directory on the reachable Le Labo Ubuntu host', () => {
    const script = readFileSync('./scripts/remote-supabase.sh', 'utf8');

    expect(script).toContain("readonly remote_host='lelabo@100.76.160.91'");
    expect(script).toContain("readonly remote_dir='/home/lelabo/budget-supabase'");
    expect(script).toContain("readonly remote_supabase='/home/lelabo/.local/bin/supabase'");
    expect(script).not.toContain('daniel@100.124.228.75');
  });

  it('publishes the Budget API endpoint on the new Tailscale host', () => {
    const config = readFileSync('./supabase/config.toml', 'utf8');
    const exampleEnvironment = readFileSync('./.env.example', 'utf8');

    expect(config).toContain('api_url = "http://100.76.160.91:54421"');
    expect(exampleEnvironment).toContain('VITE_SUPABASE_URL=http://100.76.160.91:54421');
    expect(config).not.toContain('100.124.228.75');
    expect(exampleEnvironment).not.toContain('100.124.228.75');
  });

  it('ships persistent Docker ingress rules for the Budget port range', () => {
    const firewall = readFileSync(
      './ops/ubuntu/budget-tailnet-firewall.sh',
      'utf8',
    );
    const service = readFileSync(
      './ops/ubuntu/budget-tailnet-firewall.service',
      'utf8',
    );

    expect(firewall).toContain('54420:54429');
    expect(firewall).toContain('100.64.0.0/10');
    expect(firewall).toContain('fd7a:115c:a1e0::/48');
    expect(firewall).toContain('--ctstate NEW');
    expect(firewall).toContain('! -i tailscale0');
    expect(service).toContain('After=docker.service tailscaled.service');
    expect(service).toContain('ExecStart=/usr/local/sbin/budget-tailnet-firewall');
  });

  it('forces Budget containers to stay stopped after a host reboot', () => {
    const script = readFileSync('./scripts/remote-supabase.sh', 'utf8');

    expect(script).toContain('docker update --restart=no');
    expect(script).toContain(
      "systemctl is-active --quiet '${firewall_service}'",
    );
    expect(script).toMatch(/start\)[\s\S]*?ensure_tailnet_firewall[\s\S]*?sync_project/);
    expect(script).toMatch(/reset\)[\s\S]*?ensure_tailnet_firewall[\s\S]*?sync_project/);
    expect(script).toMatch(
      /reset\)[\s\S]*?'\$\{remote_supabase\}' db reset"\n\s+disable_restart_policy/,
    );
  });
});
