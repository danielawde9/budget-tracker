/** Read-only error surface: `available_cash_summary`/`cash_outlook` raise
 * exactly two domain errcodes (`42501 planning_not_authorized`, `22023
 * planning_invalid_input`, per the committed migration) plus whatever the
 * shared transport itself can throw (network/abort/statement-timeout). There
 * is no idempotency conflict, stale revision or domain-rejection code here --
 * this gateway never mutates anything. */
export type CashControlErrorCode =
  | 'missing_membership'
  | 'invalid_input'
  | 'timeout'
  | 'unknown';

export interface CashControlErrorView {
  readonly code: CashControlErrorCode;
  readonly message: string;
  readonly recovery: string;
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

function errorLike(cause: unknown): ErrorLike {
  return cause && typeof cause === 'object' ? cause as ErrorLike : {};
}

/** A transport-level failure whose outcome is genuinely unknown (timeout,
 * network drop, statement-timeout cancel) -- reused unmodified from the
 * shape the recurring/goals gateways already classify this way. For a
 * read-only gateway this never triggers ambiguity/retry-receipt machinery;
 * it just means "the read failed, try again," so the hook surfaces it as a
 * normal retryable error. */
export function isAmbiguousTransportFailure(cause: unknown): boolean {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';
  return code === '55P03' || code === '57014'
    || /network|failed to fetch|load failed|connection|timeout|abort/i.test(message);
}

export function classifyCashControlError(cause: unknown): CashControlErrorView {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';

  if (code === '42501' || /planning_not_authorized|active space membership|permission denied/i.test(message)) {
    return {
      code: 'missing_membership',
      message: 'You no longer have access to this space.',
      recovery: 'Refresh the visible spaces, then choose one you can still access.',
    };
  }
  if (isAmbiguousTransportFailure(cause)) {
    return {
      code: 'timeout',
      message: 'The request timed out before a response arrived.',
      recovery: 'Try loading this view again.',
    };
  }
  if (code === '22023' || /planning_invalid_input/i.test(message)) {
    return {
      code: 'invalid_input',
      message: 'One of the requested values is not valid.',
      recovery: 'Reload with today’s date and a supported scenario.',
    };
  }
  return {
    code: 'unknown',
    message: 'The cash-control view could not be loaded.',
    recovery: 'Try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<CashControlErrorCode, Pick<CashControlErrorView, 'message' | 'recovery'>> = {
  missing_membership: {
    message: 'لم يعد لديك وصول إلى هذه المساحة.',
    recovery: 'حدّث المساحات المتاحة، ثم اختر مساحة لا يزال بإمكانك الوصول إليها.',
  },
  invalid_input: {
    message: 'إحدى القيم المطلوبة غير صالحة.',
    recovery: 'أعد التحميل بتاريخ اليوم وسيناريو مدعوم.',
  },
  timeout: {
    message: 'انتهت مهلة الطلب قبل وصول الرد.',
    recovery: 'حاول تحميل هذا العرض مرة أخرى.',
  },
  unknown: {
    message: 'تعذر تحميل عرض السيولة المتاحة.',
    recovery: 'حاول مرة أخرى. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeCashControlError(error: CashControlErrorView, locale: 'en' | 'ar'): CashControlErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
