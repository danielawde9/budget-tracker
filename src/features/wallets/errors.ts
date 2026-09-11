export type WalletErrorCode =
  | 'missing_membership'
  | 'already_has_name'
  | 'invalid_name'
  | 'wallet_archived'
  | 'already_archived'
  | 'not_archived'
  | 'non_zero_balance'
  | 'request_collision'
  | 'unknown';

export interface WalletErrorView {
  code: WalletErrorCode;
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

export function classifyWalletError(cause: unknown): WalletErrorView {
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
  if (/the wallet already has this name/i.test(message)) {
    return {
      code: 'already_has_name',
      message: 'This wallet already has this name.',
      recovery: 'Choose a different name, or close without saving.',
    };
  }
  if (/the wallet name must be 1 to 120 characters/i.test(message)) {
    return {
      code: 'invalid_name',
      message: 'Enter a name between 1 and 120 characters.',
      recovery: 'Shorten or complete the name and try again.',
    };
  }
  if (/the wallet is already archived/i.test(message)) {
    return {
      code: 'already_archived',
      message: 'This wallet is already archived.',
      recovery: 'Refresh the wallet list to see its current state.',
    };
  }
  if (/the wallet is not archived/i.test(message)) {
    return {
      code: 'not_archived',
      message: 'This wallet is not archived.',
      recovery: 'Refresh the wallet list to see its current state.',
    };
  }
  if (/the wallet is archived/i.test(message)) {
    return {
      code: 'wallet_archived',
      message: 'This wallet is archived.',
      recovery: 'Restore it first, then try again.',
    };
  }
  if (/the wallet balance must be zero to archive/i.test(message)) {
    return {
      code: 'non_zero_balance',
      message: 'This wallet still has money in it.',
      recovery: 'Undo or move its transactions until the balance is 0.',
    };
  }
  if (/request ID was already used with different data/i.test(message)) {
    return {
      code: 'request_collision',
      message: 'This request no longer matches the original details.',
      recovery: 'Review the current values and submit them as a new request.',
    };
  }
  return {
    code: 'unknown',
    message: 'This wallet request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}

const arabicCopy: Record<WalletErrorCode, Pick<WalletErrorView, 'message' | 'recovery'>> = {
  missing_membership: {
    message: 'لم يعد لديك وصول إلى هذه المساحة.',
    recovery: 'حدّث المساحات المتاحة، ثم اختر مساحة لا يزال بإمكانك الوصول إليها.',
  },
  already_has_name: {
    message: 'تحمل هذه المحفظة هذا الاسم بالفعل.',
    recovery: 'اختر اسمًا مختلفًا، أو أغلق دون حفظ.',
  },
  invalid_name: {
    message: 'أدخل اسمًا بين حرف واحد و120 حرفًا.',
    recovery: 'قصّر الاسم أو أكمله وحاول مجددًا.',
  },
  wallet_archived: {
    message: 'هذه المحفظة مؤرشفة.',
    recovery: 'استعدها أولًا، ثم حاول مجددًا.',
  },
  already_archived: {
    message: 'هذه المحفظة مؤرشفة بالفعل.',
    recovery: 'حدّث قائمة المحافظ لعرض حالتها الحالية.',
  },
  not_archived: {
    message: 'هذه المحفظة غير مؤرشفة.',
    recovery: 'حدّث قائمة المحافظ لعرض حالتها الحالية.',
  },
  non_zero_balance: {
    message: 'لا تزال هذه المحفظة تحتوي على مال.',
    recovery: 'تراجع عن معاملاتها أو انقلها حتى يصبح الرصيد صفرًا.',
  },
  request_collision: {
    message: 'لم يعد هذا الطلب يطابق التفاصيل الأصلية.',
    recovery: 'راجع القيم الحالية وأرسلها كطلب جديد.',
  },
  unknown: {
    message: 'لم يتم قبول طلب المحفظة.',
    recovery: 'راجع التفاصيل وحاول مجددًا. إذا استمرت المشكلة، فحدّث المساحة المحددة.',
  },
};

export function localizeWalletError(error: WalletErrorView, locale: 'en' | 'ar'): WalletErrorView {
  if (locale === 'en') return error;
  return { code: error.code, ...arabicCopy[error.code] };
}
