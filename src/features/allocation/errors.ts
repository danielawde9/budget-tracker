export type AllocationErrorCode =
  | 'missing_membership'
  | 'invalid_input'
  | 'idempotency_conflict'
  | 'stale_revision'
  | 'foreign_snapshot'
  | 'invalid_root_mapping'
  | 'group_identity_conflict'
  | 'invalid_template'
  | 'incomplete_submission'
  | 'group_overallocated'
  | 'invalid_loan_group'
  | 'loan_commitment_misfit'
  | 'month_not_ended'
  | 'close_requires_plan'
  | 'copy_source_not_found'
  | 'range_too_large'
  | 'rollover_requires_expense_root'
  | 'rollover_archived_root'
  | 'domain_rejection'
  | 'timeout'
  | 'unknown';

export interface AllocationErrorView {
  readonly code: AllocationErrorCode;
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

export function classifyAllocationError(cause: unknown): AllocationErrorView {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';

  if (code === '42501' || /planning_not_authorized|planning_history_immutable|planning_command_required|active space membership|permission denied/i.test(message)) {
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
  // Month transitions (task 21). These message checks must sit ahead of the
  // broad `22023` invalid-input branch below: `budget_month_not_ended` is
  // raised with SQLSTATE 22023 too, and without this a manager would see the
  // generic "one of the entered values is not valid" line.
  if (/budget_month_not_ended/i.test(message)) {
    return {
      code: 'month_not_ended',
      message: 'This month has not ended yet.',
      recovery: 'Close a month only after its last day has passed, then try again.',
    };
  }
  if (/budget_month_close_requires_plan/i.test(message)) {
    return {
      code: 'close_requires_plan',
      message: 'This month has no published plan to close.',
      recovery: 'Publish this month’s plan first, then close it.',
    };
  }
  if (/month_copy_source_not_found/i.test(message)) {
    return {
      code: 'copy_source_not_found',
      message: 'That saved month could not be found to copy.',
      recovery: 'Reload the month history and choose a saved month that still exists.',
    };
  }
  if (/range_too_large/i.test(message)) {
    return {
      code: 'range_too_large',
      message: 'This month has too many transactions to close at once.',
      recovery: 'Split the period or contact support before closing this month.',
    };
  }
  if (/rollover_policy_requires_expense_root/i.test(message)) {
    return {
      code: 'rollover_requires_expense_root',
      message: 'Carry can only be turned on for a top-level expense category.',
      recovery: 'Choose an active expense category that has no parent.',
    };
  }
  if (/rollover_policy_archived_root/i.test(message)) {
    return {
      code: 'rollover_archived_root',
      message: 'This category is archived, so carry cannot be turned on for it.',
      recovery: 'Restore the category, or leave carry off for it.',
    };
  }
  // A Plan head that moved under a publish is raised by
  // `set_monthly_income_plan`/`set_monthly_category_target` as P0001 with
  // this message, not 40001 (final review M5).
  if (code === '40001' || /planning_stale_revision|the monthly budget plan has changed/i.test(message)) {
    return {
      code: 'stale_revision',
      message: 'This plan changed elsewhere.',
      recovery: 'Reload the current version and review it before saving again.',
    };
  }
  if (/the requested snapshot does not belong to this space, currency, and month/i.test(message)) {
    return {
      code: 'foreign_snapshot',
      message: 'That saved month could not be found.',
      recovery: 'Reload the month and pick a snapshot from its own history.',
    };
  }
  if (/every root mapping must reference an active root expense category/i.test(message)) {
    return {
      code: 'invalid_root_mapping',
      message: 'A mapped category is no longer an active root expense category.',
      recovery: 'Refresh the categories and remove or replace the affected mapping.',
    };
  }
  if (/a submitted group id already exists with a different space, currency, or purpose/i.test(message)) {
    return {
      code: 'group_identity_conflict',
      message: 'One of these groups already exists with different details elsewhere.',
      recovery: 'Use a new group, or match the existing group’s currency and purpose exactly.',
    };
  }
  if (/the selected template does not belong to this space and currency/i.test(message)) {
    return {
      code: 'invalid_template',
      message: 'The selected plan template is no longer valid for this space and currency.',
      recovery: 'Reload the setup and choose the current template.',
    };
  }
  if (/every template-mapped root and existing positive target must be included/i.test(message)) {
    return {
      code: 'incomplete_submission',
      message: 'This submission is missing a category that still needs a target.',
      recovery: 'Include every mapped category, and enter 0 explicitly to stop an old target.',
    };
  }
  if (/the requested root targets exceed their spending group target/i.test(message)) {
    return {
      code: 'group_overallocated',
      message: 'These category targets add up to more than their group’s target.',
      recovery: 'Lower one of the category targets, or raise the group’s percentage first.',
    };
  }
  if (/the loan pool group must be an included Future group/i.test(message)) {
    return {
      code: 'invalid_loan_group',
      message: 'Debt payments can only link to a Future-purpose group in this submission.',
      recovery: 'Choose a Future group, or leave the debt pool standalone.',
    };
  }
  if (/the observed loan commitment does not fit its linked Future group/i.test(message)) {
    return {
      code: 'loan_commitment_misfit',
      message: 'The current debt payment is larger than the linked Future group’s target.',
      recovery: 'Raise the Future group’s target, or leave the debt pool standalone.',
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
      message: 'This plan could not be saved because it is no longer internally consistent.',
      recovery: 'Reload the month and rebuild the change from the current saved values.',
    };
  }
  return {
    code: 'unknown',
    message: 'The allocation request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<AllocationErrorCode, Pick<AllocationErrorView, 'message' | 'recovery'>> = {
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
    message: 'تغيّرت هذه الخطة من مكان آخر.',
    recovery: 'أعد تحميل النسخة الحالية وراجعها قبل الحفظ مرة أخرى.',
  },
  foreign_snapshot: {
    message: 'تعذر العثور على ذلك الشهر المحفوظ.',
    recovery: 'أعد تحميل الشهر واختر نسخة من سجله الخاص.',
  },
  invalid_root_mapping: {
    message: 'إحدى الفئات المرتبطة لم تعد فئة رئيسية فعالة للمصروفات.',
    recovery: 'حدّث الفئات وأزل أو استبدل الربط المتأثر.',
  },
  group_identity_conflict: {
    message: 'إحدى هذه المجموعات موجودة بالفعل بتفاصيل مختلفة في مكان آخر.',
    recovery: 'استخدم مجموعة جديدة، أو طابق عملة وغرض المجموعة الحالية تمامًا.',
  },
  invalid_template: {
    message: 'قالب الخطة المحدد لم يعد صالحًا لهذه المساحة والعملة.',
    recovery: 'أعد تحميل الإعداد واختر القالب الحالي.',
  },
  incomplete_submission: {
    message: 'هذا الإرسال ناقص فئة لا تزال بحاجة إلى هدف.',
    recovery: 'أدرج كل فئة مرتبطة، وأدخل 0 صراحةً لإيقاف هدف قديم.',
  },
  group_overallocated: {
    message: 'مجموع أهداف هذه الفئات يتجاوز هدف مجموعتها.',
    recovery: 'خفّض أحد أهداف الفئات، أو ارفع نسبة المجموعة أولًا.',
  },
  invalid_loan_group: {
    message: 'يمكن ربط سداد الديون فقط بمجموعة بغرض «مستقبلي» في هذا الإرسال.',
    recovery: 'اختر مجموعة مستقبلية، أو اترك تجميع الدين مستقلًا.',
  },
  loan_commitment_misfit: {
    message: 'دفعة الدين الحالية أكبر من هدف المجموعة المستقبلية المرتبطة.',
    recovery: 'ارفع هدف المجموعة المستقبلية، أو اترك تجميع الدين مستقلًا.',
  },
  month_not_ended: {
    message: 'لم ينتهِ هذا الشهر بعد.',
    recovery: 'أغلق الشهر فقط بعد انتهاء يومه الأخير، ثم حاول مرة أخرى.',
  },
  close_requires_plan: {
    message: 'لا توجد خطة منشورة لإغلاق هذا الشهر.',
    recovery: 'انشر خطة هذا الشهر أولًا، ثم أغلقه.',
  },
  copy_source_not_found: {
    message: 'تعذر العثور على ذلك الشهر المحفوظ لنسخه.',
    recovery: 'أعد تحميل سجل الأشهر واختر شهرًا محفوظًا لا يزال موجودًا.',
  },
  range_too_large: {
    message: 'يحتوي هذا الشهر على عدد كبير جدًا من الحركات لإغلاقه دفعة واحدة.',
    recovery: 'قسّم الفترة أو تواصل مع الدعم قبل إغلاق هذا الشهر.',
  },
  rollover_requires_expense_root: {
    message: 'يمكن تشغيل الترحيل فقط لفئة مصروفات رئيسية.',
    recovery: 'اختر فئة مصروفات فعالة ليس لها فئة أصليّة.',
  },
  rollover_archived_root: {
    message: 'هذه الفئة مؤرشفة، لذا لا يمكن تشغيل الترحيل لها.',
    recovery: 'استعد الفئة، أو اترك الترحيل متوقفًا لها.',
  },
  domain_rejection: {
    message: 'تعذر حفظ هذه الخطة لأنها لم تعد متسقة داخليًا.',
    recovery: 'أعد تحميل الشهر وأعد بناء التغيير من القيم المحفوظة الحالية.',
  },
  timeout: {
    message: 'انتهت مهلة الطلب قبل وصول الرد.',
    recovery: 'انتهاء المهلة بعد الإرسال ليس رفضًا. نتحقق مما إذا كان قد تم تنفيذه.',
  },
  unknown: {
    message: 'لم يتم قبول طلب التخصيص.',
    recovery: 'راجع التفاصيل وحاول مجددًا. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeAllocationError(error: AllocationErrorView, locale: 'en' | 'ar'): AllocationErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
