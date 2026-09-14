export type GoalsErrorCode =
  | 'missing_membership'
  | 'invalid_input'
  | 'idempotency_conflict'
  | 'stale_revision'
  | 'foreign_goal'
  | 'goal_limit_reached'
  | 'immutable_kind_or_currency'
  | 'earmark_must_be_zero_to_close'
  | 'milestone_kind_locked'
  | 'milestone_state_conflict'
  | 'requires_active_goal'
  | 'underfunded_confirmation_required'
  | 'earmark_amount_out_of_range'
  | 'currency_mismatch'
  | 'reversal_not_available'
  | 'invalid_expense_for_link'
  | 'purchase_link_rejected'
  | 'incomplete_goal_submission'
  | 'invalid_goal_group_link'
  | 'domain_rejection'
  | 'timeout'
  | 'unknown';

export interface GoalsErrorView {
  readonly code: GoalsErrorCode;
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

export function classifyGoalsError(cause: unknown): GoalsErrorView {
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
  if (/goal_underfunded_confirmation_required/i.test(message)) {
    return {
      code: 'underfunded_confirmation_required',
      message: 'This reserve would claim more than the space currently has in cash.',
      recovery: 'Acknowledge the shortfall to reserve anyway, or lower the amount.',
    };
  }
  if (code === '40001' || /planning_stale_revision/i.test(message)) {
    return {
      code: 'stale_revision',
      message: 'This goal changed elsewhere.',
      recovery: 'Reload the current version and review it before saving again.',
    };
  }
  if (/does not belong to the requested space|is not currently relevant|must belong to the requested space/i.test(message)) {
    return {
      code: 'foreign_goal',
      message: 'That goal could not be found in this space.',
      recovery: 'Reload the goal list and pick a current goal.',
    };
  }
  if (/already has 100 active or paused goals|already has 200 goals/i.test(message)) {
    return {
      code: 'goal_limit_reached',
      message: 'This space has reached its limit of goals in this currency.',
      recovery: 'Close or complete an existing goal before creating another.',
    };
  }
  if (/a goal revision cannot change its kind or currency/i.test(message)) {
    return {
      code: 'immutable_kind_or_currency',
      message: 'A goal’s kind and currency can’t be changed after it’s created.',
      recovery: 'Create a new goal instead if you need a different kind or currency.',
    };
  }
  if (/closing a goal requires its current earmark to be zero/i.test(message)) {
    return {
      code: 'earmark_must_be_zero_to_close',
      message: 'This goal still has money reserved against it.',
      recovery: 'Release or move the remaining reserve before closing this goal.',
    };
  }
  if (/a milestone with checklist history cannot change kind/i.test(message)) {
    return {
      code: 'milestone_kind_locked',
      message: 'This milestone already has checklist history, so its kind can’t change.',
      recovery: 'Add a new milestone instead of changing this one’s kind.',
    };
  }
  if (/already in the requested state|cannot be reopened|only a checklist milestone in the current definition/i.test(message)) {
    return {
      code: 'milestone_state_conflict',
      message: 'This milestone’s checklist state no longer matches what you last saw.',
      recovery: 'Reload the goal and try the checklist action again.',
    };
  }
  if (/requires an active goal/i.test(message)) {
    return {
      code: 'requires_active_goal',
      message: 'This action needs the goal to be active.',
      recovery: 'Reopen the goal first, or choose an action available to a paused goal.',
    };
  }
  if (/a move requires both goals to share a currency|a linked goal must share the expense/i.test(message)) {
    return {
      code: 'currency_mismatch',
      message: 'These currencies don’t match.',
      recovery: 'Choose goals and expenses that share the same currency.',
    };
  }
  if (/exceeds the goal.s remaining room|exceeds the goal.s current earmark|exceeds the source goal.s current earmark|exceeds the destination goal.s remaining room/i.test(message)) {
    return {
      code: 'earmark_amount_out_of_range',
      message: 'That amount no longer fits this goal’s current balance.',
      recovery: 'Reload the goal’s current figures and enter an amount that fits.',
    };
  }
  if (/cannot be reversed|already has a reversal|expected heads must name exactly/i.test(message)) {
    return {
      code: 'reversal_not_available',
      message: 'This entry can no longer be reversed as described.',
      recovery: 'Reload the goal’s history to see its current, reversible entries.',
    };
  }
  if (/unreversed expense in this space|single-currency|loan-linked event cannot be linked/i.test(message)) {
    return {
      code: 'invalid_expense_for_link',
      message: 'This expense can’t be linked to a goal.',
      recovery: 'Choose a plain, unreversed, single-currency expense to link.',
    };
  }
  if (/effective date has occurred|would make an earlier or current goal balance negative|linked amounts cannot exceed/i.test(message)) {
    return {
      code: 'purchase_link_rejected',
      message: 'This purchase can’t be linked as requested.',
      recovery: 'Reload the goal’s balance history and adjust the linked amount or goal.',
    };
  }
  if (/every existing positive goal target must be included|existing positive goal targets must be included/i.test(message)) {
    return {
      code: 'incomplete_goal_submission',
      message: 'This submission is missing a goal that still needs a target.',
      recovery: 'Include every goal with a current target, and enter 0 explicitly to stop an old one.',
    };
  }
  if (/goal target must link to an included group|goal target must link to a Future group|exceed their Future group target/i.test(message)) {
    return {
      code: 'invalid_goal_group_link',
      message: 'This goal’s monthly target doesn’t fit the linked group.',
      recovery: 'Link it to an included Future group with enough room, or leave it standalone.',
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
      recovery: 'Reload the goal and rebuild the change from its current saved values.',
    };
  }
  return {
    code: 'unknown',
    message: 'The goal request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<GoalsErrorCode, Pick<GoalsErrorView, 'message' | 'recovery'>> = {
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
    message: 'تغيّر هذا الهدف من مكان آخر.',
    recovery: 'أعد تحميل النسخة الحالية وراجعها قبل الحفظ مرة أخرى.',
  },
  foreign_goal: {
    message: 'تعذر العثور على هذا الهدف في هذه المساحة.',
    recovery: 'أعد تحميل قائمة الأهداف واختر هدفًا حاليًا.',
  },
  goal_limit_reached: {
    message: 'بلغت هذه المساحة الحد الأقصى للأهداف بهذه العملة.',
    recovery: 'أغلق أو أكمل هدفًا موجودًا قبل إنشاء هدف آخر.',
  },
  immutable_kind_or_currency: {
    message: 'لا يمكن تغيير نوع الهدف أو عملته بعد إنشائه.',
    recovery: 'أنشئ هدفًا جديدًا إذا كنت بحاجة إلى نوع أو عملة مختلفة.',
  },
  earmark_must_be_zero_to_close: {
    message: 'لا يزال هذا الهدف يحتوي على مبلغ محجوز.',
    recovery: 'حرّر أو انقل المبلغ المتبقي قبل إغلاق هذا الهدف.',
  },
  milestone_kind_locked: {
    message: 'يحتوي هذا المعلم على سجل قائمة تحقق بالفعل، فلا يمكن تغيير نوعه.',
    recovery: 'أضف معلمًا جديدًا بدلًا من تغيير نوع هذا المعلم.',
  },
  milestone_state_conflict: {
    message: 'لم تعد حالة قائمة التحقق لهذا المعلم مطابقة لآخر ما رأيته.',
    recovery: 'أعد تحميل الهدف وحاول إجراء قائمة التحقق مرة أخرى.',
  },
  requires_active_goal: {
    message: 'يتطلب هذا الإجراء أن يكون الهدف نشطًا.',
    recovery: 'أعد تنشيط الهدف أولًا، أو اختر إجراءً متاحًا لهدف موقوف مؤقتًا.',
  },
  underfunded_confirmation_required: {
    message: 'سيطالب هذا الحجز بأكثر مما تملكه المساحة حاليًا من نقد.',
    recovery: 'أقرّ بالعجز للحجز على أي حال، أو خفّض المبلغ.',
  },
  earmark_amount_out_of_range: {
    message: 'لم يعد هذا المبلغ يتناسب مع الرصيد الحالي لهذا الهدف.',
    recovery: 'أعد تحميل أرقام الهدف الحالية وأدخل مبلغًا مناسبًا.',
  },
  currency_mismatch: {
    message: 'هاتان العملتان غير متطابقتين.',
    recovery: 'اختر أهدافًا ومصروفات تشترك في العملة نفسها.',
  },
  reversal_not_available: {
    message: 'لم يعد بالإمكان عكس هذا الإدخال كما هو موصوف.',
    recovery: 'أعد تحميل سجل الهدف لرؤية إدخالاته الحالية القابلة للعكس.',
  },
  invalid_expense_for_link: {
    message: 'لا يمكن ربط هذا المصروف بهدف.',
    recovery: 'اختر مصروفًا عاديًا غير معكوس وبعملة واحدة لربطه.',
  },
  purchase_link_rejected: {
    message: 'لا يمكن ربط هذا الشراء كما هو مطلوب.',
    recovery: 'أعد تحميل سجل رصيد الهدف وعدّل المبلغ أو الهدف المرتبط.',
  },
  incomplete_goal_submission: {
    message: 'هذا الإرسال ناقص هدفًا لا يزال بحاجة إلى مبلغ شهري.',
    recovery: 'أدرج كل هدف له مبلغ حالي، وأدخل 0 صراحةً لإيقاف مبلغ قديم.',
  },
  invalid_goal_group_link: {
    message: 'لا يتناسب المبلغ الشهري لهذا الهدف مع المجموعة المرتبطة.',
    recovery: 'اربطه بمجموعة مستقبلية مدرجة ولديها متسع كافٍ، أو اتركه مستقلًا.',
  },
  domain_rejection: {
    message: 'تعذر حفظ هذا التغيير لأنه لم يعد متسقًا داخليًا.',
    recovery: 'أعد تحميل الهدف وأعد بناء التغيير من القيم المحفوظة الحالية.',
  },
  timeout: {
    message: 'انتهت مهلة الطلب قبل وصول الرد.',
    recovery: 'انتهاء المهلة بعد الإرسال ليس رفضًا. نتحقق مما إذا كان قد تم تنفيذه.',
  },
  unknown: {
    message: 'لم يتم قبول طلب الهدف.',
    recovery: 'راجع التفاصيل وحاول مجددًا. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeGoalsError(error: GoalsErrorView, locale: 'en' | 'ar'): GoalsErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
