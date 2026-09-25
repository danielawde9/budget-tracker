import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readQuickAddIntent } from './features/quick-add/quick-add.js';

const root = process.cwd();

interface ManifestIcon { src: string; sizes: string; type: string; purpose?: string }
interface Manifest {
  name: string; short_name: string; start_url: string; scope: string; display: string;
  background_color: string; theme_color: string; icons: ManifestIcon[];
  shortcuts: { name: string; url: string; icons?: ManifestIcon[] }[];
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8')) as Manifest;
}

/** Width and height from a PNG's IHDR chunk (bytes 16–23, big-endian). */
function pngSize(path: string): string {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function expectIconOnDisk(icon: ManifestIcon) {
  const path = join(root, 'public', icon.src.replace(/^\//, ''));
  expect(existsSync(path), `${icon.src} exists`).toBe(true);
  expect(icon.type).toBe('image/png');
  expect(pngSize(path)).toBe(icon.sizes);
}

describe('web app manifest', () => {
  it('meets the install criteria: name, start_url, standalone display, 192 and 512 icons', () => {
    const app = manifest();
    expect(app.name).toBe('Budget');
    expect(app.short_name).toBe('Budget');
    expect(app.start_url).toBe('/');
    expect(app.scope).toBe('/');
    expect(app.display).toBe('standalone');
    expect(app.background_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(app.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    const any = app.icons.filter((icon) => (icon.purpose ?? 'any') === 'any').map((icon) => icon.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(app.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
    app.icons.forEach(expectIconOnDisk);
  });

  it('offers Add expense and Add income shortcuts that the app understands', () => {
    const shortcuts = manifest().shortcuts;
    expect(shortcuts.map((shortcut) => shortcut.name)).toEqual(['Add expense', 'Add income']);
    const kinds = shortcuts.map((shortcut) => readQuickAddIntent(new URL(shortcut.url, 'https://budget.example').search));
    expect(kinds).toEqual(['expense', 'income']);
    for (const shortcut of shortcuts) {
      expect(shortcut.url.startsWith('/')).toBe(true);
      (shortcut.icons ?? []).forEach(expectIconOnDisk);
    }
  });

  it('is linked from index.html together with the iPhone home-screen icon', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png" \/>/);
    expect(pngSize(join(root, 'public', 'icons', 'apple-touch-icon.png'))).toBe('180x180');
    expect(html).toContain('<title>Budget</title>');
  });
});
