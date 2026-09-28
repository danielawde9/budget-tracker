# W1B — P3 cosmetic polish (typography, tokens, icon fill)

**Date:** 2026-09-28. **Worktree:** `/Users/daniel/Desktop/Daniel/budget-tracking/.worktrees/w1b-cosmetic`
**Branch:** `ws/w1b-cosmetic`. **Method:** measured the concept sheets against the stored
implementation captures (ImageMagick pixel sampling + glyph-box measurement + zoomed crops),
itemised every P3 difference, then fixed only the token/CSS-level ones.

**Scope.** No behaviour change, no layout redesign, no interaction change, no new copy. Only
CSS tokens + shared styles were edited, plus one colocated stylesheet test. Owned paths only:
`src/control-room.css` (design tokens + shared styles), `src/control-room.test.tsx` (new
colocated test), and this document. `routes.tsx`, `app.tsx`, `planning-shared/**`,
`loans/types.ts`, `wallets/money.ts`, `package.json`, `ops/**`, `supabase/**`, `scripts/**`
and `e2e/**` were read but never edited. No push, no full e2e suite, no new e2e spec, no SQL.

## Commands used for the evidence

```bash
# canvas tone (whole-strip average, mockup vs implementation), desktop 1586×992:
magick artifacts/desktop-concepts-v2/03-home.png -crop 120x400+10+520 +repage -resize 1x1! -format '%[pixel:p{0,0}]\n' info:
magick artifacts/desktop-concepts-v2/03-home.png -crop 300x60+700+915  +repage -resize 1x1! -format '%[pixel:p{0,0}]\n' info:
# exact colour histogram (no palette reduction):
magick artifacts/desktop-concepts-v2/03-home.png -depth 8 -format %c histogram:info:- | sort -rn | head -18
# zoomed icon crops (rail nav, brand mark, tab bar):
magick artifacts/desktop-concepts-v2/03-home.png   -crop 230x170+15+240 +repage -filter point -resize 500% out.png
magick artifacts/mobile-concepts/03-home.png       -crop 853x120+0+1724 +repage -filter point -resize 150% out.png
# glyph-box measurement (ink bounding box, same width string both sides):
magick <capture> -crop <w>x<h>+<x>+<y> +repage -colorspace gray -threshold 55% -negate -trim -format '%wx%h' info:
```

## P3 punch-list

Severity is P3 throughout (design-qa.md §"Five required fidelity surfaces" marks the residual
type/colour/icon deltas P3). "Actionable" = fixable with a small token/rule change and no
behaviour or layout change.

| # | What differs | Source of truth | Severity | Actionable |
| --- | --- | --- | --- | --- |
| 1 | **Navigation glyph treatment.** The rail nav, the mobile tab bar, the brand mark, and the space-switcher house are drawn as **solid/filled** glyphs in the concept; the implementation renders Lucide **outline** glyphs (`House`, `BookText`, `ChartPie`, `Settings2`, `Leaf`). | `artifacts/desktop-concepts-v2/03-home.png` (rail, x≈43 at y≈268/324/381), `artifacts/desktop-concepts-v2/10-manage.png`, `artifacts/mobile-concepts/03-home.png` (tab bar, y≈1724–1844), `artifacts/mobile-concepts/10-manage.png` | P3 | **Yes — fixed (item A)** |
| 2 | **Canvas tone.** Concept canvas is a neutral near-white; the token sat ~3 levels darker with a yellow cast. Measured — concept: home 247/247/245 … 250/250/248, plan 250/250/249, manage 249/249/247, wallets 251/250/249, journal 250/250/250; mobile home 247/247/245, manage 251/250/248, journal 250/250/248. Token: 246/247/243 (B−R = −3). | every canvas in `artifacts/desktop-concepts-v2/*.png` and `artifacts/mobile-concepts/*.png` | P3 | **Yes — fixed (item B)** |
| 3 | **Rail tone.** The concept rail is a **vertical gradient** (lighter at the top, e.g. home 19/63/48 = `#133F30`, down to 8/44/30 = `#082C1E` on Loans); the app paints one flat `--cr-rail-bg` `#123F34`. | `artifacts/desktop-concepts-v2/03-home.png`, `05-plan.png`, `10-manage.png`, `11-wallets.png`, `13-loans.png`, `14-household.png` | P3 | No — a single flat token cannot match a gradient; the current token already sits inside the concept's measured range (Δ ≤ 5 per channel). Picking one endpoint would over-fit. |
| 4 | **Record / Manage glyph substitution** (not a fill difference). The concept's Record action is a **circled-plus badge** (solid white disc + green plus) and its Manage rail item is a **gear / filled two-person** glyph; the app uses a bare `Plus` and `Settings2` (sliders). | `artifacts/desktop-concepts-v2/03-home.png`, `artifacts/mobile-concepts/03-home.png` | P3 | No — this needs a *different* Lucide glyph (glyph choice is a design decision), not a filled-vs-outline change. Left as-is; see "Left deliberately". |
| 5 | **Auth illustration panel tone.** Concept panel is a warm sage (measured 232/237/227 `#E8EDE3`); the app fills it with the cool mint `--cr-accent-soft` `#E2F2EC`. | `artifacts/desktop-concepts-v2/01-sign-in.png`, `artifacts/mobile-concepts/01-sign-in.png` | P3 | No — the panel now hosts the shipped mint-toned raster illustration (design-qa.md finding 3). Re-tinting the panel alone would clash with that asset; it needs a new token + re-tinted art, beyond P3. |
| 6 | **Section-title info affordance.** The concept puts a small ⓘ glyph beside several card titles (Net position, Available after commitments, Loans); the app has none. | `artifacts/desktop-concepts-v2/03-home.png`, `artifacts/mobile-concepts/03-home.png` | P3 | No — it is a new interactive element (tooltip target), i.e. new markup + behaviour, not a cosmetic-only change. |
| 7 | **Browser font rendering.** design-qa.md names this P3 directly: the concept art is a different typeface (geometric grotesque, tighter tracking) rasterised by the image generator; the app renders its bilingual system stack. Measured drift is ≤ 5 % (helper ink box 207×12 vs 197×11 px for the same string; h1 ink width 121 vs 118 px; mobile h1 131×39 vs 134×36 px; rail nav label identical). | all sheets | P3 | No — not reachable from a token; it is literally a different font rasterisation. |
| 8 | **Helper text size.** Measured helper ink is ~5 % wider in the concept (14 px-ish) than `.cr-helper` (13 px). | `artifacts/desktop-concepts-v2/03-home.png` | P3 | Ambiguous — 5 % is inside rendering noise, and `.cr-helper` is a documented global (docs/design-guidelines.md §2). Left; see "Left deliberately". |
| 9 | **Active mobile tab indicator.** The concept shows a rounded accent underline beneath the active tab label; the app signals the active tab with colour + weight only. | `artifacts/mobile-concepts/03-home.png`, `10-manage.png` (tab bar) | P3 | No — a new indicator element; docs/design-guidelines.md §15 defines the tab bar as colour + weight. Adds markup, so out of "cosmetic only". |
| 10 | **Secondary "New …" button variant.** Some concept secondary actions render as accent-outlined buttons ("+ New goal", "+ New loan", phone-setup "Copy") while the app uses `.cr-button` (neutral) or `.text-button` (bare). The concept is not self-consistent — "New schedule" is solid green there too. | `artifacts/desktop-concepts-v2/07-goals.png`, `13-loans.png`, `15-add-from-phone.png`, `09-upcoming-bills.png` | P3 | No — introducing an accent-outline `cr-button` variant is a new component style (a design decision), not a token nudge, and the concept contradicts itself between sheets. |
| 11 | **Per-card decorative icon tiles** (Goals cards, sign-in wordmark two-tone, rail footer caption "A clearer view of your money"). | `artifacts/desktop-concepts-v2/07-goals.png`, `01-sign-in.png` | P3 | No — each adds markup, a per-item design choice, or new copy. |

## What I fixed

### Item A — filled navigation glyphs (`src/control-room.css`)

Added one shared rule (after `.cr-brand svg`) so the rail + tab-bar navigation icons, the brand
mark, and the space-switcher house carry the concepts' **filled** treatment. Lucide sets
`fill="none"` as a *presentation attribute* on the `<svg>` root, so a single `fill: currentColor`
rule wins with no `!important` and no markup change:

```css
.cr-shell .cr-brand svg,
.cr-shell .cr-tab svg,
.cr-shell .cr-rail .space-switcher-icon { fill: currentColor; }
```

- `House` → solid house (the door sub-path fills into the body), `BookText` → solid book,
  `ChartPie` → solid disc with the slice arc, `Leaf` → solid leaf, `Settings2` → solid sliders.
  Verified by rasterising each Lucide path filled vs outline in Chromium before editing.
- **Deliberately excluded:** the Record FAB's bare `Plus` (it lives in `.cr-fab`, not `.cr-tab`)
  and the `ChevronDown` (`.space-switcher-chevron`) — filling either would produce a different
  badge/glyph, not the concept's. Item 4 covers the real Record/Manage glyph difference, which
  is left alone.

### Item B — neutral canvas (`src/control-room.css`)

```css
-  --cr-bg: #f6f7f3;   /* rgb(246,247,243), B−R = −3 */
+  --cr-bg: #f8f8f6;   /* rgb(248,248,246), B−R = −2 */
```

Lifts the canvas toward the concepts' measured near-white (`#F8F8F6–#FAFAF8`) and removes the
yellow cast, while keeping ~7 levels of separation from the white card (`.cr-surface`) so cards
still read as raised. The token is used by `.cr-shell`, `body`, and the standalone entry/onboarding
screens, so the change is uniform across all 16 screens.

### Test

`src/control-room.test.tsx` (new, colocated with the stylesheet; 3 tests) pins both decisions:
the canvas token stays a neutral near-white (|R−B| ≤ 2, |R−G| ≤ 2, lighter than the surface,
still below `0xff`), and the three filled-glyph selectors exist while the FAB plus and the
switcher chevron are *not* in a fill rule. No unit/e2e test asserts an accessible name, role,
or copy that this change touches, so no existing assertion needed updating.

## Results

### `pnpm check:ui` → **pass** (exit 0)

```
$ pnpm typecheck && pnpm test:ui && pnpm build
$ pnpm check:worker-types && tsc --noEmit && tsc -p tsconfig.worker.json
$ wrangler types --check
✨ Types at worker-configuration.d.ts are up to date.
$ vitest run --config vitest.ui.config.ts
 Test Files  119 passed (119)
      Tests  1471 passed (1471)
$ tsc --noEmit && vite build
✓ 2059 modules transformed.
✓ built in 1.12s
```

### Targeted Playwright → **pass**

`src/control-room.css` is the shell/rail/tab-bar stylesheet, so it reaches every screen; the
closest existing spec is the shell/Home/Journal/Plan/Manage/Record visual-contract spec.

```
pnpm test:e2e e2e/control-room.visual.spec.ts
Running 24 tests using 2 workers
  24 passed (9.2s)
```

(24 = 12 assertions in the spec × the `desktop` and `mobile` projects; they include both
`workspace navigation labels keep readable contrast` checks in EN and AR, and
`Arabic RTL mirrors Home and the Record type grid`.) Not run, per instructions: the remaining
specs and any full-suite run.

Visual confirmation of the produced captures (`test-results/`, gitignored):
`control-room.visual-Home-s-d9024-activity-and-a-loan-summary-desktop/home-desktop.png` and
`…-mobile/home-mobile.png` now show the solid rail/tab-bar glyphs and the lighter canvas, matching
`artifacts/desktop-concepts-v2/03-home.png` / `artifacts/mobile-concepts/03-home.png`.

## Left deliberately

- **Rail gradient (item 3)** — flat token vs concept gradient; see the punch-list reason.
- **Record circled-plus badge and Manage gear/people glyph (item 4)** — requires substituting a
  *different* Lucide icon, which is a design decision rather than the named filled-vs-outline
  treatment. Filling the bare `Plus`/`Settings2` would change the badge, not the glyph.
- **Auth illustration panel tone (item 5)** — pairs with a mint-toned raster asset; needs a new
  token + re-tinted artwork.
- **ⓘ info affordance (item 6)** — new interactive element.
- **Font rendering (item 7)** — not reachable from CSS; explicitly P3 in design-qa.md.
- **Helper text 13 px (item 8)** — a documented global; the measured delta is ~5 %, inside
  rendering noise. Changing it would cascade over every screen for no clear gain.
- **Active mobile tab underline (item 9)**, **accent-outline secondary buttons (item 10)**,
  **decorative tiles / two-tone wordmark / rail caption (item 11)** — new elements, copy, or
  component variants; out of "cosmetic only" and not self-consistent between sheets.
- **Layout/data deltas** (Plan register row count, Home trend chart type, wallet-history date
  format, Household masked names) — covered as reviewed and accepted by design-qa.md §"Source and
  data limits"; not CSS drift.

## Limitations

- The concept sheets are generated artwork, not screenshots, so their colours are gradients with
  anti-aliasing noise. Token comparisons therefore use strip averages / exact histograms over
  large flat regions, not single-pixel reads; single-pixel reads were used only for the rail and
  canvas, both of which were cross-checked across 3–6 sheets.
- The concept rail's vertical gradient means no flat token can be "correct"; the rail token was
  left unchanged (item 3).
- The canvas change is a 2-level nudge; it is a real, measured match but is deliberately subtle
  to preserve card hierarchy. It is not a pixel-exact repaint of the concept canvas.
- The filled-treatment rule is a `fill: currentColor` override on Lucide's `fill="none"`
  presentation attribute. That is well-defined CSS precedence (author rules beat presentation
  attributes), and the outcome was verified by rendering each path filled in Chromium and by the
  e2e captures above — but there is no automated *visual* diff test for it (no new e2e spec is
  allowed), so the guard is the colocated stylesheet test plus manual inspection.
- No push, no full e2e suite, no SQL/migration, no `package.json` change.

final result: passed
