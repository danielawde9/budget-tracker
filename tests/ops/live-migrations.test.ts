import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
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
const projectRef = 'dfuxxzlhmxscgvxdmwti';
const fixtureProjectRef = projectRef;
const releaseHead = '2e278cb6258af1561652847c22ef28aced80e9cc';
const liveRunnerCommit = 'HEAD';
const subprocessTimeoutMillis = 10_000;
const defaultProjects = JSON.stringify([{ id: fixtureProjectRef, name: 'Budget' }]);

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
  // Exercise the working candidate's boundary rather than an obsolete frozen script.
  for (const path of ['scripts/ops/apply-live-migrations.sh', 'scripts/ops/migrate-budget.sh', 'ops/budget-migrations.sha256']) {
    copyFileSync(join(process.cwd(), path), join(releaseRoot, path));
  }
  const seal = spawnSync('git', ['-C', releaseRoot, '-c', 'user.name=Budget test', '-c', 'user.email=budget-test@example.invalid', 'commit', '-am', 'seal local release fixture', '--allow-empty'], {
    encoding: 'utf8', timeout: subprocessTimeoutMillis, killSignal: 'SIGKILL', maxBuffer: 1_048_576,
  });
  if (seal.error || seal.status !== 0) throw new Error('failed to seal release fixture');
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
    expect(implementation.match(/timeout: subprocessTimeoutMillis/g) ?? []).toHaveLength(4);
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

  // Final review M6: the two release pins are separate literals in separate
  // files; a half-updated release passed every test and failed closed only
  // at verify-manifest time. One cross-file assertion ties them together.
  it("ships a manifest whose source_sha is the live script's LIVE_MANIFEST_SOURCE_SHA", () => {
    const manifestSha = /^source_sha=([a-f0-9]{40})$/m
      .exec(readFileSync(join(process.cwd(), 'ops/budget-migrations.sha256'), 'utf8'))?.[1];
    const scriptSha = /^readonly LIVE_MANIFEST_SOURCE_SHA='([a-f0-9]{40})'$/m.exec(readFileSync(script, 'utf8'))?.[1];

    expect(manifestSha).toMatch(/^[a-f0-9]{40}$/);
    expect(scriptSha).toBe(manifestSha);
  });

  it('verifies the exact baseline journal and merged schema after application', () => {
    const source = readFileSync(script, 'utf8');
    const verificationSql = source.slice(
      source.indexOf('readonly LIVE_VERIFY_SQL='),
      source.indexOf('\n\nlive_fail()'),
    );

    expect(verificationSql).toContain("'20260929140000'");
    expect(verificationSql).toContain("'20260929140700'");
    expect(verificationSql).toContain("'20260930100000'");
    expect(verificationSql).toContain("'20260930100100'");
    expect(verificationSql).toContain("'20260930100200'");
    expect(verificationSql).toContain("'20260930100300'");
    expect(verificationSql).toContain("'20260930100400'");
    expect(verificationSql).toContain("'20260930100500'");
    expect(verificationSql).toContain("'20260930100550'");
    expect(verificationSql).toContain("'20260930100600'");
    expect(verificationSql).toContain("'20260930100700'");
    expect(verificationSql).toContain("'20260930100800'");
    expect(verificationSql).toContain("'20260930100900'");
    expect(verificationSql).toContain("'20260930101000'");
    expect(verificationSql).toContain("'20260930101100'");
    expect(verificationSql).toContain("to_regclass('public.workspace_setup_receipts')");
    expect(verificationSql).toContain("oid=to_regclass('public.workspace_setup_receipts') and relrowsecurity");
    for(const role of ['anon','authenticated','service_role'])expect(verificationSql).toContain(`not has_table_privilege('${role}','public.workspace_setup_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`);
    for(const name of ['public.create_onboarding_space(uuid,text,public.space_kind,text,integer)','public.create_onboarding_wallet(uuid,uuid,text,public.currency_code)','public.find_workspace_setup_receipt(uuid,uuid)','public.wallet_balance_as_of(uuid,uuid,date)','public.daily_control_summary(uuid,date,public.currency_code)','public.daily_control_obligations(uuid,date,public.currency_code,integer)','public.purchase_goal(uuid,uuid,jsonb)','public.record_and_settle(uuid,uuid,jsonb)','public.record_settlement_context(uuid,uuid)']) {
      expect(verificationSql).toContain(`to_regprocedure('${name}') is not null`);
      expect(verificationSql).toContain(`has_function_privilege('authenticated','${name}','EXECUTE')`);
      for(const role of ['anon','service_role'])expect(verificationSql).toContain(`not has_function_privilege('${role}','${name}','EXECUTE')`);
    }
    for(const name of ['private.save_period_plan_with_carry(uuid,uuid,date,public.currency_code,jsonb,jsonb)','private.daily_cash_commitments(uuid,public.currency_code,date,date)','private.daily_expense_buckets(uuid,public.currency_code,date,date,date,date)']) {
      expect(verificationSql).toContain(`to_regprocedure('${name}') is not null`);
      expect(verificationSql).toContain(`not has_function_privilege('authenticated','${name}','EXECUTE')`);
    }
    expect(verificationSql).toContain("to_regprocedure('public.preview_default_period_plan(uuid,date,public.currency_code)') is not null");
    expect(verificationSql).toContain("to_regprocedure('public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb)') is not null");
    for(const name of ['public.preview_default_period_plan(uuid,date,public.currency_code)','public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb)']) {
      expect(verificationSql).toContain(`has_function_privilege('authenticated','${name}','EXECUTE')`);
      for(const role of ['anon','service_role'])expect(verificationSql).toContain(`not has_function_privilege('${role}','${name}','EXECUTE')`);
    }
    expect(verificationSql).toContain("not has_function_privilege('authenticated','private.resolve_default_plan_reference(jsonb,jsonb,boolean)','EXECUTE')");
    expect(verificationSql).toContain("to_regprocedure('public.allocation_template_defaults(uuid,public.currency_code)') is not null");
    expect(verificationSql).toContain("has_function_privilege('authenticated','public.allocation_template_defaults(uuid,public.currency_code)','EXECUTE')");
    expect(verificationSql).toContain("not has_function_privilege('anon','public.allocation_template_defaults(uuid,public.currency_code)','EXECUTE')");
    expect(verificationSql).toContain("not has_function_privilege('service_role','public.allocation_template_defaults(uuid,public.currency_code)','EXECUTE')");
    expect(verificationSql).toContain("provolatile='s'");
    expect(verificationSql).toContain("to_regprocedure('public.save_period_plan(uuid,uuid,date,public.currency_code,jsonb)') is not null");
    expect(verificationSql).toContain("to_regprocedure('public.period_plan_legacy_review(uuid,date,public.currency_code)') is not null");
    expect(verificationSql).toContain("to_regprocedure('public.approved_budget_summary(uuid,date,public.currency_code)') is not null");
    expect(verificationSql).toContain("to_regprocedure('public.approved_category_budget_page(uuid,date,public.currency_code,uuid,integer)') is not null");
    expect(verificationSql).toContain("to_regprocedure('public.approved_loan_monthly_plan(uuid,date)') is not null");
    expect(verificationSql).toContain("to_regprocedure('public.approved_loan_monthly_currency_summary(uuid,date)') is not null");
    expect(verificationSql).toContain("to_regclass('private.period_plan_save_evidence') is not null");
    expect(verificationSql).toContain("exists (select 1 from pg_class where oid=to_regclass('private.period_plan_save_evidence') and relrowsecurity)");
    expect(verificationSql).toContain("not has_table_privilege('authenticated','private.period_plan_save_evidence','SELECT,INSERT,UPDATE,DELETE')");
    expect(verificationSql).toContain("not has_function_privilege('authenticated','private.publish_period_plan(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb,boolean,jsonb)','EXECUTE')");
    expect(verificationSql).toContain("exists (select 1 from pg_trigger where tgname='period_plan_save_evidence_valid' and tgenabled in ('O','A') and tgdeferrable and tginitdeferred)");

    expect(verificationSql).toContain("to_regprocedure('public.period_plan_page(uuid,date,public.currency_code)')");
    expect(verificationSql).toContain("to_regclass('public.period_plan_loan_sets')");
    expect(verificationSql).toContain("to_regclass('public.period_plan_loan_lines')");
    expect(verificationSql).toContain("to_regclass('private.loan_target_acceptance_order')");
    expect(verificationSql).toContain("to_regprocedure('private.current_loan_period_targets(uuid,date)')");
    expect(verificationSql).toContain("to_regprocedure('public.loan_period_balances(uuid,date)')");
    expect(verificationSql).toContain("to_regprocedure('public.goal_period_target_page(uuid,date,public.currency_code,uuid,integer)')");
    expect(verificationSql).toContain("to_regclass('public.space_period_definitions')");
    expect(verificationSql).toContain("to_regclass('public.space_schedule_revisions')");
    expect(verificationSql).toContain("to_regprocedure('public.space_period_context(uuid,date)')");
    expect(verificationSql).toContain("to_regprocedure('public.set_space_schedule(uuid,uuid,text,integer,bigint)')");
    expect(verificationSql).toContain("to_regprocedure('public.unlink_scheduled_payment(uuid,uuid,uuid,bigint,text)')");
    expect(verificationSql).toContain("to_regclass('public.scheduled_payment_goal_links')");
    expect(verificationSql.match(/'20[0-9]{12}'/g)).toHaveLength(26);
    expect(verificationSql).toContain("'20261002170000'");
    expect(verificationSql).toContain("'20261002171000'");
    expect(verificationSql).toContain("'20261003120000'");
    expect(verificationSql).toContain("'20261003121000'");
    expect(verificationSql).toContain("to_regprocedure('public.set_goal_state(uuid,uuid,uuid,bigint,text)') is not null");
    expect(verificationSql).toContain("to_regclass('public.household_invitations')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.create_subcategory(uuid,uuid,uuid,text,text)')",
    );
    expect(verificationSql).toContain("to_regprocedure('public.archive_wallet(uuid,uuid,uuid)')");
    expect(verificationSql).toContain("to_regclass('public.monthly_budget_plan_revisions')");
    expect(verificationSql).toContain("to_regclass('public.planning_command_receipts')");
    expect(verificationSql).toContain("to_regclass('public.allocation_month_snapshots')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.publish_allocation_month(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.allocation_month_state(uuid,date,public.currency_code,bigint)')",
    );
    expect(verificationSql).toContain("to_regclass('public.goals')");
    expect(verificationSql).toContain("to_regprocedure('public.save_allocation_group_roles(uuid,uuid,public.currency_code,bigint,uuid,uuid)')");
    expect(verificationSql).toContain("to_regprocedure('public.set_goal_default_group(uuid,uuid,uuid,uuid,bigint)')");
    expect(verificationSql).toContain("to_regprocedure('public.goal_period_target_defaults_page(uuid,date,public.currency_code,uuid,integer)')");
    expect(verificationSql).toContain("to_regprocedure('private.resolve_goal_plan_group(uuid,public.currency_code,uuid,uuid)')");
    expect(verificationSql).toContain("to_regprocedure('private.resolve_debt_plan_group(uuid,public.currency_code,uuid)')");
    expect(verificationSql).toContain("to_regclass('public.allocation_group_role_revisions')");
    expect(verificationSql).toContain("to_regclass('public.goal_default_group_revisions')");
    expect(verificationSql).toContain("to_regclass('public.goal_earmark_events')");
    expect(verificationSql).toContain("to_regclass('public.goal_purchase_links')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.create_goal_plan(uuid,uuid,uuid,jsonb,jsonb)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.record_goal_earmark(uuid,uuid,uuid,text,text,text,boolean)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.link_goal_purchase(uuid,uuid,uuid,jsonb)')",
    );
    expect(verificationSql).toContain("to_regclass('public.allocation_month_goal_lines')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.goal_page(uuid,public.currency_code,text,timestamptz,uuid,integer)')",
    );
    expect(verificationSql).toContain("to_regprocedure('public.goal_detail(uuid,uuid,date)')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.publish_allocation_month_v2(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb)')",
    );
    expect(verificationSql).toContain("to_regclass('public.schedules')");
    expect(verificationSql).toContain("to_regclass('public.scheduled_occurrences')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.save_schedule(uuid,uuid,uuid,bigint,jsonb)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.confirm_scheduled_occurrence(uuid,uuid,uuid,bigint,text,date,uuid)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.scheduled_occurrence_page(uuid,date,date,date,uuid,integer)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.available_cash_summary(uuid,public.currency_code,date)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.cash_outlook(uuid,public.currency_code,date,integer,text)')",
    );
    expect(verificationSql).toContain("to_regclass('public.budget_month_closes')");
    expect(verificationSql).toContain("to_regclass('public.budget_month_carry_links')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.close_budget_month(uuid,uuid,public.currency_code,date,bigint,text)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.copy_allocation_month(uuid,uuid,public.currency_code,bigint,date,bigint,text)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.set_rollover_policy(uuid,uuid,public.currency_code,uuid,boolean,bigint)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.journal_search_page(uuid,date,date,uuid,uuid,uuid,bigint,bigint,text,text,integer)')",
    );
    // Final review M6: the trigger must exist AND be enabled for normal
    // (origin) sessions -- 'D' is disabled, and 'R' fires only for replicas.
    expect(verificationSql).toContain(
      "exists (select 1 from pg_trigger where tgname = 'financial_events_reversal_date_guard' and tgenabled in ('O', 'A'))",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.allocation_template_head(uuid,public.currency_code)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.monthly_budget_category_page_v3(uuid,date,public.currency_code,text,uuid,integer)')",
    );
    expect(verificationSql).toContain(
      "to_regprocedure('public.scheduled_overdue_page(uuid,date,uuid,integer)')",
    );
    expect(verificationSql).toContain(
      "n.nspname = 'private' and p.proname = 'check_goal_earmark_event' and p.prosrc like '%goal_financing_state%'",
    );
    expect(verificationSql).not.toContain("to_regclass('public.subcategories')");
  });

  it('refuses an account that cannot see the exact project before database contact', () => {
    withFixture(({ base, env, log, script: fixtureScript }) => {
      expect(fixtureScript.startsWith(`${base}/`)).toBe(true);
      expect(realpathSync(fixtureScript)).not.toBe(realpathSync(script));
      const result = run(fixtureScript, env, `APPLY LIVE MIGRATIONS TO ${fixtureProjectRef}`);

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
      expect(commandLog).toContain(`link --project-ref ${fixtureProjectRef}`);
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
      const result = run(fixtureScript, env, `APPLY LIVE MIGRATIONS TO ${fixtureProjectRef}`);

      expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
      expect(result.stdout).toContain(`Live Budget migrations verified on ${fixtureProjectRef}`);
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
