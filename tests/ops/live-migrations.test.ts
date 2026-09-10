import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/ops/apply-live-migrations.sh');
const projectRef = 'bsjqmulybcmlgpmhfrug';
const releaseHead = '41399f6ca54f8d207474313b159af1c9c723ea84';
const liveRunnerCommit = 'b5042865dd88fb4409894e39127b080f766c82df';
const subprocessTimeoutMillis = 10_000;
const defaultProjects = JSON.stringify([{ id: projectRef, name: 'Budget' }]);

function disposeFixture(base: string): void {
  if (dirname(base) !== realpathSync(tmpdir())
    || !/^budget-live-migrations-[A-Za-z0-9]{6}$/.test(basename(base))) {
    throw new Error('refusing to remove an invalid live-migration fixture path');
  }
  const info = lstatSync(base);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(base) !== base) {
    throw new Error('refusing to remove a non-private live-migration fixture directory');
  }
  rmSync(base, { recursive: true, force: false, maxRetries: 0 });
}

function withFixture<T>(
  action: (context: ReturnType<typeof fixture>) => T,
  projectsJson = defaultProjects,
  initialize: typeof fixture = fixture,
): T {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'budget-live-migrations-'));
  try {
    return action(initialize(base, projectsJson));
  } finally {
    disposeFixture(base);
    expect(existsSync(base)).toBe(false);
  }
}

function fixture(base: string, projectsJson: string) {
  const backupRoot = join(base, 'backups');
  const releaseRoot = join(base, 'release');
  const log = join(base, 'supabase-args.log');
  const supabase = join(base, 'supabase');
  const clone = spawnSync(
    'git',
    ['clone', '--quiet', '--no-hardlinks', process.cwd(), releaseRoot],
    { encoding: 'utf8', timeout: subprocessTimeoutMillis, killSignal: 'SIGKILL', maxBuffer: 1_048_576 },
  );
  if (clone.error || clone.status !== 0) {
    throw new Error('failed to create the live-release fixture');
  }
  const checkout = spawnSync(
    'git',
    ['-C', releaseRoot, 'checkout', '--quiet', '-B', 'main', liveRunnerCommit],
    { encoding: 'utf8', timeout: subprocessTimeoutMillis, killSignal: 'SIGKILL', maxBuffer: 1_048_576 },
  );
  if (checkout.error || checkout.status !== 0) {
    throw new Error('failed to checkout the live-release fixture');
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
      SUPABASE_ACCESS_TOKEN: ['fixture', 'access'].join('-'),
      SUPABASE_DB_PASSWORD: ['fixture', 'password'].join('-'),
      TMPDIR: base,
    },
    log,
    script: join(releaseRoot, 'scripts/ops/apply-live-migrations.sh'),
  };
}

function run(
  runnerScript: string,
  env: NodeJS.ProcessEnv,
  confirmation: string,
) {
  return spawnSync('bash', [runnerScript], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    input: `${confirmation}\n`,
    timeout: subprocessTimeoutMillis,
    killSignal: 'SIGKILL',
    maxBuffer: 1_048_576,
  });
}

describe('one-time live Supabase migration runner', () => {
  it('bounds every frozen-fixture subprocess and owns cleanup in finally', () => {
    const source = readFileSync(join(process.cwd(), 'tests/ops/live-migrations.test.ts'), 'utf8');
    const implementation = source.slice(0, source.indexOf("describe('one-time"));
    expect(implementation.match(/timeout: subprocessTimeoutMillis/g) ?? []).toHaveLength(3);
    expect(implementation).toMatch(/finally\s*\{\s*disposeFixture\(base\)/);
    expect(implementation).toContain('rmSync(base, { recursive: true');
  });

  it('cleans partial fixture setup after an initialization failure', () => {
    let observedBase = '';
    expect(() => withFixture(() => { throw new Error('action must not run'); }, defaultProjects, (base) => {
      observedBase = base;
      mkdirSync(join(base, 'release'));
      writeFileSync(join(base, 'release', 'partial-clone'), 'partial fixture');
      throw new Error('controlled partial setup failure');
    })).toThrow('controlled partial setup failure');
    expect(observedBase).not.toBe('');
    expect(existsSync(observedBase)).toBe(false);
  });

  it('cleans the frozen clone after an action failure', () => {
    let observedBase = '';
    expect(() => withFixture(({ base }) => {
      observedBase = base;
      expect(existsSync(join(base, 'release', '.git'))).toBe(true);
      throw new Error('controlled fixture action failure');
    })).toThrow('controlled fixture action failure');
    expect(observedBase).not.toBe('');
    expect(existsSync(observedBase)).toBe(false);
  });

  it('rejects a broad or nonmatching fixture cleanup target', () => {
    expect(() => disposeFixture(realpathSync(tmpdir()))).toThrow('invalid live-migration fixture path');
    expect(() => disposeFixture(join(realpathSync(tmpdir()), 'unrelated-fixture')))
      .toThrow('invalid live-migration fixture path');
  });

  it('pins the exact project and excludes destructive or scope-expanding commands', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain(`readonly LIVE_PROJECT_REF='${projectRef}'`);
    expect(source).toContain(`readonly LIVE_MANIFEST_SOURCE_SHA='${releaseHead}'`);
    expect(source).toContain('db push --linked --dry-run');
    expect(source).not.toMatch(/db reset|migration repair|--include-all|--include-roles|--include-seed/);
    expect(source).not.toContain('SERVICE_ROLE_KEY:?');
  });

  it('verifies the exact 32-row journal and merged schema after application', () => {
    const source = readFileSync(script, 'utf8');
    const verificationSql = source.slice(
      source.indexOf('readonly LIVE_VERIFY_SQL='),
      source.indexOf('\n\nlive_fail()'),
    );

    expect(verificationSql.match(/'20[0-9]{12}'/g)).toHaveLength(32);
    expect(verificationSql).toContain("'20260908170000'");
    expect(verificationSql).toContain("'20260910100000'");
    expect(verificationSql).toContain("to_regclass('public.household_invitations')");
    expect(verificationSql).toContain("to_regclass('public.subcategories')");
  });

  it('refuses an account that cannot see the exact project before database contact', () => {
    withFixture(({ base, env, log, script: fixtureScript }) => {
      expect(fixtureScript.startsWith(`${base}/`)).toBe(true);
      expect(realpathSync(fixtureScript)).not.toBe(realpathSync(script));
      const result = run(fixtureScript, env, `APPLY LIVE MIGRATIONS TO ${projectRef}`);

      expect(result.status).toBe(78);
      expect(result.stderr).toContain('authenticated account cannot access the exact project');
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
        'projects list --output json',
      ]);
    }, JSON.stringify([{ id: 'wrongprojectref00000' }]));
  });

  it('takes private schema and public-data dumps but refuses a wrong confirmation', () => {
    withFixture(({ backupRoot, base, env, log, script: fixtureScript }) => {
      expect(fixtureScript.startsWith(`${base}/`)).toBe(true);
      expect(realpathSync(fixtureScript)).not.toBe(realpathSync(script));
      const result = run(fixtureScript, env, 'APPLY SOMEWHERE ELSE');

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
  });

  it('applies once after exact confirmation and verifies the resulting schema', () => {
    withFixture(({ backupRoot, base, env, log, script: fixtureScript }) => {
      expect(fixtureScript.startsWith(`${base}/`)).toBe(true);
      expect(realpathSync(fixtureScript)).not.toBe(realpathSync(script));
      const result = run(fixtureScript, env, `APPLY LIVE MIGRATIONS TO ${projectRef}`);

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
});
