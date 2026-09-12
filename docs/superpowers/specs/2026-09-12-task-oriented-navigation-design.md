# Task-oriented navigation replacement

**Date:** 2026-09-12  
**Status:** Approved for planning; implementation has not started.

## Outcome

Replace the authenticated Budget shell navigation rather than refining its existing rail. The result is a task-oriented desktop sidebar and a mobile navigation drawer that preserve every existing application destination and all financial behavior.

## Scope

### Included

- Replace the authenticated shell's information architecture and responsive navigation presentation.
- Preserve the existing destination state values: `home`, `wallets`, `loans`, `categories`, `reports`, and conditional `household`.
- Group destinations by user intent: Daily money, Review, and Setup.
- Replace the duplicated space selector/name presentation with one accessible space switcher that also exposes creating another space.
- Provide equivalent English and Arabic RTL navigation, desktop and mobile layouts, keyboard behavior, loading/error presentation, and visual tests.

### Excluded

- Browser URL routing, authentication, onboarding, space-selection semantics, household authorization, financial commands, gateways, calculations, schema, migrations, or database privileges.
- New navigation destinations, reporting data, global transaction actions, notification controls, search, user preferences, or account-management capabilities.
- Changes to feature-page business logic, dialogs, or data loading beyond the shell's presentation of their existing loading and error states.

## Information architecture

The sidebar has one source of truth for destination metadata. It renders only destinations available in the selected space.

| Group | Destination label | Existing destination | Availability |
| --- | --- | --- | --- |
| Daily money | Overview | `home` | Every space |
| Daily money | Wallets | `wallets` | Every space |
| Review | Loans | `loans` | Every space |
| Review | Reports | `reports` | Every space |
| Setup | Categories | `categories` | Every space |
| Setup | Household | `household` | Household spaces only |

`Overview` is a user-facing label for the existing `home` destination; it does not add a second home view. Wallets remains the sole primary location for recording a transaction, so no money-mutating action is introduced in global navigation. When a selected household space changes to a personal space, the existing `household` fallback behavior remains unchanged.

## Desktop shell

At viewport widths of 1024 CSS pixels and above, the shell uses a persistent 248px logical-start sidebar. It contains, in reading order:

1. Product lockup.
2. A single space switcher. Its trigger shows the selected space in a `bdi` wrapper plus its Personal or Household context. Its popup lists available spaces and has an `Add another space` action.
3. Three labelled navigation groups in the order above. Every item has an icon and text label; the active item has `aria-current="page"` and a non-color active cue.
4. Language and Account controls in the footer. Backup-readiness stays inside Account.

There is deliberately no collapsed icon-only desktop rail. Labels are part of the primary orientation model and prevent ambiguous icons, especially in Arabic.

## Mobile and tablet shell

Below 1024 CSS pixels, the persistent sidebar is removed. A compact top bar shows the product lockup, the current space switcher, and a labelled `Menu` button. The button opens a modal navigation drawer containing the same ordered groups, Add space action, language control, and Account menu. It is not a horizontally scrolling row of primary navigation choices.

Opening the drawer focuses its close button. Escape closes it, Tab and Shift+Tab remain within it, selecting a destination closes it after dispatching the existing destination change, and close restores focus to the Menu trigger. All actionable controls remain at least 44 by 44 CSS pixels.

## RTL and accessibility contract

- The desktop sidebar uses logical layout properties and moves to the right in Arabic. The mobile drawer opens from logical inline-end.
- DOM order stays product, space, navigation groups, then utility controls; CSS does not reverse keyboard order.
- Database-sourced space names and account email remain direction-isolated with `bdi`. Monetary content remains owned by feature pages.
- Icons are `aria-hidden`; every control has an explicit visible text name.
- Navigation is a labelled `nav`; group headings make sections discoverable without being interactive. The mobile drawer has `role="dialog"`, `aria-modal="true"`, a programmatic name, and reliable focus restoration.
- The selected-space switcher, menu, and account controls communicate expanded state semantically.

## Loading, error, and recovery behavior

The pre-existing full-page authenticated loading, workspace-error, and required onboarding states remain shell-free because no safe selected space exists yet. After a workspace is ready, the navigation stays mounted while each feature retains its own current loading, error, retry, and empty states. A feature error therefore never removes the user's way to select another destination or space. The space switcher must not claim a changed selection until the existing workspace state has confirmed it.

## Component boundaries

- `ApplicationShell` owns desktop/mobile composition, drawer state, focus restoration, and existing callback wiring.
- `workspace-navigation.tsx` owns typed destination/group metadata and renders an accessible navigation list from it; it does not own routing or data.
- `space-switcher.tsx` owns the reusable disclosure UI for selecting an already available space or starting the existing add-space flow; it does not load or mutate spaces itself.
- `src/styles.css` owns responsive placement and visual treatment. Feature pages, gateways, hooks, and database code remain untouched.

## Acceptance criteria

- Desktop EN and AR render the correct groups, active item, available Reports, and conditional Household item without duplicated current-space names.
- Mobile EN and AR show a compact bar; the navigation appears only in a modal drawer, never as horizontally scrolling primary navigation.
- Drawer focus opens, traps, escapes, and restores correctly; controls expose useful names and active/expanded semantics.
- Switching spaces still invokes only the current callback and removes Household in personal spaces. Add space still invokes only the current callback.
- Existing shell, workspace, and feature tests remain green. New visual and browser tests cover desktop/mobile, EN/AR, drawer open/close, no page overflow, and group/order rules.

## Verification boundary

The implementation must inspect fresh fixture-backed screenshots and run keyboard browser checks. That proves the local application shell, not a live authenticated Supabase session, a physical device, assistive technology, or a hosted deployment.
