# Budget Tracker - Claude Code Instructions

## Skill to reach for here

`modern-web-guidance` is installed **globally** (`~/.claude/skills/modern-web-guidance`), so it is
live in every repo on this machine, but this is a good target for it: the app is a real bilingual
(EN/AR, RTL) React frontend on Vite, deployed to Cloudflare Workers. It self-triggers on
HTML/CSS/clientside-JS work — modals/dialogs, scroll-driven animations, CWV (LCP/INP), forms,
container queries, `:has()` — before ad-hoc/obsolete patterns get written. No setup needed beyond
doing the frontend work in `src/features/` and `src/lib/`; it does not fire on the Postgres/Supabase
or Cloudflare Worker backend halves of this repo.

## UI design rules

All frontend work must follow `docs/design-guidelines.md` — the canonical
Control Room patterns (`cr-*` classes in `src/control-room.css`). New visual
styles are never added per feature; extend the shared `cr-*` set and record it
in the guidelines in the same change.

## Owner release waiver (2026-10-12)

Daniel has instructed: “skip github action in all”. Unavailable or billing-blocked
GitHub Actions are waived as a release prerequisite. Do not request another
Actions exception. Report Actions as **waived**, never passed.

Fresh local tests, repository gates, browser/DB acceptance, and applicable hosted
verification remain required. This waiver does not authorize disabling workflows,
changing branch protection, bypassing actual failures, or expanding production
permissions. Carry it into future handoffs and continuation chats. See
`docs/operations/2026-10-12-owner-release-waiver.md` for the scope and current work
handoff.
