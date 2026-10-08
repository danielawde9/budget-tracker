# Finish the remaining issue backlog and release

User authorized completing all valid issues, closing obsolete reports, merging open PRs and finishing the release.

- Verify #1 external plugin OAuth and close only with evidence or an explained external limitation; verify #2 obsolete v1 planner test against current tracked files.
- Preserve and integrate previously verified mobile fixes from the primary checkout.
- #3/#4: one app-owned, memory-only unresolved-save store keyed by space, freezing exact RPC request/payload on uncertain outcomes; safe identical replay and refreshed reads; pending state shared with Record/Plan dialog hosts so dismissal/action switches cannot unmount a save. Treat unknown gateway/network outcomes as uncertain, definite DB refusals as rejected. EN/AR recovery notice in Home/Record; new money commands blocked until recovery. Document reload limitation.
- #5: real local-stack browser tests lose a committed RPC reply and retry from same form or recovery notice; full row snapshots of every budget table prove dismissing filled Record/Fund/Plan/Correct writes nothing; loopback-only DB helper and EN/AR case.
- #6: private production clock helper and test-only controllable implementation; Beirut midnight/month/DST coverage and ratchet checks. No client control in production.
- #9: membership-protected cash-wallet statement read, date/balance comparison with no writes, Activity wallet/month deep link and preselected recording, USD/LBP/Arabic amount tests.
- Review combined patch, full database/UI/build and desktop/mobile browser verification. Apply additive migrations locally and production with explicit project target and backup; merge PR(s), deploy frontend, verify live release. Reply/close resolved issues with evidence.

Independent tasks #6 and #9 use parallel agents with separate files; root handles #3/#4/#5, integration, external reports, release. Existing PR #10 carries the coordinated implementation; broaden title/body to final scope. Existing mobile changes in primary and unrelated .swarm files must be preserved.
