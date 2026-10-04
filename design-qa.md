# Design QA

## Confirmation design

A successful money action shows a green check, a localized completion heading,
and the original result summary. Done is the primary action at the inline end;
Record another is secondary when available. The divider spans the content.
On narrow phones the buttons grow and wrap. Arabic mirrors the layout.

The shared pattern is documented in docs/design-guidelines.md section 18.
Audit evidence: docs/feedback/2026-10-04-ui-interaction-audit.md.

## Completed checks — 2026-10-04

- [x] Production build and TypeScript checking.
- [x] Existing UI suite: 80 tests across 14 files.
- [x] Diff whitespace check.
- [x] Isolated desktop English and phone English/Arabic layout checks using
      project CSS: no horizontal overflow, buttons at least 44px high.
- [x] Visual inspection of desktop and Arabic phone fixture screenshots.
- [x] Shared tokens, logical properties, bilingual headings, icon with text.

## Real-flow acceptance checks

- [x] Save an exchange; verify exact amounts and currencies in the result.
- [x] Confirm Done receives focus after save and closes on Enter.
- [x] Confirm focus returns to the opener after closing.
- [x] Record another reopens a fresh form without repeating the saved write.
- [ ] Confirm the status summary is announced politely once with a screen reader.
- [x] Verify Escape, close button, and backdrop behavior in the real dialog.
- [ ] Check long summaries, 200% zoom, EN/AR, and supported browsers.
- [ ] Verify error and pending states never show a success result prematurely.
- [x] Run database-backed exchange end-to-end checks on the local preview stack.

All five Chrome end-to-end tests passed on the existing local preview stack.
The new exchange tests verify keyboard completion, repeat behavior, request
counts, and all three dismissal paths. Backdrop focus return failed before the
shared Dialog fix and passed afterward. Build and 80 UI tests also passed again.
Unchecked items above remain pending. The live website has not been deployed
or audited here.
