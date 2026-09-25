import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OCCURRENCE_WINDOW_DAYS, occurrenceWindow } from './occurrence-window.js';

describe('occurrence window', () => {
  it('equals the horizon available_cash_summary requires', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const latest = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
      .filter((name) => /create (or replace )?function public\.available_cash_summary\(/.test(readFileSync(join(dir, name), 'utf8')))
      .at(-1);
    expect(latest).toBeDefined();
    expect(readFileSync(join(dir, latest!), 'utf8')).toContain(`v_horizon_end := v_today + ${OCCURRENCE_WINDOW_DAYS};`);
  });

  it('spans today through today + 89 days', () => {
    expect(occurrenceWindow('2026-09-25')).toEqual({ fromDate: '2026-09-25', toDate: '2026-12-23' });
  });
});
