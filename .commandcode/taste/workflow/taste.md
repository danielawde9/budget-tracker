# Workflow preferences

- Treats Playwright/e2e UI testing as mandatory before calling any task done, even DB-only ones, and expects a clear statement of whether it ran and what it covered. Confidence: 0.9
- Prefers the assistant to keep working autonomously through the roadmap without pausing for per-step confirmation ("keep going", "continue", "do the next one, I'm not at my laptop"). Confidence: 0.85
- Prefers subagent-driven development: spawn swarms/parallel agents (or separate sub-chats) for implementation and independent review rather than doing everything in one thread, with the assistant acting as coordinator/integrator across them. Confidence: 0.85
- Wants plans written as detailed, implementation-ready specs that another model can execute end-to-end with good functionality, not high-level outlines. Confidence: 0.8
- Provides test-account credentials when asking for verification and expects the app to actually be exercised in a real browser (login → navigate pages → click through flows). Confidence: 0.75
- Asks for production checks explicitly ("did you deploy the SQL and test prod?"), so deployment + live verification is part of "done" for backend work. Confidence: 0.7
- Approves a spec quickly and then hands off ("spec is fine, write the plan"; "looks right, write the plan") — prefers to review a plan once, then let execution run. Confidence: 0.7
- Wants any uncommitted work, SQL migrations, and tooling state resolved before moving on, so progress is never left half-saved. Confidence: 0.65
- Prefers non-destructive, reversible git operations: fast-forward merges instead of merge commits, and explicitly prohibits `reset --hard`, `clean -fdx`, `worktree remove --force`, `branch -D`, and force pushes. Confidence: 0.85
- Before any destructive cleanup (deleting branches/worktrees/state), wants the uncommitted/operational state preserved to an external, restorable location with a recovery record (patches + tarballs + checksums). Confidence: 0.75
- If a required gate (checks/build/deployment) fails, wants the assistant to stop and report the exact blocker rather than proceeding with destructive cleanup. Confidence: 0.75
- Dislikes needlessly repeating long-running test suites once the release risk is already resolved; wants execution kept efficient. Confidence: 0.6
- On cleanup/housekeeping, once items are verified safe to remove, wants the assistant to just delete them rather than asking for another round of confirmation ("if safe to delete do"). Confidence: 0.65
- Wants the division of labor stated explicitly — which steps need him (credentials, approvals, product decisions) versus what the assistant will handle end-to-end ("what should I do or u do everything?"). Confidence: 0.6
- When offered multiple implementation approaches, happy to delegate the choice ("do what you think is best") — recommends picking one and proceeding rather than waiting on his decision, but still wants to review a visual/HTML result first. Confidence: 0.75
- Before a plan/spec is locked in, asks "anything else we missed?" — expects the assistant to proactively surface edge cases, interaction conflicts, and gap conditions (e.g. precedence rules, special user flows, repo conventions) rather than presenting a complete-seeming design. Confidence: 0.65
- Uses a "superpowers" docs convention: design specs live in docs/superpowers/specs/ and implementation plans in docs/superpowers/plans/ named YYYY-MM-DD-<topic>.md, with a plans README defining the plan format. Pointing at a plan file path — even one that doesn't exist yet — means "write this plan from the matching spec", and new plans should follow the plans README and the format of recent plans. Confidence: 0.7
