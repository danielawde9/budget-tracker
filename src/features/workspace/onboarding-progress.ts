import type { Currency } from '../loans/types.js';

/**
 * Per-user, resumable record of a first-run setup that has not finished yet.
 *
 * `balanceRequestId` is generated once, when the wizard first opens, and is
 * reused for every attempt of the starting-balance command. `record_financial_event`
 * keys idempotency on `(space_id, request_id)`, so a returning user who retries
 * cannot post the same opening balance twice.
 */
export interface OnboardingProgress {
  spaceId: string;
  balanceRequestId: string;
  /** Opening balance is finished or skipped; resume at the monthly plan. */
  stage?: 'plan';
}

/** A resumed setup plus the created wallet, when it already exists. */
export interface OnboardingSetup extends OnboardingProgress {
  wallet?: { id: string; currency: Currency };
}

export function onboardingProgressKey(userId: string): string {
  return `budget:onboarding:${userId}`;
}

export function readOnboardingProgress(userId: string): OnboardingProgress | null {
  const raw = localStorage.getItem(onboardingProgressKey(userId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Record<'spaceId' | 'balanceRequestId' | 'stage', unknown>>;
    if (typeof value.spaceId !== 'string' || value.spaceId.length === 0) return null;
    if (typeof value.balanceRequestId !== 'string' || value.balanceRequestId.length === 0) return null;
    return { spaceId: value.spaceId, balanceRequestId: value.balanceRequestId, ...(value.stage === 'plan' ? { stage: 'plan' as const } : {}) };
  } catch {
    return null;
  }
}

export function writeOnboardingProgress(userId: string, progress: OnboardingProgress): void {
  localStorage.setItem(onboardingProgressKey(userId), JSON.stringify(progress));
}

export function clearOnboardingProgress(userId: string): void {
  localStorage.removeItem(onboardingProgressKey(userId));
}
