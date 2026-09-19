# Budget Tracker - Claude Code Instructions

## Skill to reach for here

`modern-web-guidance` is installed **globally** (`~/.claude/skills/modern-web-guidance`), so it is
live in every repo on this machine, but this is a good target for it: the app is a real bilingual
(EN/AR, RTL) React frontend on Vite, deployed to Cloudflare Workers. It self-triggers on
HTML/CSS/clientside-JS work — modals/dialogs, scroll-driven animations, CWV (LCP/INP), forms,
container queries, `:has()` — before ad-hoc/obsolete patterns get written. No setup needed beyond
doing the frontend work in `src/features/` and `src/lib/`; it does not fire on the Postgres/Supabase
or Cloudflare Worker backend halves of this repo.
