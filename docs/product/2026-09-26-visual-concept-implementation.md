# Desktop and mobile concept implementation

## Approved brief

Implement the 16-screen [desktop](../../artifacts/desktop-concepts-v2/README.md) and [mobile](../../artifacts/mobile-concepts/README.md) galleries across the existing budget app. The images express visual hierarchy and navigation; they contain illustrative data and some proposed arrangements. Render actual app data, preserve working flows, and do not add backend features to imitate a sample card.

Loans moves from Manage to the last Plan section. The loan page keeps creation, detail, repayment, and correction flows. Loan-linked entries in Wallets navigate to Plan > Loans. Both English and Arabic use the same information architecture.

## Visual system

- **Color:** forest rail `#123f34`, deep forest `#0d5d48`, emerald action `#177f63`, warm canvas `#f6f7f3`, white surface `#ffffff`, charcoal ink `#121614`. All values live in `src/control-room.css` tokens; other stylesheets reference tokens.
- **Type:** the existing bilingual sans stack, with tabular numerals for amounts. Page titles, section titles, labels, and amounts each have one clear level. No decorative lettering.
- **Desktop:** persistent 244px dark rail with space switcher, Record action, and four destinations. Content has wider dashboard grids where data benefits from comparison; long registers retain readable row density.
- **Mobile:** compact space switcher at the top, a fixed Home / Journal / Record / Plan / Manage bar, stacked cards, horizontally scrollable Plan sections, and large/full-screen creation flows. Keep the main viewport free of horizontal overflow at 390px.
- **Interaction:** one primary action per screen or dialog, visible active destination/section, keyboard focus and reduced-motion support, logical properties for RTL, and `<bdi>` for user-sourced names.

## Screen coverage

| Area | Existing source | Concept pages |
| --- | --- | --- |
| Entry | AuthScreen, OnboardingDialog | 01–02 |
| Daily view | ControlRoomShell, HomeScreen, JournalScreen, RecordSheet | 03–04, 16 |
| Planning | PlanRoutes, PlanPage, Allocation, Goals, CashControl, UpcomingBills, LoansPage | 05–09, 13 |
| Manage | ManageScreen, WalletsPage, CategoriesPage, HouseholdPage, PhoneShortcutPage | 10–12, 14–15 |

## Validation

Run affected UI tests and `pnpm check:ui`; exercise representative EN/AR desktop and mobile flows in Playwright. Compare screenshots with the concept galleries for structure and hierarchy, while recognizing that real data and state differ from the generated samples. Verify keyboard access, 390px overflow, loan navigation, and existing creation/repayment flows. Keep this worktree local; do not push or deploy.
