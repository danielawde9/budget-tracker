import { render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryBudgetRow, InsightsClient } from '../insights/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { InMemoryCashControlGateway } from '../../test/in-memory-cash-control-gateway.js';
import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryHouseholdGateway } from '../../test/in-memory-household-gateway.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';
import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import { setActiveSpaceClock, type SpaceClock } from '../workspace/space-clock.js';
import { ControlRoomRoutes } from './routes.js';
import type { ControlRoomGateways } from './routes.js';

/**
 * W4a-1: the app has ONE clock.
 *
 * Audit `docs/verification/2026-09-25-linking-audit.md` §3.5 (E1/E7) and §6:
 * before this slice Home's/Plan's month was browser-local and cash control's
 * "today" was UTC, so in Beirut from 00:00-03:00 the two named different months.
 * The predecessor of this file pinned that split; it is deliberately rewritten
 * here to prove the opposite: the month and the as-of date both come from the
 * server-supplied space clock, whatever the browser's own clock says.
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

/** Renders Home at a fixed instant with a fixed server clock and reports the
 * month the app chose (via Home's insights read) plus the as-of date it sent to
 * cash control. */
async function observeClocksAt(instant: string, clock: SpaceClock): Promise<{ month: string; asOf: string }> {
  vi.setSystemTime(new Date(instant));
  setActiveSpaceClock(clock);
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
  const month = insights.monthCalls[0] ?? '';
  const asOf = (cashControl.calls.find((call) => call.name === 'loadAvailable')?.input as { asOfDate?: string } | undefined)?.asOfDate ?? '';
  return { month, asOf };
}

function browserLocalMonth(instantNow: Date): string {
  return `${instantNow.getFullYear()}-${String(instantNow.getMonth() + 1).padStart(2, '0')}-01`;
}

describe('Control Room one clock under Asia/Beirut (UTC+3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveSpaceClock(null);
  });

  it('uses the server month and as-of date, not the browser clock, across local midnight', async () => {
    // 2026-09-30 21:30 UTC is 2026-10-01 00:30 in Beirut: October locally,
    // still September in UTC -- the audit's "Beirut 00:00-03:00" window.
    const { month, asOf } = await observeClocksAt('2026-09-30T21:30:00.000Z', {
      timezone: 'UTC', today: '2026-09-30', currentMonth: '2026-09-01',
    });

    // The browser clock really is a different month here...
    expect(browserLocalMonth(new Date())).toBe('2026-10-01');
    // ...but the screen follows the server clock, so both agree on September.
    expect(month).toBe('2026-09-01');
    expect(asOf).toBe('2026-09-30');
  });

  it('follows a server zone that is ahead of the browser clock', async () => {
    // 2026-09-15 12:00 UTC is still 15 September in Beirut, but already the
    // 16th in a UTC+14 space.
    const { month, asOf } = await observeClocksAt('2026-09-15T12:00:00.000Z', {
      timezone: 'Pacific/Kiritimati', today: '2026-09-16', currentMonth: '2026-09-01',
    });

    expect(asOf).toBe('2026-09-16');
    expect(month).toBe('2026-09-01');
  });
});
