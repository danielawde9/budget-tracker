import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import type { RpcBuilder, RpcResult } from '../planning-shared/rpc.js';
import { AutoMaterializeBanner } from './auto-materialize-banner.js';
import { autoSettleRecordedEvent, type AutoSettleOutcome } from './auto-settle.js';
import { SettleNoticeBanner } from './settle-notice-banner.js';
import { settleLoanRepayment } from './settle-loan-repayment.js';
import { createSupabaseRecurringGateway, type RecurringDataClient } from './supabase-recurring-gateway.js';
import { useAutoMaterialize } from './use-auto-materialize.js';

// Final review I1: every real server-side failure of auto-settle, loan settle
// and auto-generate was shown as "[object Object]". These tests run the REAL
// gateway and `planningRpc` over a client shaped like supabase-js, whose
// `error` is the plain JSON object PostgREST returned -- the shape the pinned
// postgrest-js (2.116.0) produces, never an `Error` instance.

const SPACE_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const LOAN_ID = '55555555-5555-4555-8555-555555555555';
const LINK_REFUSED = postgrestRejection('P0001', 'a payment cannot be linked before its effective date has occurred');

function supabaseShapedClient(handler: (name: string) => RpcResult): RecurringDataClient {
  return {
    rpc(name) {
      const builder: RpcBuilder = {
        abortSignal() { return builder; },
        then(onFulfilled, onRejected) { return Promise.resolve(handler(name)).then(onFulfilled, onRejected); },
      };
      return builder;
    },
  };
}

function occurrence(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111', scheduleId: '22222222-2222-4222-8222-222222222222',
    sourceRevisionId: '1', currentEventId: null, currency: 'USD', kind: 'expense', nameEn: 'Internet', nameAr: 'إنترنت',
    dueDate: '2026-09-20', expectedMinor: '6000', settledMinor: '0', remainingMinor: '6000', state: 'pending', overdue: true,
    categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null, fundingShortfallMinor: null, asOf: '2026-09-26',
    ...overrides,
  };
}

const page = (rows: readonly Record<string, unknown>[]) => ({ data: { rows, hasMore: false, nextCursor: null, asOf: '2026-09-26' }, error: null });

/** Serves the window and overdue lists, and answers every link with `link`. */
function gatewayServing(windowRows: readonly Record<string, unknown>[], link: () => RpcResult) {
  return createSupabaseRecurringGateway(supabaseShapedClient((name) => {
    if (name === 'scheduled_occurrence_page') return page(windowRows);
    if (name === 'scheduled_overdue_page') return page([]);
    if (name === 'link_scheduled_payment') return link();
    throw new Error(`unexpected rpc ${name}`);
  }));
}

function bannerText(outcome: AutoSettleOutcome, locale: 'en' | 'ar'): string {
  const { unmount } = render(<SettleNoticeBanner locale={locale} outcome={outcome} onDismiss={vi.fn()} />);
  const text = screen.getByRole('status').textContent ?? '';
  unmount();
  return text;
}

describe('server failures reach the person as bilingual copy, never "[object Object]"', () => {
  it('auto-settle carries the classified link refusal and the notice localizes it', async () => {
    const gateway = gatewayServing([occurrence({})], () => ({ data: null, error: LINK_REFUSED }));
    const outcome = await autoSettleRecordedEvent(gateway, SPACE_ID, {
      eventId: EVENT_ID, eventKind: 'expense', categoryId: null, amountMinor: '6000', currency: 'USD', effectiveDate: '2026-09-27',
    }, () => null);

    expect(outcome).toEqual({ status: 'failed', error: expect.objectContaining({ code: 'effective_date_not_occurred' }) });
    const english = bannerText(outcome, 'en');
    expect(english).toContain("Couldn't mark the bill as paid: A payment can’t be recorded before its effective date has occurred.");
    const arabic = bannerText(outcome, 'ar');
    expect(arabic).toContain('تعذر تعليم الفاتورة كمدفوعة: لا يمكن تسجيل دفعة قبل حلول تاريخها الفعلي.');
    for (const text of [english, arabic]) expect(text).not.toContain('[object Object]');
    // No raw (English) server text inside the Arabic sentence.
    expect(arabic.replace('تجاهل', '')).not.toMatch(/[A-Za-z]/);
  });

  it('loan settle carries the classified refusal when its first link fails', async () => {
    const gateway = gatewayServing(
      [occurrence({ kind: 'debt_payment', loanId: LOAN_ID, nameEn: 'Karim', nameAr: 'كريم' })],
      () => ({ data: null, error: LINK_REFUSED }),
    );
    const outcome = await settleLoanRepayment(gateway, SPACE_ID, {
      eventId: EVENT_ID, loanId: LOAN_ID, amountMinor: '6000', currency: 'USD', effectiveDate: '2026-09-27',
    });

    expect(outcome).toEqual({ status: 'failed', error: expect.objectContaining({ code: 'effective_date_not_occurred' }) });
    expect(bannerText(outcome, 'en')).not.toContain('[object Object]');
  });

  it('loan settle carries the classified refusal in a partial outcome, and both locales word it', async () => {
    let links = 0;
    const gateway = gatewayServing(
      [
        occurrence({ kind: 'debt_payment', loanId: LOAN_ID, nameEn: 'Karim', nameAr: 'كريم', dueDate: '2026-08-20' }),
        occurrence({ id: '66666666-6666-4666-8666-666666666666', kind: 'debt_payment', loanId: LOAN_ID, nameEn: 'Karim', nameAr: 'كريم' }),
      ],
      () => {
        links += 1;
        return links === 1
          ? { data: { occurrenceId: '11111111-1111-4111-8111-111111111111', occurrenceEventId: '9', financialEventId: EVENT_ID }, error: null }
          : { data: null, error: LINK_REFUSED };
      },
    );
    const outcome = await settleLoanRepayment(gateway, SPACE_ID, {
      eventId: EVENT_ID, loanId: LOAN_ID, amountMinor: '12000', currency: 'USD', effectiveDate: '2026-09-27',
    });

    expect(outcome).toEqual(expect.objectContaining({
      status: 'partial', linkedCount: 1, error: expect.objectContaining({ code: 'effective_date_not_occurred' }),
    }));
    const english = bannerText(outcome, 'en');
    expect(english).toContain('A payment can’t be recorded before its effective date has occurred.');
    const arabic = bannerText(outcome, 'ar');
    expect(arabic).toContain('لا يمكن تسجيل دفعة قبل حلول تاريخها الفعلي.');
    for (const text of [english, arabic]) expect(text).not.toContain('[object Object]');
    expect(arabic.replace('تجاهل', '')).not.toMatch(/[A-Za-z]/);
  });

  it('auto-generate carries the classified refusal and its alert localizes it', async () => {
    const gateway = createSupabaseRecurringGateway(supabaseShapedClient((name) => {
      if (name === 'materialize_schedule_occurrences') {
        return { data: null, error: postgrestRejection('P0001', 'materializing this range would create more than 500 new occurrences') };
      }
      throw new Error(`unexpected rpc ${name}`);
    }));
    const { result } = renderHook(() => useAutoMaterialize({
      gateway, spaceId: SPACE_ID, today: '2026-09-26', needed: true, onGenerated: vi.fn(async () => undefined),
    }));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current).toEqual({ status: 'failed', error: expect.objectContaining({ code: 'materialize_cap_exceeded' }) });

    const { unmount } = render(<AutoMaterializeBanner locale="en" state={result.current} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Upcoming bills couldn't be generated: That date range would generate too many occurrences at once.");
    unmount();
    render(<AutoMaterializeBanner locale="ar" state={result.current} />);
    const arabic = screen.getByRole('alert').textContent ?? '';
    expect(arabic).toContain('تعذر توليد الفواتير القادمة: سيؤدي هذا النطاق الزمني إلى إنشاء عدد كبير جدًا من الدفعات دفعة واحدة.');
    expect(arabic).not.toContain('[object Object]');
    expect(arabic).not.toMatch(/[A-Za-z]/);
  });
});
