import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const FEATURES = join(process.cwd(), 'src', 'features');
// A minor-unit value divided by 100n and printed is only right for USD;
// LBP has no minor unit. Use minorToMajorText / formatMinorAmount instead.
const CURRENCY_BLIND = /[Mm]inor[^;\n]*\/\s*100n\s*\)?\s*\.toString\(\)/;

function sourceFiles(dir: string, depth: number): string[] {
  if (depth > 4) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, depth + 1);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('money conversion ratchet', () => {
  it('never prints a minor-unit amount divided by 100n without its currency', () => {
    const offenders = sourceFiles(FEATURES, 0)
      .filter((path) => CURRENCY_BLIND.test(readFileSync(path, 'utf8')))
      .map((path) => relative(FEATURES, path));
    expect(offenders).toEqual([]);
  });
});
