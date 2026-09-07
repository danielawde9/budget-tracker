import type { LoanErrorView } from './types.js';

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'The database rejected this request.';
}

export function classifyLoanError(error: unknown): LoanErrorView {
  const message = errorMessage(error);

  if (message.includes('wallet must be active')) {
    return {
      code: 'wrong_currency',
      title: 'Choose a matching wallet',
      message,
      recovery: 'Select an active wallet in this space with the same currency as the loan.',
    };
  }

  if (message.includes('repayment exceeds')) {
    return {
      code: 'overpayment',
      title: 'Amount is above the remaining loan',
      message,
      recovery: 'Refresh the loan and enter an amount no higher than the remaining principal.',
    };
  }

  if (message.includes('request ID was already used')) {
    return {
      code: 'retry_collision',
      title: 'This request changed during retry',
      message,
      recovery: 'Review the current ledger, then submit the corrected details as a new request.',
    };
  }

  if (message.includes('active space membership')) {
    return {
      code: 'missing_membership',
      title: 'You no longer have access to this space',
      message,
      recovery: 'Switch spaces or ask a household manager to restore your membership.',
    };
  }

  if (message.includes('invalidate dependent repayments')) {
    return {
      code: 'dependent_repayment',
      title: 'Later repayments depend on this entry',
      message,
      recovery: 'Reverse the later repayments first, then retry this correction.',
    };
  }

  return {
    code: 'database_rejection',
    title: 'The change was not recorded',
    message,
    recovery: 'Review the details, refresh the ledger, and try again.',
  };
}
