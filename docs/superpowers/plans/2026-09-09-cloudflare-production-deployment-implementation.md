# Cloudflare Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the reviewed Budget release candidate as a reproducible Cloudflare Workers Static Assets deployment using pinned repository tooling and fail-closed build-variable validation.

**Architecture:** Keep the existing Vite build authoritative and deploy `dist/` as an assets-only Worker with SPA fallback handling. Add a small environment-contract module and CLI, pin Wrangler `4.130.0`, explicitly approve only its reviewed `workerd` build, then verify packaging before any external deployment.

**Tech Stack:** Node.js 22.22.0, pnpm 11.17.0, TypeScript 7.0.2, Vite 7.1.7, Vitest 5.0.0, Wrangler 4.130.0, workerd 1.20260908.1, Cloudflare Workers Static Assets

**Spec:** `docs/superpowers/specs/2026-09-09-cloudflare-production-deployment-design.md`

## Global Constraints

- Start from release candidate `6af62c1b0105b75a9796cfb299791f4c26a7dd2e` and do not merge the unfinished exact-schema UAT branch.
- Use Cloudflare Workers Static Assets without a Worker handler and without `@cloudflare/vite-plugin`.
- Pin Wrangler exactly to `4.130.0`; never invoke `npx wrangler`.
- Keep `strictDepBuilds` fail-closed and add only `workerd: true` beside the existing `esbuild: true` approval.
- The committed configuration contains no Supabase value, Cloudflare account identifier, API token, custom domain, or environment-specific route.
- Production build variables are exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Never print environment-variable values during validation or failure handling.
- The first external target is the account's `workers.dev` hostname; custom-domain routing remains a separate DNS action.
- A public deployment remains beta-only for synthetic or replaceable data until an encrypted off-site restore succeeds.

---

### Task 1: Fail-closed Cloudflare build-variable contract

**Files:**
- Create: `scripts/cloudflare/build-environment.mjs`
- Create: `scripts/cloudflare/build-environment.d.mts`
- Create: `scripts/cloudflare/check-build-environment.mjs`
- Create: `tests/ops/cloudflare-build-environment.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`-shaped string map containing Vite build variables.
- Produces: `validateCloudflareBuildEnvironment(environment): { supabaseUrl: string; anonKey: string }` and a CLI that exits nonzero with variable names only.

- [ ] **Step 1: Write failing unit and CLI tests**

Create `tests/ops/cloudflare-build-environment.test.ts` with these cases:

```ts
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateCloudflareBuildEnvironment } from '../../scripts/cloudflare/build-environment.mjs';

const valid = {
  VITE_SUPABASE_URL: 'https://budget-project.supabase.co',
  VITE_SUPABASE_ANON_KEY: `sb_publishable_${'a'.repeat(32)}`,
};

describe('Cloudflare build environment', () => {
  it.each([
    [{}, 'VITE_SUPABASE_URL'],
    [{ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL }, 'VITE_SUPABASE_ANON_KEY'],
    [{ VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_ANON_KEY }, 'VITE_SUPABASE_ANON_KEY'],
    [{ ...valid, VITE_SUPABASE_URL: 'http://budget-project.supabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'replace-with-url' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_ANON_KEY: 'replace-with-key' }, 'VITE_SUPABASE_ANON_KEY'],
  ])('rejects invalid input without returning values', (environment, expectedName) => {
    expect(() => validateCloudflareBuildEnvironment(environment)).toThrow(expectedName);
  });

  it('returns the validated public build contract', () => {
    expect(validateCloudflareBuildEnvironment(valid)).toEqual({
      supabaseUrl: valid.VITE_SUPABASE_URL,
      anonKey: valid.VITE_SUPABASE_ANON_KEY,
    });
  });

  it('does not print supplied values when the CLI rejects input', () => {
    const secretShapedValue = 'sb_publishable_DO_NOT_PRINT_THIS_VALUE_123456';
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/cloudflare/check-build-environment.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_SUPABASE_URL: 'http://invalid.example',
          VITE_SUPABASE_ANON_KEY: secretShapedValue,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VITE_SUPABASE_URL');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretShapedValue);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `pnpm exec vitest run tests/ops/cloudflare-build-environment.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL because `scripts/cloudflare/build-environment.mjs` does not exist.

- [ ] **Step 3: Implement the boundary module**

Create `scripts/cloudflare/build-environment.mjs`:

```js
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value || /^replace-/i.test(value)) {
    throw new Error(`${name} is required for the Cloudflare production build`);
  }
  return value;
}

export function validateCloudflareBuildEnvironment(environment) {
  const supabaseUrl = required(environment, 'VITE_SUPABASE_URL');
  const anonKey = required(environment, 'VITE_SUPABASE_ANON_KEY');

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('VITE_SUPABASE_URL must be a credential-free HTTPS URL');
  }
  if (!PUBLISHABLE_KEY.test(anonKey)) {
    throw new Error('VITE_SUPABASE_ANON_KEY must contain the browser publishable key');
  }

  return { supabaseUrl, anonKey };
}
```

Create `scripts/cloudflare/check-build-environment.mjs`:

```js
import { validateCloudflareBuildEnvironment } from './build-environment.mjs';

try {
  validateCloudflareBuildEnvironment(process.env);
  process.stdout.write('Cloudflare public build-variable contract passed\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Cloudflare build-variable validation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
```

Create `scripts/cloudflare/build-environment.d.mts` so the strict TypeScript
suite can import the JavaScript boundary without an implicit `any`:

```ts
export type CloudflareBuildEnvironment = Readonly<{
  supabaseUrl: string;
  anonKey: string;
}>;

export function validateCloudflareBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): CloudflareBuildEnvironment;
```

- [ ] **Step 4: Add the validation and build scripts**

Add these exact `package.json` scripts without changing the existing `build` command:

```json
"check:cloudflare-env": "node scripts/cloudflare/check-build-environment.mjs",
"build:cloudflare": "pnpm check:cloudflare-env && pnpm build"
```

- [ ] **Step 5: Run focused verification**

Run: `pnpm exec vitest run tests/ops/cloudflare-build-environment.test.ts --pool=forks --no-file-parallelism`

Expected: PASS with four validation groups and no supplied value in output.

Run with only safe fixtures:

```bash
VITE_SUPABASE_URL=https://budget-project.supabase.co \
VITE_SUPABASE_ANON_KEY=sb_publishable_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
pnpm check:cloudflare-env
```

Expected: `Cloudflare public build-variable contract passed`.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json scripts/cloudflare/build-environment.mjs scripts/cloudflare/build-environment.d.mts scripts/cloudflare/check-build-environment.mjs tests/ops/cloudflare-build-environment.test.ts
git commit -m "feat(deploy): validate Cloudflare build environment"
```

### Task 2: Pinned Wrangler static-assets deployment

**Files:**
- Create: `wrangler.jsonc`
- Create: `tests/ops/cloudflare-deployment-contract.test.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `dist/` from `pnpm build:cloudflare` and the locally installed Wrangler schema.
- Produces: `deploy:cloudflare:dry-run` and `deploy:cloudflare` scripts for the assets-only `budget-tracker` Worker.

- [ ] **Step 1: Record the resolved dependency evidence before approval**

Run:

```bash
pnpm view wrangler@4.130.0 dependencies optionalDependencies engines --json
pnpm view workerd@1.20260908.1 scripts dist.integrity repository --json
```

Expected: Wrangler resolves `workerd` to `1.20260908.1`, supports Node 22, and the exact package metadata is available for review. Do not approve a different resolved workerd version without updating the plan and reviewing it.

- [ ] **Step 2: Write the failing deployment-contract test**

Create `tests/ops/cloudflare-deployment-contract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Cloudflare deployment contract', () => {
  it('uses a pinned local Wrangler and explicit repository scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.devDependencies.wrangler).toBe('4.130.0');
    expect(packageJson.scripts['deploy:cloudflare:dry-run']).toBe(
      'pnpm exec wrangler deploy --dry-run',
    );
    expect(packageJson.scripts['deploy:cloudflare']).toBe('pnpm exec wrangler deploy');
    expect(JSON.stringify(packageJson)).not.toContain('npx wrangler');
  });

  it('serves only the Vite build with SPA fallback handling', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'));

    expect(config).toEqual({
      $schema: './node_modules/wrangler/config-schema.json',
      name: 'budget-tracker',
      compatibility_date: '2026-09-09',
      assets: {
        directory: './dist',
        not_found_handling: 'single-page-application',
      },
    });
    expect(config).not.toHaveProperty('main');
    expect(config).not.toHaveProperty('routes');
    expect(config).not.toHaveProperty('vars');
  });

  it('approves only the reviewed native deployment dependency', () => {
    const workspace = readFileSync(join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');

    expect(workspace).toMatch(/allowBuilds:\n  esbuild: true\n  workerd: true/);
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds');
  });
});
```

- [ ] **Step 3: Run the focused test and verify the red state**

Run: `pnpm exec vitest run tests/ops/cloudflare-deployment-contract.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL because Wrangler, the scripts, the approval, and `wrangler.jsonc` are absent.

- [ ] **Step 4: Approve the reviewed workerd build and install pinned Wrangler**

Add this exact entry beneath `esbuild: true` in `pnpm-workspace.yaml`:

```yaml
  workerd: true
```

Then run:

```bash
pnpm add --save-dev --save-exact wrangler@4.130.0
```

Expected: install succeeds without `ERR_PNPM_IGNORED_BUILDS`; `package.json` and `pnpm-lock.yaml` record exact Wrangler/workerd versions.

- [ ] **Step 5: Add the assets-only Wrangler configuration**

Create `wrangler.jsonc` as valid JSONC/JSON:

```json
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "budget-tracker",
  "compatibility_date": "2026-09-09",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

Validate the installed version and schema:

```bash
pnpm exec wrangler --version
node -e 'JSON.parse(require("node:fs").readFileSync("wrangler.jsonc", "utf8")); console.log("wrangler config JSON passed")'
```

Expected: Wrangler `4.130.0` and `wrangler config JSON passed`.

- [ ] **Step 6: Add local deployment scripts**

Add these exact `package.json` scripts:

```json
"deploy:cloudflare:dry-run": "pnpm exec wrangler deploy --dry-run",
"deploy:cloudflare": "pnpm exec wrangler deploy"
```

- [ ] **Step 7: Run focused and packaging verification**

Run:

```bash
pnpm exec vitest run tests/ops/cloudflare-build-environment.test.ts tests/ops/cloudflare-deployment-contract.test.ts --pool=forks --no-file-parallelism
pnpm install --frozen-lockfile
VITE_SUPABASE_URL=https://budget-project.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa pnpm build:cloudflare
pnpm deploy:cloudflare:dry-run
```

Expected: focused tests pass, frozen install reports no ignored builds, Vite creates `dist/`, and Wrangler dry-run reports a successful assets package without publishing.

- [ ] **Step 8: Commit Task 2**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml wrangler.jsonc tests/ops/cloudflare-deployment-contract.test.ts
git commit -m "feat(deploy): add pinned Cloudflare static deployment"
```

### Task 3: Operator documentation and full release verification

**Files:**
- Create: `docs/operations/cloudflare-deployment.md`
- Modify: `README.md`
- Modify: `tests/ops/cloudflare-deployment-contract.test.ts`

**Interfaces:**
- Consumes: the scripts and config from Tasks 1-2.
- Produces: a maintainer-facing Cloudflare build/deploy runbook with explicit public-beta boundaries and post-deploy checks.

- [ ] **Step 1: Extend the contract test with documentation ratchets**

Add a test that reads `README.md` and `docs/operations/cloudflare-deployment.md` and asserts all of these literal contracts exist:

```ts
expect(readme).toContain('pnpm build:cloudflare');
expect(runbook).toContain('VITE_SUPABASE_URL');
expect(runbook).toContain('VITE_SUPABASE_ANON_KEY');
expect(runbook).toContain('pnpm deploy:cloudflare:dry-run');
expect(runbook).toContain('pnpm deploy:cloudflare');
expect(runbook).toContain('main');
expect(runbook).toContain('synthetic or replaceable data');
expect(runbook).not.toContain('VITE_SUPABASE_PUBLISHABLE_KEY=');
expect(runbook).not.toContain('npx wrangler');
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `pnpm exec vitest run tests/ops/cloudflare-deployment-contract.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL because the runbook does not exist and README lacks the deployment command.

- [ ] **Step 3: Write the deployment runbook and README entry**

Document:

- Node/pnpm versions and frozen installation;
- Cloudflare production branch `main`;
- build command `pnpm build:cloudflare`;
- deploy command `pnpm deploy:cloudflare`;
- dry run `pnpm deploy:cloudflare:dry-run`;
- the two exact build-variable names, entered only through protected CI/dashboard settings;
- why the Supabase publishable key is browser-visible and why service-role keys remain forbidden;
- workers.dev first deployment and owner-gated custom-domain routing;
- synthetic-account session/RLS smoke verification;
- rollback through a previously verified Cloudflare version;
- the public-beta and recovery-evidence limitations.

Do not include values, account IDs, customer data, or host credentials.

- [ ] **Step 4: Run full local verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm check:uat:offline
VITE_SUPABASE_URL=https://budget-project.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa pnpm build:cloudflare
pnpm deploy:cloudflare:dry-run
git diff --check
git status --short
```

Expected: 152 operations tests plus the new deployment tests pass, 273 UI tests pass, production build passes, Playwright reports 37 passed and 35 intentional project skips, Wrangler dry-run succeeds, and only scoped deployment/documentation changes remain.

- [ ] **Step 5: Verify local SPA routing through Wrangler**

Start `pnpm exec wrangler dev --port 8787` in a bounded terminal session. Probe `/`, one built asset, and `/wallets/deep-link` with `Sec-Fetch-Mode: navigate`; each navigation must return the intended application shell while a nonexistent asset request must not be mistaken for JavaScript. Stop the server after the probes.

Expected: root and deep navigation return `200` with HTML; the built asset returns its correct content type; the missing non-navigation asset does not return an executable JavaScript body.

- [ ] **Step 6: Commit Task 3**

```bash
git add README.md docs/operations/cloudflare-deployment.md tests/ops/cloudflare-deployment-contract.test.ts
git commit -m "docs(deploy): add Cloudflare release runbook"
```

### Task 4: Review, integrate, deploy, and prove the public origin

**Files:**
- Review: every file changed from `6af62c1b0105b75a9796cfb299791f4c26a7dd2e`
- Update only if evidence requires it: `docs/operations/cloudflare-deployment.md`

**Interfaces:**
- Consumes: the green deployment branch and Cloudflare authentication for Daniel's intended account.
- Produces: a fast-forwarded `main`, a public workers.dev release, and a redacted deployment receipt tied to one commit.

- [ ] **Step 1: Review exact scope and secrets before external mutation**

Run:

```bash
git diff --stat 6af62c1b0105b75a9796cfb299791f4c26a7dd2e..HEAD
git diff --check 6af62c1b0105b75a9796cfb299791f4c26a7dd2e..HEAD
git log --oneline 6af62c1b0105b75a9796cfb299791f4c26a7dd2e..HEAD
bash scripts/ops/check-budget.sh
pnpm exec wrangler whoami
```

Expected: only deployment/configuration/documentation files changed, the secret scan passes, and Wrangler identifies exactly one intended Cloudflare account. If authentication is missing or multiple accounts are ambiguous, stop for Daniel rather than guessing.

- [ ] **Step 2: Perform independent review**

Review the branch for release-boundary drift, unsafe dependency-build approvals, environment-value leakage, incorrect SPA routing, accidental Worker code, account/domain assumptions, and commands that bypass the pinned package manager. Resolve every validated finding with its own red test and commit, then rerun Task 3 verification.

- [ ] **Step 3: Configure the connected Workers Build**

Before the push, inspect the connected Worker's **Settings > Build** contract.
Set the production branch to `main`, root directory to `/`, build command to
`pnpm build:cloudflare`, and deploy command to `pnpm deploy:cloudflare`. Confirm
that the production trigger contains build variables named
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; replace the currently
misnamed `VITE_SUPABASE_PUBLISHABLE_KEY` entry without exposing its value.

If the Cloudflare dashboard is not authenticated in the selected browser, stop
and ask Daniel to sign in. Do not infer the account or create a second Worker.

- [ ] **Step 4: Fast-forward local main without touching unrelated untracked files**

Before changing the main checkout, confirm it still has no tracked modifications and `main` still equals the expected ancestor. Then run:

```bash
git -C /Users/daniel/Desktop/Daniel/budget-tracking merge --ff-only codex/cloudflare-production-deployment
```

Expected: local `main` fast-forwards; existing unrelated untracked files remain unchanged.

- [ ] **Step 5: Push the reviewed main commit**

Run:

```bash
git -C /Users/daniel/Desktop/Daniel/budget-tracking push origin main
```

Expected: `origin/main` advances to the exact reviewed commit. If Cloudflare's connected build starts automatically, observe it but do not call it successful until the published commit is confirmed.

- [ ] **Step 6: Build with protected values and deploy once**

Load the intended values from the ignored local environment without printing
them, map the current `VITE_SUPABASE_PUBLISHABLE_KEY` value to the required
`VITE_SUPABASE_ANON_KEY` only for this process when necessary, and run:

```bash
set -a
source ./.env.local
set +a
if [[ -z "${VITE_SUPABASE_ANON_KEY:-}" && -n "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" ]]; then
  export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY}"
fi
pnpm build:cloudflare
unset VITE_SUPABASE_ANON_KEY VITE_SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_URL
```

If the push started the connected Workers Build, wait for that one build and do
not run a second deployment. If no connected build started, run
`pnpm deploy:cloudflare` once after the local build. Expected: exactly one path
publishes a new version and reports its workers.dev HTTPS origin. Do not add a
custom route or domain during this operation.

- [ ] **Step 7: Verify the deployed commit and browser boundary**

Verify the public origin with bounded requests and an actual browser:

- `/` and an SPA deep link return the intended release over HTTPS;
- the visible build is the release containing Wallets, Loans, and Categories;
- a synthetic account can authenticate and read only its RLS-visible space;
- sign-out clears the authenticated shell;
- no service-role-shaped credential occurs in downloaded JavaScript;
- Cloudflare reports the deployed version created from the reviewed commit.

If any check fails, report the public deployment as failed or rolled back rather than partially live.

- [ ] **Step 8: Report the exact remaining launch limitations**

Report the public URL, deployed git commit, successful checks, and these explicit gaps: exact-schema UAT waived, novice usability audit waived, physical-device testing waived, custom domain not attached, off-site backup not configured, and restore not proven. Do not approve irreplaceable financial data entry.
