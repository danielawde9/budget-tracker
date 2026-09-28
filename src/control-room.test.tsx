import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Colocated guard for `control-room.css` (named `.test.tsx` for the worktree's
 * "colocated test for anything you touch" rule; it reads a stylesheet, it does
 * not render). Pins the two P3 cosmetic decisions recorded in
 * `docs/verification/2026-09-28-w1b-cosmetic.md`:
 *
 * 1. the canvas token is the concepts' neutral near-white (`--cr-bg`);
 * 2. the rail/tab-bar navigation, brand mark, and space-switcher house glyphs
 *    carry the concepts' *filled* treatment.
 *
 * The repo's browser-level style guard is `e2e/primary-button.visual.spec.ts`;
 * no new e2e spec is added here, so this is the cheapest regression guard the
 * owned paths allow.
 */
const css = readFileSync(join(process.cwd(), 'src', 'control-room.css'), 'utf8');
const flat = css.replace(/\s+/g, ' ');

function hexToken(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match?.[1]) throw new Error(`token ${name} not found in control-room.css`);
  return match[1].toLowerCase();
}

function channels(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

describe('control-room canvas token', () => {
  it('stays a neutral near-white like the concept sheets', () => {
    const { r, g, b } = channels(hexToken('--cr-bg'));
    // The concept canvas is a neutral near-white: its blue channel is within
    // two of red. The old #f6f7f3 was 3 below red (a yellow cast).
    expect(Math.abs(r - b)).toBeLessThanOrEqual(2);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    // Still decisively darker than the white card, so cards stay raised.
    expect(r).toBeGreaterThanOrEqual(0xf6);
    expect(r).toBeLessThan(0xff);
  });
});

describe('filled navigation glyphs', () => {
  it('fills the nav tabs, the brand mark, and the space-switcher house', () => {
    expect(flat).toContain(
      '.cr-shell .cr-brand svg, .cr-shell .cr-tab svg, .cr-shell .cr-rail .space-switcher-icon { fill: currentColor; }',
    );
  });

  it('leaves the bare Record plus and the switcher chevron unfilled', () => {
    // A filled plus or chevron would read as a different badge, not the
    // concept's glyph, so neither selector may be in a fill rule.
    expect(flat).not.toMatch(/\.cr-fab[\s\S]{0,40}\{ fill: currentColor/);
    expect(flat).not.toMatch(/\.space-switcher-chevron[\s\S]{0,40}\{ fill: currentColor/);
  });
});
