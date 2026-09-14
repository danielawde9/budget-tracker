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
  if (code === '40001' || /planning_stale_revision/i.test(message)) {
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
