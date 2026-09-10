export type CategoryErrorCode =
  | 'missing_membership'
  | 'duplicate_name'
  | 'invalid_category'
  | 'request_collision'
  | 'already_archived'
  | 'invalid_parent'
  | 'depth_limit'
  | 'active_children'
  | 'unknown';

export interface CategoryErrorView {
  code: CategoryErrorCode;
  message: string;
  recovery: string;
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
  const message = typeof value.message === 'string' ? value.message : '';
  return /network|failed to fetch|load failed|connection|timeout/i.test(message);
}

export function classifyCategoryError(cause: unknown): CategoryErrorView {
  const value = errorLike(cause);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';

  if (code === '42501' || /active space membership|permission denied/i.test(message)) {
    return {
      code: 'missing_membership',
      message: 'You no longer have access to this space.',
      recovery: 'Refresh the visible spaces, then choose one you can still access.',
    };
  }
  if (/active category already uses/i.test(message)) {
    return {
      code: 'duplicate_name',
      message: 'An active category already uses one of these names.',
      recovery: 'Use a different English or Arabic name, or archive the existing category first.',
    };
  }
  if (/must be active, in the requested space, and match|does not belong to the requested space/i.test(message)) {
    return {
      code: 'invalid_category',
      message: 'That category is no longer available for this entry.',
      recovery: 'Refresh the categories and choose an active category of the matching type.',
    };
  }
  if (/request ID was already used with different data/i.test(message)) {
    return {
      code: 'request_collision',
      message: 'This request no longer matches the original details.',
      recovery: 'Review the current values and submit them as a new request.',
    };
  }
  if (/category is already archived/i.test(message)) {
    return {
      code: 'already_archived',
      message: 'This category is already archived.',
      recovery: 'Refresh the category register to see the current active list.',
    };
  }
  if (/parent category must be an active root/i.test(message)) {
    return {
      code: 'invalid_parent',
      message: 'That parent category is no longer available.',
      recovery: 'Refresh the register and choose an active root category.',
    };
  }
  if (/subcategory depth is limited to one level/i.test(message)) {
    return {
      code: 'depth_limit',
      message: 'A subcategory cannot contain another subcategory.',
      recovery: 'Choose an active root category as the parent.',
    };
  }
  if (/archive active subcategories before archiving their parent/i.test(message)) {
    return {
      code: 'active_children',
      message: 'This category still has active subcategories.',
      recovery: 'Archive its active subcategories before archiving the parent.',
    };
  }
  return {
    code: 'unknown',
    message: 'The category request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<CategoryErrorCode, Pick<CategoryErrorView, 'message' | 'recovery'>> = {
  missing_membership: {
    message: 'لم يعد لديك وصول إلى هذه المساحة.',
    recovery: 'حدّث المساحات المتاحة، ثم اختر مساحة لا يزال بإمكانك الوصول إليها.',
  },
  duplicate_name: {
    message: 'تستخدم فئة فعالة أحد هذين الاسمين بالفعل.',
    recovery: 'استخدم اسمًا مختلفًا بالإنجليزية أو العربية، أو أرشف الفئة الحالية أولًا.',
  },
  invalid_category: {
    message: 'لم تعد هذه الفئة متاحة لهذا القيد.',
    recovery: 'حدّث الفئات واختر فئة فعالة من النوع المطابق.',
  },
  request_collision: {
    message: 'لم يعد هذا الطلب يطابق التفاصيل الأصلية.',
    recovery: 'راجع القيم الحالية وأرسلها كطلب جديد.',
  },
  already_archived: {
    message: 'هذه الفئة مؤرشفة بالفعل.',
    recovery: 'حدّث سجل الفئات لعرض القائمة الفعالة الحالية.',
  },
  invalid_parent: {
    message: 'لم تعد الفئة الرئيسية المحددة متاحة.',
    recovery: 'حدّث السجل واختر فئة رئيسية فعالة.',
  },
  depth_limit: {
    message: 'لا يمكن أن تحتوي الفئة الفرعية على فئة فرعية أخرى.',
    recovery: 'اختر فئة رئيسية فعالة كفئة أصلية.',
  },
  active_children: {
    message: 'لا تزال لهذه الفئة فئات فرعية فعالة.',
    recovery: 'أرشف فئاتها الفرعية الفعالة قبل أرشفة الفئة الرئيسية.',
  },
  unknown: {
    message: 'لم يتم قبول طلب الفئة.',
    recovery: 'راجع التفاصيل وحاول مجددًا. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeCategoryError(error: CategoryErrorView, locale: 'en' | 'ar'): CategoryErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
