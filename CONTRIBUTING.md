# Contributing to Open Budget Tracker

Thank you for helping improve [Open Budget Tracker](https://openbudgetracker.app).
Code, Arabic translations, documentation, accessibility improvements, and
practical usability feedback are welcome. The project uses the MIT license.

## Report a problem or propose an idea

Search the [existing issues](https://github.com/danielawde9/budget-tracker/issues)
first. For a bug, include the steps to reproduce it, expected and actual results,
browser, screen size, and language. For an idea, explain the problem it solves
with a concrete example. Discuss substantial changes before implementing them.

Use synthetic data. Remove names, emails, balances, and other personal details
from screenshots and reports. Never include credentials or environment files.

## Run the local preview

Use Node 22, pnpm 11, Docker, and the Supabase CLI. Fork and clone the repository,
then run:

```bash
pnpm install
pnpm preview:up
pnpm demo
```

Open http://127.0.0.1:5173 and choose a demo account. Follow the
[local preview runbook](docs/operations/local-preview.md) for setup details.
Use the local stack for development rather than a hosted account.

Public articles can also be previewed with `pnpm dev` without a backend. For
example, open http://127.0.0.1:5173/about or http://127.0.0.1:5173/ar/about.

## Make a focused change

- Follow [the design guidelines](docs/design-guidelines.md) for UI work. Ship
  English and Arabic copy together, reuse shared styles, and check RTL layouts.
- Keep monetary values in the existing exact minor-unit representation. Respect
  the separation between wallet money, plan assignments, and net worth.
- Add meaningful regression coverage for behavior changes. Use demonstration
  records for reproduction and screenshots.
- Keep public article copy in `src/public-site/content.ts`. Navigation and site
  URLs live in `src/public-site/site.ts`; the build generates the public HTML
  and sitemap from those sources.

## Verify and open a pull request

Run the checks relevant to your change and report their results:

```bash
pnpm typecheck
pnpm test:ui
pnpm build
```

Database changes also require `pnpm test:db` (Docker). User-flow changes need
the affected `pnpm test:e2e` cases against the local preview stack. The
[README](README.md) lists the full verification commands.

Open a pull request against `main`. Explain the problem, resulting behavior,
linked issue, and checks you ran. For visual changes, include screenshots in
both languages at desktop and mobile widths. State any checks you could not
run and why.
