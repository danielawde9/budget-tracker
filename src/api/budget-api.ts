import type { z } from 'zod';
import type { Currency } from '../lib/money.ts';
import * as s from './schemas.ts';

/**
 * The only door from the browser to the money model: one method per database
 * function. Inputs carry bigint money (sent as exact strings); outputs are
 * validated with zod and carry bigint money. Every failure becomes a
 * BudgetError with a stable code the UI can translate.
 */

export interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

/** The slice of supabase-js the API needs (keeps tests free of network). */
export interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): { abortSignal(signal: AbortSignal): PromiseLike<RpcResult> };
}

export class BudgetError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(code: string, detail: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.name = 'BudgetError';
    this.code = code;
    this.detail = detail;
  }
}

const TIMEOUT_MS = 15_000;

function parseDetail(details: unknown): Record<string, unknown> {
  if (typeof details !== 'string' || details.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** PostgREST returns plain objects ({code, message, details}), never Error instances. */
export function toBudgetError(error: unknown): BudgetError {
  if (error instanceof BudgetError) return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = typeof record['message'] === 'string' ? record['message'] : '';
    if (/^BUDGET_[A-Z0-9_]+$/.test(message)) return new BudgetError(message, parseDetail(record['details']));
    if (record['name'] === 'AbortError' || record['name'] === 'TimeoutError' || /fetch|network/i.test(message)) {
      return new BudgetError('NETWORK');
    }
  }
  return new BudgetError('UNKNOWN');
}

function encode(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, encode(inner)]));
  }
  return value;
}

export interface Move {
  readonly from: string | null;
  readonly to: string | null;
  readonly currency: Currency;
  readonly amount: bigint;
}

export interface PlanItemInput {
  readonly itemId: string | null;
  readonly kind: 'spending' | 'reserve' | 'goal' | 'loan_payment';
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly monthly: bigint;
  readonly target: bigint | null;
  readonly targetDate: string | null;
  readonly walletId: string | null;
}

export interface PlanGroupInput {
  readonly groupId: string | null;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly percentBps: number;
  readonly items: readonly PlanItemInput[];
}

export interface PlanInput {
  readonly expectedIncome: bigint;
  readonly groups: readonly PlanGroupInput[];
  readonly archiveItemIds: readonly string[];
  readonly archiveGroupIds: readonly string[];
}

interface Command {
  readonly spaceId: string;
  readonly requestId: string;
}

export type InvestmentAction = 'contribute' | 'withdraw' | 'value' | 'fee' | 'income_cash' | 'income_reinvested';
export type LoanAction = 'borrow' | 'repay' | 'lend' | 'collect';

export function createBudgetApi(client: RpcClient) {
  async function call<T extends z.ZodType>(name: string, args: Record<string, unknown>, schema: T): Promise<z.output<T>> {
    let result: RpcResult;
    try {
      result = await client.rpc(name, encode(args) as Record<string, unknown>).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    } catch (error) {
      throw toBudgetError(error);
    }
    if (result.error) throw toBudgetError(result.error);
    const parsed = schema.safeParse(result.data);
    if (!parsed.success) throw new BudgetError('BAD_RESPONSE', { rpc: name });
    return parsed.data;
  }

  const cmd = (input: Command) => ({ p_space: input.spaceId, p_request: input.requestId });

  return {
    // Reads
    mySpaces: () => call('my_spaces', {}, s.spaceSummary.array()),
    clockToday: (timezone = 'Asia/Beirut') => call('clock_today', { p_timezone: timezone }, s.spaceSummary.shape.today),
    overview: (spaceId: string) => call('space_overview', { p_space: spaceId }, s.overview),
    planMonth: (spaceId: string, month: string) => call('plan_month', { p_space: spaceId, p_month: month }, s.planMonth),
    fundingPreview: (spaceId: string, month: string, currency?: Currency, amount?: bigint) =>
      call('funding_preview', { p_space: spaceId, p_month: month, p_currency: currency ?? null, p_amount: amount ?? null }, s.fundingPreview),
    itemStatement: (spaceId: string, itemId: string, month: string) =>
      call('item_statement', { p_space: spaceId, p_item: itemId, p_month: month }, s.itemStatement),
    activity: (spaceId: string, options: { limit?: number; before?: s.ActivityCursor | null; filter?: Record<string, string> } = {}) =>
      call('activity_page', { p_space: spaceId, p_limit: options.limit ?? 30, p_before: options.before ?? null, p_filter: options.filter ?? {} }, s.activityPage),
    accounts: (spaceId: string) => call('accounts_overview', { p_space: spaceId }, s.accounts),
    billsUpcoming: (spaceId: string, from: string, to: string) =>
      call('bills_upcoming', { p_space: spaceId, p_from: from, p_to: to }, s.billOccurrence.array()),
    billsList: (spaceId: string) => call('bills_list', { p_space: spaceId }, s.bill.array()),

    // Commands
    createSpace: (input: { requestId: string; name: string; expectedIncome: bigint; timezone?: string }) =>
      call('create_space', {
        p_request: input.requestId, p_name: input.name, p_expected_income_minor: input.expectedIncome, p_timezone: input.timezone ?? 'Asia/Beirut',
      }, s.spaceResult),
    createWallet: (input: Command & { name: string; kind: s.WalletKind; currency: Currency; opening: bigint; openedOn?: string | null; loanDirection?: 'i_owe' | 'owed_to_me' | null; counterparty?: string | null }) =>
      call('create_wallet', {
        ...cmd(input), p_name: input.name, p_kind: input.kind, p_currency: input.currency, p_opening_minor: input.opening,
        p_opened_on: input.openedOn ?? null, p_loan_direction: input.loanDirection ?? null, p_counterparty: input.counterparty ?? null,
      }, s.walletResult),
    updateWallet: (input: Command & { walletId: string; name: string; archived: boolean }) =>
      call('update_wallet', { ...cmd(input), p_wallet: input.walletId, p_name: input.name, p_archived: input.archived }, s.walletResult.pick({ walletId: true })),
    assignMoney: (input: Command & { on: string; moves: readonly Move[]; opening?: boolean; memo?: string | null }) =>
      call('assign_money', {
        ...cmd(input), p_on: input.on, p_opening: input.opening ?? false, p_memo: input.memo ?? null,
        p_moves: input.moves.map((move) => ({ from: move.from, to: move.to, currency: move.currency, amountMinor: move.amount })),
      }, s.entryResult),
    recordIncome: (input: Command & { walletId: string; amount: bigint; on: string; memo?: string | null; itemId?: string | null }) =>
      call('record_income', {
        ...cmd(input), p_wallet: input.walletId, p_amount: input.amount, p_on: input.on, p_memo: input.memo ?? null, p_item: input.itemId ?? null,
      }, s.entryResult),
    recordExpense: (input: Command & { walletId: string; itemId: string; amount: bigint; on: string; memo?: string | null; coverFrom?: string | null; billId?: string | null; billDue?: string | null }) =>
      call('record_expense', {
        ...cmd(input), p_wallet: input.walletId, p_item: input.itemId, p_amount: input.amount, p_on: input.on, p_memo: input.memo ?? null,
        p_cover_from: input.coverFrom ?? null, p_bill: input.billId ?? null, p_bill_due: input.billDue ?? null,
      }, s.coveredResult),
    recordRefund: (input: Command & { walletId: string; itemId: string; amount: bigint; on: string; memo?: string | null }) =>
      call('record_refund', { ...cmd(input), p_wallet: input.walletId, p_item: input.itemId, p_amount: input.amount, p_on: input.on, p_memo: input.memo ?? null }, s.entryResult),
    recordTransfer: (input: Command & { fromWalletId: string; toWalletId: string; amount: bigint; on: string; memo?: string | null }) =>
      call('record_transfer', { ...cmd(input), p_from: input.fromWalletId, p_to: input.toWalletId, p_amount: input.amount, p_on: input.on, p_memo: input.memo ?? null }, s.entryResult),
    recordExchange: (input: Command & { fromWalletId: string; fromAmount: bigint; toWalletId: string; toAmount: bigint; itemId: string | null; on: string; memo?: string | null }) =>
      call('record_exchange', {
        ...cmd(input), p_from: input.fromWalletId, p_from_amount: input.fromAmount, p_to: input.toWalletId, p_to_amount: input.toAmount,
        p_item: input.itemId, p_on: input.on, p_memo: input.memo ?? null,
      }, s.entryResult),
    recordInvestment: (input: Command & { action: InvestmentAction; investmentId: string; amount: bigint; on: string; cashWalletId?: string | null; itemId?: string | null; coverFrom?: string | null; memo?: string | null }) =>
      call('record_investment', {
        ...cmd(input), p_action: input.action, p_investment: input.investmentId, p_amount: input.amount, p_on: input.on,
        p_cash: input.cashWalletId ?? null, p_item: input.itemId ?? null, p_cover_from: input.coverFrom ?? null, p_memo: input.memo ?? null,
      }, s.coveredResult.partial({ covered: true })),
    recordLoan: (input: Command & { action: LoanAction; loanId: string; on: string; principal: bigint; interest?: bigint; fee?: bigint; cashWalletId: string; itemId?: string | null; coverFrom?: string | null; memo?: string | null; billId?: string | null; billDue?: string | null }) =>
      call('record_loan', {
        ...cmd(input), p_action: input.action, p_loan: input.loanId, p_on: input.on, p_principal: input.principal,
        p_interest: input.interest ?? 0n, p_fee: input.fee ?? 0n, p_cash: input.cashWalletId, p_item: input.itemId ?? null,
        p_cover_from: input.coverFrom ?? null, p_memo: input.memo ?? null, p_bill: input.billId ?? null, p_bill_due: input.billDue ?? null,
      }, s.coveredResult.partial({ covered: true })),
    reverseEntry: (input: Command & { entryId: string; reason: string }) =>
      call('reverse_entry', { ...cmd(input), p_entry: input.entryId, p_reason: input.reason }, s.entryResult),
    saveBill: (input: Command & { billId?: string | null; name: string; itemId: string; amount: bigint; currency: Currency; cadence: 'monthly' | 'yearly' | 'once'; firstDue: string; end?: string | null; loanId?: string | null; archived?: boolean }) =>
      call('save_bill', {
        ...cmd(input), p_name: input.name, p_item: input.itemId, p_amount: input.amount, p_currency: input.currency, p_cadence: input.cadence,
        p_first_due: input.firstDue, p_end: input.end ?? null, p_loan: input.loanId ?? null, p_bill: input.billId ?? null, p_archived: input.archived ?? false,
      }, s.billResult),
    skipBill: (input: Command & { billId: string; due: string }) =>
      call('skip_bill', { ...cmd(input), p_bill: input.billId, p_due: input.due }, s.billResult),
    setReferenceRate: (input: Command & { unitsPerUsd: string; effective: string }) =>
      call('set_reference_rate', { ...cmd(input), p_currency: 'LBP', p_units_per_usd: input.unitsPerUsd, p_effective: input.effective }, s.okResult),
    savePlan: (input: Command & { month: string; expectedRevision: number | null; plan: PlanInput }) =>
      call('save_plan', {
        ...cmd(input), p_month: input.month, p_expected_revision: input.expectedRevision,
        p_plan: {
          expectedIncomeMinor: input.plan.expectedIncome,
          archiveItemIds: input.plan.archiveItemIds,
          archiveGroupIds: input.plan.archiveGroupIds,
          groups: input.plan.groups.map((group) => ({
            groupId: group.groupId, nameEn: group.nameEn, nameAr: group.nameAr, percentBps: group.percentBps,
            items: group.items.map((item) => ({
              itemId: item.itemId, kind: item.kind, nameEn: item.nameEn, nameAr: item.nameAr, monthlyMinor: item.monthly,
              targetMinor: item.target, targetDate: item.targetDate, walletId: item.walletId,
            })),
          })),
        },
      }, s.planResult),
  };
}

export type BudgetApi = ReturnType<typeof createBudgetApi>;
