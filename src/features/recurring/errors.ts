export type RecurringErrorCode =
  | 'missing_membership'
  | 'invalid_input'
  | 'idempotency_conflict'
  | 'stale_revision'
  | 'immutable_kind_or_currency'
  | 'schedule_limit_reached'
  | 'materialize_cap_exceeded'
  | 'foreign_occurrence'
  | 'occurrence_state_conflict'
  | 'ineligible_wallet'
  | 'ineligible_category'
  | 'debt_payment_requires_loan'
  | 'invalid_link_target'
  | 'effective_date_not_occurred'
  | 'allocation_exceeds_eligible'
  | 'domain_rejection'
  | 'timeout'
  | 'unknown';

export interface RecurringErrorView {
  readonly code: RecurringErrorCode;
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

export function isAmbiguousTransportFailure(cause: unknown): boolean {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';
  return code === '55P03' || code === '57014'
    || /network|failed to fetch|load failed|connection|timeout|abort/i.test(message);
}

export function classifyRecurringError(cause: unknown): RecurringErrorView {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';

  if (code === '42501' || /planning_not_authorized|planning_history_immutable|active space membership|permission denied/i.test(message)) {
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
      recovery: 'A timeout after submission is not a rejection. We are checking whether it went through.',
    };
  }
  if (code === '40001' || /planning_stale_revision/i.test(message)) {
    return {
      code: 'stale_revision',
      message: 'This bill or income schedule changed elsewhere.',
      recovery: 'Reload the current version and review it before saving again.',
    };
  }
  if (/a schedule revision cannot change its kind or currency/i.test(message)) {
    return {
      code: 'immutable_kind_or_currency',
      message: 'A schedule’s kind and currency can’t be changed after it’s created.',
      recovery: 'Create a new schedule instead if you need a different kind or currency.',
    };
  }
  if (/this space already has 200 active schedules/i.test(message)) {
    return {
      code: 'schedule_limit_reached',
      message: 'This space has reached its limit of active schedules.',
      recovery: 'Pause or end an existing schedule before activating another.',
    };
  }
  if (/materializing this range would create more than 500 new occurrences/i.test(message)) {
    return {
      code: 'materialize_cap_exceeded',
      message: 'That date range would generate too many occurrences at once.',
      recovery: 'Materialize a shorter date range instead.',
    };
  }
  if (/the occurrence does not belong to the requested space/i.test(message)) {
    return {
      code: 'foreign_occurrence',
      message: 'That bill or income occurrence could not be found in this space.',
      recovery: 'Reload the upcoming list and pick a current occurrence.',
    };
  }
  if (/the occurrence is already skipped|only a skipped occurrence can be reopened|a partially or fully paid occurrence cannot be skipped|a skipped occurrence cannot be confirmed|a skipped occurrence cannot receive a payment link|occurrence_already_skipped|occurrence_not_skipped_for_reopen|occurrence_skipped_rejects_settlement|occurrence_settled_amount_nonzero_for_skip/i.test(message)) {
    return {
      code: 'occurrence_state_conflict',
      message: 'This occurrence’s skip/payment state no longer matches what you last saw.',
      recovery: 'Reload the occurrence and try the action again.',
    };
  }
  if (/the payment wallet must be active and share the occurrence currency/i.test(message)) {
    return {
      code: 'ineligible_wallet',
      message: 'That wallet can’t receive this payment.',
      recovery: 'Choose an active wallet that shares the occurrence’s currency.',
    };
  }
  if (/the referenced category is no longer active or eligible/i.test(message)) {
    return {
      code: 'ineligible_category',
      message: 'The category on this schedule is no longer active or eligible.',
      recovery: 'Reload the schedule and choose a current category before confirming.',
    };
  }
  if (/a debt payment occurrence requires a loan reference|the referenced loan is no longer eligible for this payment/i.test(message)) {
    return {
      code: 'debt_payment_requires_loan',
      message: 'This debt payment needs a valid, currently eligible loan.',
      recovery: 'Reload the schedule and confirm it still references an eligible loan.',
    };
  }
  if (/the referenced event cannot be linked|the referenced event already has a reversal|the referenced event must be single-currency and share the occurrence currency|the referenced event must be a repayment on the occurrence.s own loan|the referenced event must be an expense|the referenced event must be income/i.test(message)) {
    return {
      code: 'invalid_link_target',
      message: 'That transaction can’t be linked to this occurrence.',
      recovery: 'Choose a plain, unreversed transaction that matches this occurrence’s kind and currency.',
    };
  }
  if (/a payment cannot be linked before its effective date has occurred|a payment cannot be confirmed before its effective date has occurred/i.test(message)) {
    return {
      code: 'effective_date_not_occurred',
      message: 'A payment can’t be recorded before its effective date has occurred.',
      recovery: 'Choose today or an earlier date.',
    };
  }
  if (/the linked amount exceeds the referenced event.s remaining eligible amount|occurrence_allocation_exceeds_eligible_amount/i.test(message)) {
    return {
      code: 'allocation_exceeds_eligible',
      message: 'That amount is more than this transaction has left to allocate.',
      recovery: 'Reload the transaction’s remaining eligible amount and enter one that fits.',
    };
  }
  if (code === '22023' || /planning_invalid_input/i.test(message)) {
    return {
      code: 'invalid_input',
      message: 'One of the entered values is not valid.',
      recovery: 'Check the highlighted fields and try again.',
    };
  }
  if (/planning_idempotency_conflict/i.test(message)) {
    return {
      code: 'idempotency_conflict',
      message: 'This request no longer matches the original details.',
      recovery: 'Review the current values and submit them as a new request.',
    };
  }
  if (code === '23514') {
    return {
      code: 'domain_rejection',
      message: 'This change could not be saved because it is no longer internally consistent.',
      recovery: 'Reload the schedule or occurrence and rebuild the change from its current saved values.',
    };
  }
  return {
    code: 'unknown',
    message: 'The recurring request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<RecurringErrorCode, Pick<RecurringErrorView, 'message' | 'recovery'>> = {
  missing_membership: {
    message: 'لم يعد لديك وصول إلى هذه المساحة.',
    recovery: 'حدّث المساحات المتاحة، ثم اختر مساحة لا يزال بإمكانك الوصول إليها.',
  },
  invalid_input: {
    message: 'إحدى القيم المُدخلة غير صالحة.',
    recovery: 'راجع الحقول المميزة وحاول مرة أخرى.',
  },
  idempotency_conflict: {
    message: 'لم يعد هذا الطلب يطابق التفاصيل الأصلية.',
    recovery: 'راجع القيم الحالية وأرسلها كطلب جديد.',
  },
  stale_revision: {
    message: 'تغيّر هذا الجدول من مكان آخر.',
    recovery: 'أعد تحميل النسخة الحالية وراجعها قبل الحفظ مرة أخرى.',
  },
  immutable_kind_or_currency: {
    message: 'لا يمكن تغيير نوع الجدول أو عملته بعد إنشائه.',
    recovery: 'أنشئ جدولًا جديدًا إذا كنت بحاجة إلى نوع أو عملة مختلفة.',
  },
  schedule_limit_reached: {
    message: 'بلغت هذه المساحة الحد الأقصى للجداول النشطة.',
    recovery: 'أوقف أو أنهِ جدولًا موجودًا قبل تنشيط جدول آخر.',
  },
  materialize_cap_exceeded: {
    message: 'سيؤدي هذا النطاق الزمني إلى إنشاء عدد كبير جدًا من الدفعات دفعة واحدة.',
    recovery: 'ولّد نطاقًا زمنيًا أقصر بدلًا من ذلك.',
  },
  foreign_occurrence: {
    message: 'تعذر العثور على هذه الدفعة في هذه المساحة.',
    recovery: 'أعد تحميل القائمة القادمة واختر دفعة حالية.',
  },
  occurrence_state_conflict: {
    message: 'لم تعد حالة التخطي/الدفع لهذه الدفعة مطابقة لآخر ما رأيته.',
    recovery: 'أعد تحميل الدفعة وحاول الإجراء مرة أخرى.',
  },
  ineligible_wallet: {
    message: 'لا يمكن لهذه المحفظة استلام هذه الدفعة.',
    recovery: 'اختر محفظة نشطة تشترك في عملة الدفعة.',
  },
  ineligible_category: {
    message: 'الفئة في هذا الجدول لم تعد نشطة أو مؤهلة.',
    recovery: 'أعد تحميل الجدول واختر فئة حالية قبل التأكيد.',
  },
  debt_payment_requires_loan: {
    message: 'تحتاج دفعة الدين هذه إلى قرض صالح ومؤهل حاليًا.',
    recovery: 'أعد تحميل الجدول وتأكد من أنه لا يزال يشير إلى قرض مؤهل.',
  },
  invalid_link_target: {
    message: 'لا يمكن ربط هذه المعاملة بهذه الدفعة.',
    recovery: 'اختر معاملة عادية غير معكوسة تطابق نوع وعملة هذه الدفعة.',
  },
  effective_date_not_occurred: {
    message: 'لا يمكن تسجيل دفعة قبل حلول تاريخها الفعلي.',
    recovery: 'اختر تاريخ اليوم أو تاريخًا أسبق.',
  },
  allocation_exceeds_eligible: {
    message: 'هذا المبلغ أكبر مما تبقى لتخصيصه من هذه المعاملة.',
    recovery: 'أعد تحميل المبلغ المتبقي المؤهل للمعاملة وأدخل مبلغًا مناسبًا.',
  },
  domain_rejection: {
    message: 'تعذر حفظ هذا التغيير لأنه لم يعد متسقًا داخليًا.',
    recovery: 'أعد تحميل الجدول أو الدفعة وأعد بناء التغيير من القيم المحفوظة الحالية.',
  },
  timeout: {
    message: 'انتهت مهلة الطلب قبل وصول الرد.',
    recovery: 'انتهاء المهلة بعد الإرسال ليس رفضًا. نتحقق مما إذا كان قد تم تنفيذه.',
  },
  unknown: {
    message: 'لم يتم قبول طلب الجدولة المتكررة.',
    recovery: 'راجع التفاصيل وحاول مجددًا. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeRecurringError(error: RecurringErrorView, locale: 'en' | 'ar'): RecurringErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
