import { HouseholdInvitationDeliveryError } from './invitation-delivery.js';

export type HouseholdErrorKind =
  | 'access-lost'
  | 'invitation-unavailable'
  | 'last-owner'
  | 'request-conflict'
  | 'invalid-input'
  | 'request-failed'
  | 'rate-limited'
  | 'invitation-ambiguous'
  | 'invitation-conflict'
  | 'delivery-unavailable';

export interface HouseholdErrorView {
  readonly kind: HouseholdErrorKind;
  readonly message: string;
  readonly recovery: string;
}

function errorFields(cause: unknown): { code: string; message: string } {
  if (!cause || typeof cause !== 'object') return { code: '', message: '' };
  const value = cause as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === 'string' ? value.code : '',
    message: typeof value.message === 'string' ? value.message : '',
  };
}

const english: Record<HouseholdErrorKind, Omit<HouseholdErrorView, 'kind'>> = {
  'access-lost': {
    message: 'You no longer have permission to manage this household.',
    recovery: 'Refresh your visible spaces and choose one you can still access.',
  },
  'invitation-unavailable': {
    message: 'This invitation is unavailable.',
    recovery: 'Ask a household owner to create a new invitation record.',
  },
  'last-owner': {
    message: 'Every household must keep an active owner.',
    recovery: 'Promote another member before changing or ending this owner access.',
  },
  'request-conflict': {
    message: 'This request no longer matches the original action.',
    recovery: 'Close this action, review the latest household state, and try again.',
  },
  'invalid-input': {
    message: 'The household details were not accepted.',
    recovery: 'Review the entered details and try again.',
  },
  'request-failed': {
    message: 'The household request was not accepted.',
    recovery: 'Check the current household access and try again.',
  },
  'rate-limited': {
    message: 'Too many invitation attempts.',
    recovery: 'Wait a minute, then use Send again.',
  },
  'invitation-ambiguous': {
    message: "This invitation's delivery state is unclear.",
    recovery: 'Cancel the pending invitation and create a new one.',
  },
  'invitation-conflict': {
    message: 'This invitation could not be sent.',
    recovery: 'An invitation may already be pending for this address. Cancel the pending invitation, then create it again.',
  },
  'delivery-unavailable': {
    message: 'Invitation delivery is not available in this environment.',
    recovery: 'Use the deployed application to send household invitations.',
  },
};

const arabic: Record<HouseholdErrorKind, Omit<HouseholdErrorView, 'kind'>> = {
  'access-lost': {
    message: 'لم تعد لديك صلاحية لإدارة هذه المساحة المنزلية.',
    recovery: 'حدّث المساحات المتاحة واختر مساحة لا يزال بإمكانك الوصول إليها.',
  },
  'invitation-unavailable': {
    message: 'هذه الدعوة غير متاحة.',
    recovery: 'اطلب من مالك المساحة المنزلية إنشاء سجل دعوة جديد.',
  },
  'last-owner': {
    message: 'يجب أن يبقى لكل مساحة منزلية مالك فعّال.',
    recovery: 'رقِّ عضوًا آخر قبل تغيير صلاحية هذا المالك أو إنهائها.',
  },
  'request-conflict': {
    message: 'لم يعد هذا الطلب يطابق الإجراء الأصلي.',
    recovery: 'أغلق الإجراء وراجع أحدث حالة للمساحة ثم حاول مجددًا.',
  },
  'invalid-input': {
    message: 'لم يتم قبول تفاصيل المساحة المنزلية.',
    recovery: 'راجع التفاصيل المدخلة وحاول مجددًا.',
  },
  'request-failed': {
    message: 'لم يتم قبول طلب المساحة المنزلية.',
    recovery: 'تحقق من صلاحيات المساحة المنزلية الحالية وحاول مجددًا.',
  },
  'rate-limited': {
    message: 'محاولات الدعوة كثيرة جدًا.',
    recovery: 'انتظر دقيقة ثم استخدم الإرسال مجددًا.',
  },
  'invitation-ambiguous': {
    message: 'حالة إرسال هذه الدعوة غير واضحة.',
    recovery: 'ألغِ الدعوة المعلّقة وأنشئها من جديد.',
  },
  'invitation-conflict': {
    message: 'تعذّر إرسال هذه الدعوة.',
    recovery: 'قد تكون دعوة معلّقة موجودة لهذا العنوان بالفعل. ألغِ الدعوة المعلّقة ثم أنشئها من جديد.',
  },
  'delivery-unavailable': {
    message: 'إرسال الدعوات غير متاح في هذه البيئة.',
    recovery: 'استخدم التطبيق المنشور لإرسال دعوات المنزل.',
  },
};

export function classifyHouseholdError(cause: unknown): HouseholdErrorView {
  if (cause instanceof HouseholdInvitationDeliveryError) {
    return { kind: deliveryErrorKind(cause.code), ...english[deliveryErrorKind(cause.code)] };
  }
  const { code, message } = errorFields(cause);
  let kind: HouseholdErrorKind = 'request-failed';
  if (code === '42501' || /not_authenticated|not_authorized/.test(message)) kind = 'access-lost';
  else if (/invitation_unavailable/.test(message)) kind = 'invitation-unavailable';
  else if (/last_owner/.test(message)) kind = 'last-owner';
  else if (/idempotency_conflict/.test(message)) kind = 'request-conflict';
  else if (/invalid_input|personal_space_prohibited|membership_(?:already_)?active|invitation_already_pending/.test(message)) kind = 'invalid-input';
  return { kind, ...english[kind] };
}

function deliveryErrorKind(code: string): HouseholdErrorKind {
  if (code === 'invalid_authorization') return 'access-lost';
  if (code === 'rate_limited') return 'rate-limited';
  if (code === 'delivery_status_ambiguous') return 'invitation-ambiguous';
  if (code === 'invitation_command_rejected') return 'invitation-conflict';
  if (code === 'not_found' || code === 'invalid_configuration' || code === 'origin_rejected') return 'delivery-unavailable';
  return 'request-failed';
}

export function localizeHouseholdError(error: HouseholdErrorView, locale: 'en' | 'ar'): HouseholdErrorView {
  return locale === 'en' ? error : { kind: error.kind, ...arabic[error.kind] };
}
