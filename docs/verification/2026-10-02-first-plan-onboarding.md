# First monthly plan onboarding

Implemented the approved desktop/mobile concept with linked amount and percentage inputs, independent USD/LBP drafts, live remaining-money summary, custom categories, month selection, Arabic/RTL labels and optional setup completion. The existing wallet opening-balance step is preserved as part of wallet setup. Loan setup stays in Plan → Loans.

Amounts are saved as integer minor units through existing protected category/income/target commands. Percentages are entry aids calculated against monthly income, rounded to the selected currency's precision. Changing income preserves each row's last edited basis. Suggestions are placeholders, never automatically saved.

Recovery covers partial commands, stable identities on retry/reload, removed targets after partial saves and revision conflicts, and persisted plan stages when wallet reads fail. Setup-owned target metadata is separate from disposable command identities. Unrelated targets are preserved.

Verification:

- Full app/worker type check passed; generated worker types are current.
- Production build passed (existing large-bundle advisory remains).
- Full UI suite: 127 files, 1,558 tests passed. Focused money, save, form and wizard tests: 35 passed.
- Browser integration: 19 passed with 9 device-specific skips; final onboarding checks: 4 passed across desktop/mobile, including Arabic at 320px.
- Screenshots inspected for desktop, mobile and Arabic. Final captures are under artifacts/first-plan-onboarding. Amount inputs have one border/focus ring and layouts have no horizontal overflow.
- Independent code review completed; both identified recovery bugs were fixed and covered by regression tests.
- UI detector reported only pre-existing accent-border warnings outside the new form. No unrelated styling changes were made.

Browser checks use synthetic, in-memory HTTP fixtures. No production account, financial data, migration or deployment was changed.

Pre-release audit:

- Cloudflare release build passed, including a repeat under Node 22.23.2. Worker suite: 7 files, 98 tests passed. Combined and frontend-only deployment dry-runs passed.
- Broad browser run under Node 26 reported 175 passing tests and 55 skips, but stalled during shutdown and was interrupted. A repeat under Node 22 with a 180-second global timeout exited unsuccessfully: 160 passed, 45 skipped, 25 did not run, and suite/teardown timeout errors. No assertion failures were reported; the full browser release gate remains unresolved.
- Hosted invitation Worker secrets are absent. Follow the documented frontend-only release path while invitation delivery remains deferred; a combined deployment is not ready.
- At audit time, local main was one commit ahead of origin/main with the pre-existing d5310ca cleanup commit, and onboarding changes were uncommitted. Unrelated daemon/temp changes are excluded from the onboarding commit.
- A deployed synthetic-account onboarding save/reload smoke check and rollback verification remain release tasks. No live deployment was performed.

The owner subsequently authorized committing and pushing main while deferring the broad browser-runner issue and production smoke check. A final focused onboarding browser run under Node 22 completed successfully: 4 passed (3.5 seconds), covering desktop/mobile, linked inputs, protected target saves, reload recovery, and Arabic at 320px. Fresh desktop/mobile captures were visually inspected; no additional UI changes were made during this final pass.
