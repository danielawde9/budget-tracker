# First plan onboarding implementation plan

**Goal:** Implement the approved desktop/mobile onboarding concept with linked money and percentage inputs and real monthly plan persistence.

**Architecture:** Extend the first-run wizard with an optional plan step after the existing wallet/opening-balance flow. A focused plan component owns bilingual forms and currency drafts; integer money helpers calculate linked fields. A saver uses existing protected category and monthly-plan gateways, stable request IDs, and revision checks. Server space-clock dates remain authoritative. Existing/additional-space flows retain their behavior.

**Stack:** React, TypeScript, existing CSS tokens, Vitest, Playwright.

- [x] Add failing calculation tests for amounts, percentages, income changes, whole-unit LBP and decimal rounding.
- [x] Add failing saver tests for protected saves, retries after partial writes, category reuse and revision concurrency.
- [x] Add failing form tests for editing either field, blank/invalid income, over-allocation, currency isolation, skip and errors.
- [x] Implement calculation helpers, focused saver and responsive bilingual first-plan form.
- [x] Connect the form to first-run onboarding; preserve opening balances and resumable plan-stage progress. Add integration coverage.
- [x] Update first-run browser tests and add desktop/mobile/RTL plan screenshots and save assertions.
- [x] Run relevant UI suite, TypeScript/build checks, browser tests and one visual inspection. Fix findings and confirm.

## Decisions

- Money is saved as exact integer minor units; percentages are an entry aid, not a new database mode. Editing income preserves the last edited basis of each row.
- Blank categories are skipped. Example amounts are placeholders only, never silently saved.
- Category suggestions are Rent & bills, Groceries, Transport and Personal spending, with an Add category action. New category names are editable before saving; persisted category names remain immutable.
- USD and LBP drafts are independent. Creating a plan saves the selected currency; the other can be planned afterward in Plan.
- Save failures keep inputs and reuse request identities for unchanged commands. Completed category writes are reused on retry. Changing data creates a new command after refreshing revisions.
- Setup remains finishable without a budget. Planned figures never post wallet movements.


## Recovery review

- Setup-owned targets are tracked independently from command receipts. Removing or renaming a row after a partial save clears only that setup's obsolete targets through protected zero-target commands, including after revision conflicts.
- A persisted plan stage is authoritative even if wallet metadata cannot be reloaded; setup does not offer duplicate wallet creation or opening-balance recording.
- Drafts, selected currency and month are restored within the browser session. Complete or skip clears the draft and retry journals.
