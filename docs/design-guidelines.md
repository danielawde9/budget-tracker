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
