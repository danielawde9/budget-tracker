export type CategoryErrorCode =
  | 'missing_membership'
  | 'duplicate_name'
  | 'invalid_category'
  | 'request_collision'
  | 'already_archived'
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
  return {
    code: 'unknown',
    message: 'The category request was not accepted.',
    recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
  };
}
