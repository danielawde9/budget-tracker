import { render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryBudgetRow, InsightsClient } from '../insights/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { InMemoryCashControlGateway } from '../../test/in-memory-cash-control-gateway.js';
import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryHouseholdGateway } from '../../test/in-memory-household-gateway.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';
import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import { ControlRoomRoutes } from './routes.js';
import type { ControlRoomGateways } from './routes.js';

/**
 * E7 regression net: the app runs on **two clocks** today.
 *
 * Audit `docs/verification/2026-09-25-linking-audit.md` §3.5 (E7) and §6: no
 * test ran in a non-UTC timezone, so the split between the **browser-local**
 * plan month and the **UTC** "today" had no regression net. This file is that
 * net, and it is a *characterisation of the current behaviour*, not a fix --
 * the later one-clock (per-space timezone) work will deliberately rewrite it.
 *
 * The helpers it pins, exactly as they are written today:
 * - Browser-local month start, `currentMonthStart()` in
 *   `src/features/control-room/routes.tsx` (local `getFullYear`/`getMonth`,
 *   feeds the Plan/Home month).
 * - UTC "today", `todayIso()` in `src/features/control-room/routes.tsx`
 *   (also `new Date().toISOString().slice(0, 10)`, feeds `available_cash_summary`
 *   and the occurrence window). NOTE: the task brief places this helper in
 *   `src/features/recurring/occurrence-window.ts`; it is not there. That module
 *   exports only the UTC window helpers `shiftDateIso`/`occurrenceWindow`, which
 *   are pinned separately below.
 *
 * The file establishes the zone itself so it does not depend on, or mutate,
 * `vitest.ui.config.ts`'s global environment.
 */
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = 'Asia/Beirut';

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function capturingInsights(): InsightsClient & { monthCalls: string[] } {
  const monthCalls: string[] = [];
  return {
    monthCalls,
    walletActivity: vi.fn(async () => []),
    categoryActualVsBudget: vi.fn(async (_spaceId: string, month: string) => {
      monthCalls.push(month);
      return [] as readonly CategoryBudgetRow[];
    }),
  };
}

function gateways(overrides: { insights: InsightsClient; cashControl: InMemoryCashControlGateway }): ControlRoomGateways {
  const reports: ReportsGateway = { loadMonthlyComparison: vi.fn(async () => [] as readonly MonthlyCashSummary[]) };
  return {
    wallets: new InMemoryWalletsGateway(),
    loans: new InMemoryLoansGateway(),
    categories: new InMemoryCategoriesGateway(),
    reports,
    household: new InMemoryHouseholdGateway(),
    plan: null,
    insights: overrides.insights,
    exchange: null,
    allocation: null,
    goals: null,
    recurring: null,
    cashControl: overrides.cashControl,
  };
}

/** Renders Home at a fixed instant and reports the local month the app chose
 * (via Home's insights read) plus the UTC as-of date it sent to cash control. */
async function observeClocksAt(instant: string): Promise<{ localMonth: string; utcToday: string }> {
  vi.setSystemTime(new Date(instant));
  const insights = capturingInsights();
  const cashControl = new InMemoryCashControlGateway();
  render(
    <ControlRoomRoutes
      locale="en"
      spaceId="personal-space"
      spaceKind="personal"
      destination="home"
      gateways={gateways({ insights, cashControl })}
      recordOpen={false}
      onCloseRecord={() => undefined}
    />,
  );
  await waitFor(() => expect(cashControl.calls.some((call) => call.name === 'loadAvailable')).toBe(true));
  const localMonth = insights.monthCalls[0] ?? '';
  const utcToday = (cashControl.calls.find((call) => call.name === 'loadAvailable')?.input as { asOfDate?: string } | undefined)?.asOfDate ?? '';
  return { localMonth, utcToday };
}

describe('Control Room two clocks under Asia/Beirut (UTC+3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the browser-local plan month a day ahead of the UTC "today" across local midnight', async () => {
    // 2026-09-30 21:30 UTC is 2026-10-01 00:30 in Beirut: October locally,
    // still September in UTC. This is the audit's "Beirut 00:00-02:00" window.
    const { localMonth, utcToday } = await observeClocksAt('2026-09-30T21:30:00.000Z');

    // Browser-local clock: the plan/Home month already rolled to October.
    expect(localMonth).toBe('2026-10-01');
    // UTC clock: cash control's as-of date is still 30 September.
    expect(utcToday).toBe('2026-09-30');
    // The two clocks name different calendar months -- the defect E1/E2/E7 describes.
    expect(localMonth.slice(0, 7)).not.toBe(utcToday.slice(0, 7));
  });

  it('keeps both clocks on the same month away from local midnight', async () => {
    // 2026-09-15 12:00 UTC is 2026-09-15 15:00 in Beirut: same month both ways.
    const { localMonth, utcToday } = await observeClocksAt('2026-09-15T12:00:00.000Z');

    expect(localMonth).toBe('2026-09-01');
    expect(utcToday).toBe('2026-09-15');
    expect(localMonth.slice(0, 7)).toBe(utcToday.slice(0, 7));
  });
});

describe('pure UTC date helpers stay zone-independent under Asia/Beirut', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T21:30:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('occurrence-window.ts shifts whole UTC days regardless of the local zone', async () => {
    // Dynamically imported AFTER `process.env.TZ` is established, per the
    // brief's guidance for a self-contained zone test.
    const { OCCURRENCE_WINDOW_DAYS, occurrenceWindow, shiftDateIso } = await import('../recurring/occurrence-window.js');

    expect(OCCURRENCE_WINDOW_DAYS).toBe(89);
    expect(shiftDateIso('2026-09-30', 89)).toBe('2026-12-28');
    // The window helper is fed the UTC today, so even though the browser-local
    // day has rolled to 2026-10-01, the window still starts on the UTC day.
    expect(occurrenceWindow('2026-09-30')).toEqual({ fromDate: '2026-09-30', toDate: '2026-12-28' });
    // And the UTC day formula the Control Room and record sheet use for "today".
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-30');
  });
});
