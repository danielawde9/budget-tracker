import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/ops/apply-live-migrations.sh');
const projectRef = 'bsjqmulybcmlgpmhfrug';

function fixture(projectsJson = JSON.stringify([{ id: projectRef, name: 'Budget' }])) {
  const base = mkdtempSync(
    join(realpathSync(tmpdir()), 'budget-live-migrations-'),
  );
  const backupRoot = join(base, 'backups');
  const gitDirectory = join(base, 'repository.git');
  const log = join(base, 'supabase-args.log');
  const supabase = join(base, 'supabase');
  const currentHead = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (currentHead.status !== 0) {
    throw new Error('failed to resolve the fixture source commit');
  }
  const clone = spawnSync(
    'git',
    ['clone', '--quiet', '--bare', process.cwd(), gitDirectory],
    { encoding: 'utf8' },
  );
  if (clone.status !== 0) {
    throw new Error('failed to create the isolated git fixture');
  }
  const fixtureHead = currentHead.stdout.trim();
  for (const args of [
    ['--git-dir', gitDirectory, 'update-ref', 'refs/heads/main', fixtureHead],
    ['--git-dir', gitDirectory, 'symbolic-ref', 'HEAD', 'refs/heads/main'],
    ['--git-dir', gitDirectory, 'read-tree', 'HEAD'],
  ]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error('failed to prepare the isolated main-branch fixture');
    }
  }
  mkdirSync(backupRoot, { mode: 0o700 });
  writeFileSync(
    supabase,
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${FAKE_SUPABASE_LOG:?required}"
case "\${1:-}:\${2:-}" in
  projects:list)
    printf '%s\\n' "\${FAKE_PROJECTS_JSON:?required}"
    ;;
  db:dump)
    output=''
    previous=''
    for argument in "$@"; do
      if [[ "$previous" == '--file' ]]; then output="$argument"; fi
      previous="$argument"
    done
    [[ -n "$output" ]] || exit 91
    printf '%s\\n' '-- fixture dump --' > "$output"
    ;;
  db:push)
    if [[ " $* " == *' --dry-run '* ]]; then
      printf '%s\\n' 'Dry run complete'
    else
      printf '%s\\n' 'Finished supabase db push'
    fi
    ;;
  db:query)
    printf '%s\\n' 'budget_schema_ready'
    ;;
esac
`,
  );
  chmodSync(supabase, 0o700);
  return {
    backupRoot,
    base,
    env: {
      ...process.env,
      BUDGET_LIVE_BACKUP_ROOT: backupRoot,
      BUDGET_SUPABASE_BIN: supabase,
      FAKE_PROJECTS_JSON: projectsJson,
      FAKE_SUPABASE_LOG: log,
      GIT_DIR: gitDirectory,
      GIT_WORK_TREE: process.cwd(),
      SUPABASE_ACCESS_TOKEN: ['fixture', 'access'].join('-'),
      SUPABASE_DB_PASSWORD: ['fixture', 'password'].join('-'),
      TMPDIR: base,
    },
    log,
  };
}

function run(env: NodeJS.ProcessEnv, confirmation: string) {
  return spawnSync('bash', [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    input: `${confirmation}\n`,
  });
}

describe('one-time live Supabase migration runner', () => {
  it('pins the exact project and excludes destructive or scope-expanding commands', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain(`readonly LIVE_PROJECT_REF='${projectRef}'`);
    expect(source).toContain('db push --linked --dry-run');
    expect(source).not.toMatch(/db reset|migration repair|--include-all|--include-roles|--include-seed/);
    expect(source).not.toContain('SERVICE_ROLE_KEY:?');
  });

  it('refuses an account that cannot see the exact project before database contact', () => {
    const { env, log } = fixture(JSON.stringify([{ id: 'wrongprojectref00000' }]));
    const result = run(env, `APPLY LIVE MIGRATIONS TO ${projectRef}`);

    expect(result.status).toBe(78);
    expect(result.stderr).toContain('authenticated account cannot access the exact project');
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      'projects list --output json',
    ]);
  });

  it('takes private schema and public-data dumps but refuses a wrong confirmation', () => {
    const { backupRoot, base, env, log } = fixture();
    const result = run(env, 'APPLY SOMEWHERE ELSE');

    expect(result.status).toBe(78);
    expect(result.stderr).toContain('confirmation did not match');
    const commandLog = readFileSync(log, 'utf8');
    expect(commandLog).toContain(`link --project-ref ${projectRef}`);
    expect(commandLog).toContain('db dump --linked --schema public --file');
    expect(commandLog).toContain(
      'db dump --linked --schema public --data-only --use-copy --file',
    );
    expect(commandLog).toContain('db push --linked --dry-run');
    expect(commandLog).not.toMatch(/^db push --linked --yes$/m);
    const backupDirectories = readdirSync(backupRoot);
    expect(backupDirectories).toHaveLength(1);
    expect(readdirSync(join(backupRoot, backupDirectories[0]!)).sort()).toEqual([
      'public-data.sql',
      'schema.sql',
    ]);
    expect(
      readdirSync(base).filter((entry) => entry.startsWith('budget-live-migrations.')),
    ).toEqual([]);
  });

  it('applies once after exact confirmation and verifies the resulting schema', () => {
    const { backupRoot, env, log } = fixture();
    const result = run(env, `APPLY LIVE MIGRATIONS TO ${projectRef}`);

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).toContain(`Live Budget migrations verified on ${projectRef}`);
    const commandLog = readFileSync(log, 'utf8');
    expect(commandLog.match(/^db push --linked --dry-run$/gm)).toHaveLength(2);
    expect(commandLog.match(/^db push --linked --yes$/gm)).toHaveLength(1);
    expect(commandLog).toContain('db query --linked --output-format json');
    expect(commandLog).not.toContain(env.SUPABASE_ACCESS_TOKEN);
    expect(commandLog).not.toContain(env.SUPABASE_DB_PASSWORD);
    const backupDirectories = readdirSync(backupRoot);
    expect(backupDirectories).toHaveLength(1);
    expect(existsSync(join(backupRoot, backupDirectories[0]!, 'schema.sql'))).toBe(true);
  });
});
