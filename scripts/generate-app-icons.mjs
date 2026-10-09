// Packages generated ledger artwork as a logo, favicons, and app icons.
// Chromium's canvas supplies deterministic raster sizing without dependencies
// or screenshot timing. Re-run: node scripts/generate-app-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const SOURCE = fileURLToPath(new URL('../assets/brand/open-budget-tracker-source.png', import.meta.url));
const logoData = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`;

mkdirSync(`${PUBLIC_DIR}icons`, { recursive: true });
mkdirSync(`${PUBLIC_DIR}brand`, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(async (source) => {
    const logo = new Image();
    logo.src = source;
    await logo.decode();
    await document.fonts.ready;
    const output = [];

    function surface(width, height = width) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('A canvas context is required to package brand assets.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      return { canvas, ctx };
    }
    function save(file, canvas) {
      output.push({ file, data: canvas.toDataURL('image/png').split(',')[1] });
    }

    for (const [file, size, fullBleed, maskable] of [
      ['favicon-16.png', 16, false, false],
      ['favicon-32.png', 32, false, false],
      ['favicon-48.png', 48, false, false],
      ['icon-192.png', 192, false, false],
      ['icon-512.png', 512, false, false],
      ['icon-maskable-512.png', 512, true, true],
      ['apple-touch-icon.png', 180, true, false],
    ]) {
      const { canvas, ctx } = surface(size);
      ctx.fillStyle = '#e2f2ec';
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, fullBleed ? 0 : size * 0.22);
      ctx.fill();
      // Including the source's transparent margin, 72% puts all artwork
      // inside the central 80% safe circle required by maskable icons.
      const artSize = size * (maskable ? 0.72 : 1);
      const inset = (size - artSize) / 2;
      ctx.drawImage(logo, inset, inset, artSize, artSize);
      save(`icons/${file}`, canvas);
    }

    // Preserve the existing plus/minus shortcut artwork independently of
    // the new brand symbol.
    for (const [file, income] of [['shortcut-expense-96.png', false], ['shortcut-income-96.png', true]]) {
      const { canvas, ctx } = surface(96);
      ctx.scale(0.96, 0.96);
      ctx.fillStyle = '#0d5d48';
      ctx.beginPath();
      ctx.arc(50, 50, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(28, 45, 44, 10, 5);
      ctx.fill();
      if (income) {
        ctx.beginPath();
        ctx.roundRect(45, 28, 10, 44, 5);
        ctx.fill();
      }
      save(`icons/${file}`, canvas);
    }

    const mark = surface(128);
    mark.ctx.drawImage(logo, 0, 0, 128, 128);
    save('brand/logo-mark.png', mark.canvas);

    const name = 'Open Budget Tracker';
    const font = "800 48px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
    mark.ctx.font = font;
    const wordmark = surface(Math.ceil(mark.ctx.measureText(name).width) + 140, 128);
    wordmark.ctx.drawImage(logo, 8, 8, 112, 112);
    wordmark.ctx.font = font;
    wordmark.ctx.fillStyle = '#0d5d48';
    wordmark.ctx.textBaseline = 'middle';
    wordmark.ctx.fillText(name, 132, 64);
    save('brand/logo.png', wordmark.canvas);
    return output;
  }, logoData);

  for (const image of images) {
    writeFileSync(`${PUBLIC_DIR}${image.file}`, Buffer.from(image.data, 'base64'));
    console.log(`wrote public/${image.file}`);
  }

  // ICO supports PNG payloads. Supply actual 16, 32, and 48px entries for
  // tabs and desktop shortcuts rather than renaming a PNG to .ico.
  const sizes = [16, 32, 48];
  const entries = sizes.map(size => readFileSync(`${PUBLIC_DIR}icons/favicon-${size}.png`));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, bytes] of entries.entries()) {
    const entry = 6 + index * 16;
    header[entry] = sizes[index];
    header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  }
  writeFileSync(`${PUBLIC_DIR}favicon.ico`, Buffer.concat([header, ...entries]));
  console.log('wrote public/favicon.ico');
} finally {
  await browser.close();
}
