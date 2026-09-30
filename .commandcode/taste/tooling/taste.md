# Tooling preferences

- Wants the git working tree always clean: commit everything including tool-state/agent directories (.swarm, .claude-flow, .claude/), .DS_Store, and generated temp dirs like supabase/.temp — never leave dirty or untracked state lingering. Confidence: 0.9
- Prefers to run credentialed / irreversible commands (live DB migration, publish, deploy) himself and wants the exact command echoed back each time so he can rerun it. Confidence: 0.75
- Prefers environment-file based configuration for deploy commands (e.g. source the env file rather than being prompted for secrets). Confidence: 0.65
- Dislikes credentialed CLI migration wrappers (e.g. `pnpm migrate:live` with token/password prompts and typed confirmations); prefers applying production migrations as a single self-contained `.sql` file pasted into the Supabase SQL Editor, and is also content with the plain un-wrapped `supabase db push --linked` when the paste route fails. Confidence: 0.8
- Expects new projects/workflows to mirror the patterns already established in his other repos (e.g. "like we do in the POS") rather than inventing a new process. Confidence: 0.6
- After work lands (and on request), wants full housekeeping done: merge the work, delete stale/merged branches, prune leftover worktrees, and drop leaked disposable test databases, leaving the repo/env tidied. Confidence: 0.7
- Wants migration/deploy prerequisites reconciled up front (manifest, applied-migration status) so a deploy attempt does not fail on bookkeeping. Confidence: 0.6
- Prefers verifying remote/hosted state read-only (e.g. `supabase migration list --linked`) and never re-running apply/push commands for migrations that are already applied. Confidence: 0.7
- Prefers the code/workflow to be adapted to the configuration and tools he already has in place, rather than reconfiguring his own setup to satisfy the code's expectations (e.g. wanting the app to read his existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` variable names instead of changing his Cloudflare build variables). Confidence: 0.65
