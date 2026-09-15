import type { Currency } from '../loans/types.js';

/** `available_cash_summary`'s own state discriminator (task 17's exact
 * contract, cross-checked against the committed migration). `ready` is the
 * only state where the money fields below are ever non-null; `unplanned`
 * (no published snapshot yet) and `incomplete` (missing materialization or
 * a backlog over the 500-row cap) both return every reservation/available/
 * spendable/guide field as `null` -- never a guessed positive allowance. */
export type CashSummaryState = 'ready' | 'unplanned' | 'incomplete';

/** `cash_outlook` has no snapshot concept, so it never reports `unplanned` --
 * only `ready` or `incomplete` (missing materialization / backlog over cap
 * within the requested window). */
export type CashOutlookState = 'ready' | 'incomplete';

export type CashOutlookScenario = 'expected' | 'no_future_income';

/** One `available_cash_summary` group row (task 17's exact key list, capped
 * at 12 groups). `unpaidBillsMinor`/`goalOverlapMinor` are `null` for a
 * Future-purpose group -- that breakdown only applies to spending groups. */
export interface AvailableCashGroupRow {
  readonly id: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly budgetRemainingMinor: string;
  readonly unpaidBillsMinor: string | null;
  readonly goalOverlapMinor: string | null;
  readonly commitmentMinor: string;
}

/** `available_cash_summary`'s exact JSON keys, per `17-available-cash-db.md`
 * and cross-checked against `supabase/migrations/20260914180000_available_
 * cash_projection.sql`'s `jsonb_build_object` call -- never an invitation to
 * infer fields from a screenshot. `cashMinor`/`goalClaimsMinor`/
 * `receivedIncomeMinor`/`ordinarySpendingMinor`/`incomeMinusSpendingMinor`/
 * `uncategorizedMinor`/`daysRemaining`/`unmaterializedCount` are always
 * present regardless of state; every other money field and `groups` are
 * null/empty unless `state === 'ready'`. A server arithmetic/coverage error
 * must fail the response -- this DTO never substitutes a default allowance
 * for a missing required field. */
export interface AvailableCashSummary {
  readonly currency: Currency;
  readonly asOf: string;
  readonly state: CashSummaryState;
  readonly needsReview: boolean;
  readonly snapshotId: string | null;
  readonly cashMinor: string;
  readonly goalClaimsMinor: string;
  readonly expenseCommitmentsMinor: string | null;
  readonly debtCommitmentsMinor: string | null;
  readonly goalTopupsMinor: string | null;
  readonly futureHeadroomMinor: string | null;
  readonly availableMinor: string | null;
  readonly deficitMinor: string | null;
  readonly spendableMinor: string | null;
  readonly dailyExtraGuideMinor: string | null;
  readonly daysRemaining: number;
  readonly receivedIncomeMinor: string;
  readonly ordinarySpendingMinor: string;
  readonly incomeMinusSpendingMinor: string;
  readonly uncategorizedMinor: string;
  readonly unmaterializedCount: number;
  readonly groups: readonly AvailableCashGroupRow[];
}

export interface LoadAvailableInput {
  readonly spaceId: string;
  readonly currency: Currency;
  readonly asOfDate: string;
}

/** One `cash_outlook` day row -- forecast points, never posted wallet
 * balances. */
export interface CashOutlookDay {
  readonly date: string;
  readonly openingCashMinor: string;
  readonly expectedIncomeMinor: string;
  readonly expectedOutflowMinor: string;
  readonly closingCashMinor: string;
}

/** `cash_outlook`'s exact JSON keys, per `17-available-cash-db.md` plus the
 * `overdueCount`/`overdueMinor` pair the migration's own task-17 fix rounds
 * added on top of the brief's original field list (verified against the
 * committed SQL, not the brief prose, per this task's own instruction). */
export interface CashOutlook {
  readonly currency: Currency;
  readonly startDate: string;
  readonly scenario: CashOutlookScenario;
  readonly assumption: string;
  readonly days: readonly CashOutlookDay[];
  readonly firstNegativeDate: string | null;
  readonly state: CashOutlookState;
  readonly overdueCount: number;
  readonly overdueMinor: string;
}

export interface LoadOutlookInput {
  readonly spaceId: string;
  readonly currency: Currency;
  readonly startDate: string;
  readonly days: number;
  readonly scenario: CashOutlookScenario;
}

/** Read-only application boundary for cash-control: exactly the two
 * projection RPCs task 17 exposes, each accepting an optional `AbortSignal`.
 * No mutation, no generic arbitrary-RPC escape hatch, and (unlike the
 * recurring/goals gateways) no command receipt/idempotency machinery --
 * there is no command here to make idempotent. */
export interface CashControlGateway {
  loadAvailable(input: LoadAvailableInput, signal?: AbortSignal): Promise<AvailableCashSummary>;
  loadOutlook(input: LoadOutlookInput, signal?: AbortSignal): Promise<CashOutlook>;
}
