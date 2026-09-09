# Cloudflare production deployment design

## Status and authorization

Daniel authorized moving toward a public launch without waiting for the isolated
exact-schema UAT environment or the first-time-user browser audit. This design
records that waiver and defines the smallest reproducible Cloudflare deployment
layer for the existing React/Vite single-page application.

The waiver does not turn offline fixtures or development-stack testing into
production proof. Public availability and permission to enter irreplaceable
financial records remain separate claims. Until an encrypted off-site backup has
been restored successfully, the public deployment is a beta suitable for
synthetic or replaceable data only.

## Current release boundary

The deployment work starts from release candidate
`6af62c1b0105b75a9796cfb299791f4c26a7dd2e`. The unfinished
`codex/budget-uat-18-infrastructure` branch remains separate. No deployment
change may import its unverified remote-state claims.

The release already builds a static application into `dist/`. It has no server
runtime, Cloudflare binding, or Worker handler. Browser data access continues to
use Supabase Auth and PostgREST through the existing typed gateways and RLS.

## Chosen approach

Use Cloudflare Workers Static Assets without a Worker script and without the
Cloudflare Vite plugin.

The repository will pin Wrangler as a development dependency. A committed
`wrangler.jsonc` will name the Worker, declare the current compatibility date,
serve `./dist`, and use `single-page-application` fallback handling. The
existing Vite build remains authoritative.

This is preferred over adding the Cloudflare Vite plugin because the application
does not need Worker-side code or bindings. It adds fewer dependencies, does not
change local Vite behavior, and leaves Supabase access in the browser exactly as
reviewed. A Pages deployment is not selected because the requested target is
Cloudflare Workers.

## Dependency and build-script policy

- Add an exact Wrangler version to `devDependencies`; do not use a range.
- Commit the updated `pnpm-lock.yaml`.
- Keep the existing `allowBuilds.esbuild: true` approval.
- Add only the exact required `workerd: true` approval after inspecting the
  resolved Wrangler dependency graph.
- Do not enable `dangerouslyAllowAllBuilds` or weaken `strictDepBuilds`.
- CI and operator commands use the repository-local binary through
  `pnpm exec wrangler`; `npx wrangler` is prohibited.

## Configuration contract

`wrangler.jsonc` will contain only repository-safe configuration:

- a stable Worker name;
- `$schema` pointing at the installed Wrangler schema;
- compatibility date `2026-09-09`;
- `assets.directory` set to `./dist`;
- `assets.not_found_handling` set to `single-page-application`.

The first deployment will use the account's `workers.dev` hostname. A custom
domain or route is a separate, explicit DNS change and will not be guessed or
committed before Daniel identifies the target hostname.

No Supabase key, account identifier, API token, domain, or environment-specific
route belongs in the committed Wrangler configuration.

## Build-variable contract

The production build requires exactly:

- `VITE_SUPABASE_URL` containing the intended HTTPS Supabase project URL;
- `VITE_SUPABASE_ANON_KEY` containing the project's browser-safe publishable
  key, including the current `sb_publishable_...` form.

`VITE_SUPABASE_PUBLISHABLE_KEY` is not read by the application and must not be
accepted as a substitute. A deployment preflight will check names, presence,
placeholder values, HTTPS, and the publishable-key shape without printing either
value.

These values are compiled into the public browser bundle and therefore are not
server secrets. Service-role, database, Cloudflare API, and SSH credentials must
never use a `VITE_` prefix or enter the bundle.

## Scripts and CI contract

Add repository scripts with one job each:

- validate Cloudflare build variables without printing values;
- build the existing production bundle after that validation;
- package a Wrangler dry run through the local pinned binary;
- deploy the already-built bundle through the local pinned binary.

Cloudflare Git integration must use `main` as its production branch. Its build
step runs the repository's Cloudflare build script and its deploy step runs the
repository's Cloudflare deploy script. Dependency installation uses the frozen
lockfile and the repository-pinned pnpm version.

## Failure behavior

- Missing or malformed build variables fail before Vite starts.
- Missing `dist/` or invalid Wrangler configuration fails the dry run.
- A build or dry-run failure prevents deployment.
- Deployment authentication or account ambiguity stops without creating or
  modifying routes.
- A failed deployment is reported as not deployed; a successful build alone is
  never described as live.
- No automatic retry may download a different Wrangler version.

## Verification

Before merge:

1. `pnpm install --frozen-lockfile` succeeds with no ignored dependency builds.
2. Unit tests cover missing, misnamed, placeholder, non-HTTPS, and valid build
   variables without exposing their values.
3. The full repository offline gate remains green.
4. The Cloudflare build script creates `dist/` from the intended release.
5. `pnpm exec wrangler deploy --dry-run` succeeds against the committed config.
6. A local static-assets preview proves `/`, a nonexistent asset, and an SPA
   deep link behave as intended.
7. A bounded secret scan finds no credential or environment value in tracked
   deployment files.
8. An independent review finds no release-boundary, supply-chain, secret, or
   routing defect.

After merge and before calling the application live:

1. `origin/main` resolves to the reviewed deployment commit.
2. Cloudflare reports a successful deployment for that exact commit.
3. The public HTTPS origin loads the intended release and an SPA deep link.
4. The browser can establish a Supabase session and RLS-visible read using a
   synthetic account.
5. No service-role credential appears in the built JavaScript or Cloudflare
   configuration.

The waived exact-schema UAT, first-time-user comprehension audit, physical-device
coverage, configured off-site backup, and measured restore remain explicitly
unproven after deployment.
