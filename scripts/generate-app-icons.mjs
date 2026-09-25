// Renders the installable-app icons in public/icons/ from inline SVG using
// Playwright's Chromium (already a dev dependency), so no image tool is
// added. Colors are the control-room tokens (src/control-room.css).
// Re-run after changing the artwork:  node scripts/generate-app-icons.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));
const ACCENT = '#177f63';
const ACCENT_STRONG = '#0d5d48';
const ACCENT_SOFT = '#e2f2ec';
const WHITE = '#ffffff';

// A wallet on the accent ground, drawn in a 100-unit box. Its diagonal is
// ~63 units, inside the 80-unit safe circle a maskable icon must respect.
const WALLET = `
  <rect x="24" y="33" width="52" height="38" rx="7" fill="${WHITE}"/>
  <path d="M28 33 L62 24 Q66 23 67 27 L69 33 Z" fill="${ACCENT_SOFT}"/>
  <rect x="56" y="45" width="20" height="14" rx="5" fill="${ACCENT}"/>
  <circle cx="63" cy="52" r="2.6" fill="${WHITE}"/>`;

const MINUS = `<rect x="28" y="45" width="44" height="10" rx="5" fill="${WHITE}"/>`;
const PLUS = `${MINUS}<rect x="45" y="28" width="10" height="44" rx="5" fill="${WHITE}"/>`;

function svg(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" style="display:block">${body}</svg>`;
}

const rounded = (glyph) => `<rect width="100" height="100" rx="22" fill="${ACCENT_STRONG}"/>${glyph}`;
const fullBleed = (glyph) => `<rect width="100" height="100" fill="${ACCENT_STRONG}"/>${glyph}`;
const circle = (glyph) => `<circle cx="50" cy="50" r="50" fill="${ACCENT_STRONG}"/>${glyph}`;

const ICONS = [
  { file: 'icon-192.png', size: 192, body: rounded(WALLET) },
  { file: 'icon-512.png', size: 512, body: rounded(WALLET) },
  { file: 'icon-maskable-512.png', size: 512, body: fullBleed(WALLET) },
  // iOS masks the corners itself and shows transparency as black.
  { file: 'apple-touch-icon.png', size: 180, body: fullBleed(WALLET) },
  { file: 'shortcut-expense-96.png', size: 96, body: circle(MINUS) },
  { file: 'shortcut-income-96.png', size: 96, body: circle(PLUS) },
];

mkdirSync(OUT_DIR, { recursive: true });
// Same browser channel as playwright.config.ts (the installed Google Chrome).
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(icon.size, icon.body)}</body></html>`);
    await page.screenshot({
      path: `${OUT_DIR}${icon.file}`,
      omitBackground: true,
      clip: { x: 0, y: 0, width: icon.size, height: icon.size },
    });
    console.log(`wrote public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
