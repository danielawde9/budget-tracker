# Design Guidelines — Control Room UI

The single source of truth for how this app looks. Every screen, dialog, and
form must be built from the patterns below. If a pattern doesn't exist here,
extend `src/control-room.css` with a new `cr-*` class and add it to this
document in the same change. Do not invent per-feature visual styles: feature
stylesheets may only add **layout** (grids, row ordering) on top of these
patterns, never new visual language (colors, borders, radii, label styles).

## 1. Tokens only

All values come from `src/control-room.css` `:root`. Never hard-code a color,
spacing value, radius, shadow, or duration.

| Token family | Use |
| --- | --- |
| `--cr-bg`, `--cr-surface`, `--cr-surface-sunken` | Canvas, cards, recessed wells |
| `--cr-border`, `--cr-hairline` | Control borders, dividers (hairline = subtler, dividers only) |
| `--cr-ink`, `--cr-ink-soft` | Primary text, secondary text + hints |
| `--cr-accent`, `--cr-accent-strong`, `--cr-accent-soft`, `--cr-accent-ink` | Primary action, selected state, selected tint, text-on-accent |
| `--cr-rail-bg`, `--cr-rail-surface`, `--cr-rail-border`, `--cr-rail-ink`, `--cr-rail-muted`, `--cr-rail-indicator` | Desktop navigation rail and its selected state |
| `--cr-warn`, `--cr-warn-strong`, `--cr-danger`, `--cr-danger-soft` | Warning, warning text, destructive, destructive tint |
| `--cr-space-1..6` (4–32px) | All spacing. Sections breathe at `--cr-space-4`; related controls group at `--cr-space-2` |
| `--cr-radius-sm` (12px), `--cr-radius` (16px), `--cr-radius-full` | Controls/inner groups, cards/dialogs, pills |
| `--cr-shadow-card`, `--cr-shadow-backdrop`, `--cr-shadow-sunken` | Cards, overlays, recessed wells |
| `--cr-duration`, `--cr-ease` | All transitions |

## 2. Typography

| Level | Spec | Class |
| --- | --- | --- |
| Screen title | 24px / 800 / -0.02em | bare `h1` in `.cr-shell` (never override) |
| Section title | 19px / 800 / -0.02em | bare `h2` in `.cr-shell` |
| Group label (legend, kicker) | 11px / 700 / 0.08em / uppercase / `--cr-ink-soft` | `.cr-form-section legend`, `.cr-choice legend` |
| Field label | 12px / 600 / `--cr-ink-soft` | `.cr-label` |
| Helper/explainer | 13px / `--cr-ink-soft` / line-height 1.5 | `.cr-helper` |
| Body / inputs | 15px | default |
| Amounts | bold, `tabular-nums`, `<bdi>`-wrapped | `.cr-amount` |

Placeholders are always muted (`--cr-ink-soft`) and are hints, never the only
label (global rule in `styles.css`).

## 3. Surfaces

- **Card** — one per screen section: `.cr-card` (white, 16px radius, space-5
  padding, card shadow). Cards stack with space-4 between them.
- **Form section** — group related fields inside dialogs and editors:
  `.cr-form-section` on a `<fieldset>`, with a `<legend>` (styled
  automatically). 12px radius, border, space-3 padding, column gap space-3,
  stacked with space-4 between sections.
- No bare/default fieldset chrome anywhere. No nested sections.

## 4. Choices

Radio groups use `.cr-choice` on a `<fieldset>` (legend = the group label):
a single boxed row of `label > input[type=radio] + text` items that wrap.
Same border/radius/padding as form sections, row direction. One choice group
per decision; never radios floating loose outside a group.

- Selected state: the global custom radio (accent dot) — do not restate.
- Disabled options stay visible with a muted label and an accompanying
  `.cr-helper` hint (`aria-describedby`), never hidden.

## 5. Fields

- Label wraps the control (`<label>text<input/></label>`) — this is the app's
  naming contract; the accessible name is exactly the label text. Extra
  copy ("required", hints) must NOT go inside the label — use a sibling with
  `aria-describedby` (see `schedule-editor.tsx` Loan field for the pattern).
- Label-over-control stacking (search, date ranges) uses `.cr-field`.
- Every input shows a visible label OR a bilingual placeholder hint plus an
  `aria-label`.
- **One control geometry** (the `styles.css` canonical block — never fork it):
  text/number/search inputs, selects, and textareas share 44px min-height,
  12px radius, 1px `--cr-border`, white surface, 15px text, 0.6rem × 0.75rem
  padding, and the accent `:focus-visible` ring (2px, offset 2). There is no
  "inside a form" variant.
- **One select design**: all selects use the canonical treatment —
  `appearance: none` with the shared chevron, hover border, and accent focus
  ring (mirrored for RTL). No browser-default arrows, no bespoke select
  styles.
- **Affixes** (`%`, unit words) render as `.cr-affix` wrapping the input and a
  `.cr-affix-suffix` muted `aria-hidden` span outside the label, so the
  accessible name stays clean.
- Errors: `role="alert"`, `--cr-danger` text; section-level errors use
  `.error-notice`. Validation hints use warn tone only when blocking.
- **Copyable values** (links, codes) use `.cr-copy-field`:
  - a `.cr-field` label wrapping a read-only input (`dir="ltr"` for URLs), then a `cr-button` whose accessible name says what it copies ("Copy expense link").
  - The button wraps below the field on narrow widths.
  - Copy results are announced in a `role="status"` line, with a hold-to-copy fallback message when the Clipboard API is refused.

## 6. Buttons

`.cr-button` family only: exactly one `--primary` action per screen/dialog;
`--danger` for destructive; `--sm` inside toolbars; `--block` for full-width
list actions. Tertiary/inline actions (Rename, Remove, Correct…) are
`.text-button`. No new button shapes, gradients, or shadows.

**Every dialog's single main action is `cr-button cr-button--primary`**
(Create/Save/Record/Confirm/Submit/Sign in…) — never a bare `submit` button
styled by legacy defaults, and never hand-rolled green styling in feature
sheets. Secondary Cancel stays `.button-secondary`; exactly one primary per
dialog at a time.

A lone dismiss/acknowledge action inside a `.cr-banner` (e.g. `SettleNoticeBanner`'s
settled/ambiguous/failed notice) is `cr-button cr-button--sm cr-banner-dismiss` —
the modifier only self-aligns it to the inline end so it doesn't stretch the
banner's column layout; a banner offering more than one action (retry +
dismiss) uses `.cr-row` instead, as `AmbiguousBanner` does.

## 7. Filters & toolbars

`.cr-toolbar` + `.cr-chips` for filter rows (kind chips, tabs); `.cr-tabs` /
`.cr-tab` only for true segmented single-selects (currency). Date ranges use
the `.cr-journal-dates` pattern (stacked on mobile, inline row on desktop)
with a clear action that appears only while a filter is active. Filters are
client-side over loaded data unless a server read already exists.

## 8. Lists & rows

Row-based registers (wallets, loans, categories, journal, members): rows are
min 44px targets; primary name in `<bdi>`; amounts inline-end, bold,
`tabular-nums`; status uses `.status-*` pills; metadata lines use `.cr-helper`.
Empty states are a panel with one line of explanation and the single primary
CTA that creates the first item.

Numbered how-to instructions inside a card use `<ol class="cr-steps">`: plain `<li>` sentences, accent-strong numerals, logical inline-start padding. Never a hand-numbered paragraph list.

## 9. Dialogs

All dialogs render through the shared `DialogShell`
(`src/features/wallets/dialog-shell.tsx`) — overlay, focus trap, Escape,
return-focus, `[data-autofocus]`, success-result swap. Dialog content stacks
`.cr-form-section`s; actions sit in `.dialog-actions` (secondary Cancel left,
primary submit right, RTL-aware). No new dialog frames.

## 10. i18n & RTL

Every user-visible string ships EN+AR in the same change, via the file-local
`t(locale, en, ar)` helper (or the loans `translate` copy table). Arabic
reuses the established vocabulary (grep first). CSS uses logical properties
only — no physical `left/right/margin-left`; no `text-align: left`.
User-entered names are wrapped in `<bdi>`; amounts never mirror.

## 11. Accessibility invariants (never regress)

Accessible names/roles are a test-enforced contract — changing one requires
updating every asserting unit/e2e test in the same change. Dialogs return
focus to their opener. All targets ≥44px. No horizontal overflow at 390px.
State is never color-only (icon or text accompanies tone). Motion honors
`prefers-reduced-motion`.

## 12. Checklist for any UI change

1. New visual need → add/extend a `cr-*` class in `control-room.css` + record
   it here; feature CSS adds layout only.
2. Built from sections/cards/choices/fields/buttons above — nothing bespoke.
3. EN+AR strings; logical properties; tokens only; ≥44px; names stable (or
   tests updated in the same change).
4. `pnpm check:ui` + affected e2e specs green before claiming done.

## 13. Wizards (multi-step forms)

Long creation/edit flows are **step forms**, not scrolling dialogs. Precedent:
the Record sheet. Shared chrome lives in `control-room.css`:

- `.cr-wizard-steps` + `.cr-wizard-step` (`--current`/`--done`) + dot/label —
  the progress indicator, step labels bilingual.
- `.cr-wizard-step-heading` — the visible title of the current step.
- `.cr-wizard-content` — one step's fields (column, space-3 gap, step-in
  animation).
- `.cr-wizard-review` / `.cr-wizard-review-row` — the final Review step's
  label/value summary.
- `.cr-wizard-footer` + `.cr-wizard-footer-end` — actions: Cancel (text
  button, start), Back (secondary, start, hidden on step 1), Next/Save (the
  single primary, end). Footer mirrors correctly in RTL.

Rules:

1. **3–5 steps**, one decision or coherent field cluster per step, ordered so
   later steps can depend on earlier answers (type → amount → details →
   references → review).
2. **Gated progression**: Next validates only the current step (existing
   per-field validation stays); invalid input blocks with the existing
   `role="alert"` error, focus stays put.
3. **Conditional steps** (e.g. percentage-mode-only groups) are skipped in the
   indicator and the Next chain — never shown disabled.
4. **Review step always last**: every saved value as a label/value row; Save
   is disabled while pending. After save, the existing success-result screen
   shows unchanged.
5. All fields keep their established accessible names; step containers use
   `role="group"` with a bilingual `aria-label`; the dialog's own title and
   close behavior never change. EN+AR for every new string (step labels,
   Back/Next/Review).
6. The same chrome serves inline (non-dialog) stepped flows — the wizard
   pattern is about sequencing, not the container.

## 14. Page headers & section headers

- **Page header** — exactly one per destination: the shared `PageHeader`
  (`src/features/control-room/page-header.tsx`), rendering `.cr-header` with
  a bare `h1` (the shell owns the 24px/800 style — never restyle it), an
  optional subtitle (`.cr-helper` copy), and an optional `.cr-header-actions`
  cluster on the inline end (wraps below the title on narrow widths). The
  header is state-independent: a destination renders the same `PageHeader`
  while its content loads, errors, or is ready (loading skeletons and error
  cards appear below it, never instead of it). Sub-views reached by drilling
  in (Manage sections, goal/occurrence details) keep their own Back row and
  do not add a second page header.
- **Section header** — inside a card, a titled section with actions uses
  `.cr-section-header`: a bare `h2` (the shell's 19px/800 section style —
  never restyle it) with the section's actions on the inline end. Feature
  stylesheets never redefine heading fonts; they add layout only.
- Retired: `cr-title`, `cr-plan-header`, and the legacy
  `topbar`/`page-header`/`ln-header` header families (the unrouted
  `reports-page.tsx` is the only file still carrying the legacy classes).

## 15. Responsive workspace and data cards

- The desktop workspace has a dark forest `.cr-rail` with the space switcher,
  Record action, and four destinations. The active destination uses the rail
  surface and a narrow inline-start indicator. Keep readable text contrast on
  both active and resting destinations, in EN and AR.
- At narrow widths, the space switcher sits above the page and the fixed
  `.cr-tabbar` shows Home, Journal, Record, Plan, and Manage. The Record label
  stays visible below its button. Plan sections may scroll horizontally within
  their navigation; the document itself must not scroll horizontally at 390px.
- The main canvas uses `--cr-bg` and the wider `--cr-content-w-wide` limit on
  desktop. Home and other summary pages may arrange existing `.cr-card`
  sections in a grid, then stack them on mobile. Feature stylesheets determine
  grid placement only; tokens and shared `cr-*` styles determine appearance.
- A summary metric uses `.cr-label` for its name and `.cr-amount` with `<bdi>`
  for its value. Use `.cr-amount--dashboard` for paired large currency balances
  so long LBP values fit beside USD. Trend bars use the shared
  `.daily-trend-pair` fill treatment.
  Every trend still needs readable text values; bars alone never carry the
  result. Registers use the existing row and card rules above.
- The mobile Record sheet takes the full viewport height. Its existing stepped
  flow, focus handling, and visible amount remain intact; on wider screens it
  uses the normal dialog frame.

## 16. Entry and first-space screens

- The signed-out entry lives outside `.cr-shell`. Its `.auth-boundary` uses a
  two-column card at desktop widths: the form on one side and a simple ledger
  illustration on the other. The illustration is decorative and built from
  local CSS with the shared tokens. Mobile shows the form in one column and
  hides the illustration; the language control remains visible at the top.
- First-space setup uses the existing two-step `.onboarding-dialog`. The
  visible `.onboarding-progress` identifies the current step, and the space
  type choices keep their descriptions and keyboard-operable controls. The
  active choice uses the shared accent colors. The privacy and boundary notes
  stay visible in the step where they inform the choice.
- Entry styles live in `src/styles.css` because these screens render before
  the Control Room shell. Reuse `--cr-*` tokens and the shared field, button,
  focus, and dialog geometry; do not introduce another color palette.

## 17. v2 connected money model patterns (2026-10-03)

v2 reuses every pattern above. New shared classes live in the "v2" section at
the end of `src/control-room.css`; feature code adds no visual language.

- **Typography:** Arabic uses installed Tahoma (`:root:lang(ar)`), from the
  selected design of 2026-10-02. Resting cards are flat: `--cr-shadow-card: none`
  with the fine border.
- **Dialogs:** `Dialog` (`src/ui/dialog.tsx`) is a native `<dialog>` opened with
  `showModal()` and styled `.cr-dialog.dialog`. The browser supplies the focus
  trap, the inert page, Escape and focus return. Below 1024px it fills the
  screen. A dialog cannot be dismissed while a command is pending.
- **Money fields:** `MoneyField` is `type="text"` with `inputmode="decimal"` (or
  `"numeric"` for LBP). It accepts Latin or Arabic-Indic digits. Errors
  (`.cr-field-error`) appear only after the field was edited and left.
  `hideLabel` keeps the accessible name and hides the visible label.
- **Amounts:** `Amount` renders `<bdi dir="ltr" class="cr-amount">`, with the tones
  `--positive`, `--negative`, `--warn` and `--secondary` (a second currency).
  Tone is always paired with a sign or a label.
- **Explanations:** `.cr-explain` is a plain-language consequence (pale green).
  `.cr-explain--warn` is the amber version, for a consequence the person
  should notice before saving.
- **Registers:** `.cr-register` > `.cr-register-row` (`.cr-register-main`,
  `.cr-register-title`, amount at the inline end). A clickable row is a
  `.cr-register-button`.
- **Home equation:** `.cr-hero` (hero amount), `.cr-equation` (Cash you hold =
  Set aside + Ready to assign, as a `<dl>`), `.cr-wallet-strip`,
  `.cr-net-worth`, `.cr-alerts`/`.cr-alert(--danger)`. The currency switch is
  `.cr-tabs > .cr-tab-button(--active)` with `aria-pressed`.
- **Plan:**
  - Summary and bar: `.cr-figures` (headline numbers), `.cr-stack-bar` with
    `.cr-stack-bar-part.cr-tone-0…5` (group shares, text always beside it).
  - Group cards: `<details class="cr-card cr-group">` with
    `.cr-group-summary`, and `.cr-plan-table` for items (it stacks below
    700px).
  - Item details: `.cr-kind` (item kind), `.cr-goal` (progress shown while the
    target date is ahead) and `.cr-statement` (an item's month statement).
- **Editor and record:** `.cr-editor-group`, `.cr-editor-item`,
  `.cr-record-kinds` (a scrolling chip row), `.cr-cover` (expense
  shortfall), `.cr-fund-lines` and `.cr-fund-total`.
- **Utilities:** `.cr-stack` (column gap), `.cr-icon-button` (44px),
  `.cr-link-button`, `.cr-flip-rtl` (directional icons), `.cr-check`.
- **Preview only:** `.cr-demo-panel`, `.cr-tour` (amber border). Production
  bundles drop this code because Vite replaces `import.meta.env.MODE`.
