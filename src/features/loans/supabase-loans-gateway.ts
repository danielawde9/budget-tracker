import type {
  CommandResult,
  CreateLoanInput,
  Currency,
  CurrencySummary,
  Loan,
  LoanDirection,
  LoanHistoryItem,
  LoanPlan,
  LoansDashboard,
  LoansGateway,
  MonthlyTargetInput,
  RepaymentInput,
  ReversalInput,
  Space,
  Wallet,
} from './types.js';
import { deriveLoanStatus } from './money.js';

const READ_LIMIT = 500;

interface DataError {
  message: string;
  code?: string;
}

interface DataResult {
  data: unknown[] | null;
  error: DataError | null;
}

export interface LoansQueryBuilder {
  select(columns?: string): LoansQueryBuilder;
  eq(column: string, value: unknown): LoansQueryBuilder;
  is(column: string, value: null): LoansQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): LoansQueryBuilder;
  limit(count: number): Promise<DataResult>;
}

export interface LoansDataClient {
  from(relation: string): LoansQueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<DataResult>;
}

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The database returned an invalid row.');
  }
  return value as Row;
}

function textValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') {
    throw new Error(`The database row is missing ${key}.`);
  }
  return result;
}

function nullableText(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string') throw new Error(`The database row has invalid ${key}.`);
  return result;
}

function minorValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result === 'string' && /^-?\d+$/.test(result)) return result;
  if (typeof result === 'number' && Number.isSafeInteger(result)) return String(result);
  throw new Error(`The database row has an unsafe ${key} money value.`);
}

async function rows(resultPromise: Promise<DataResult>, label: string): Promise<Row[]> {
  const result = await resultPromise;
  if (result.error) throw result.error;
  const values = result.data ?? [];
  if (values.length > READ_LIMIT) {
    throw new Error(`${label} has more than ${READ_LIMIT} rows. Narrow the space or archive old data before continuing.`);
  }
  return values.map(row);
}

function query(client: LoansDataClient, relation: string, spaceId?: string): Promise<DataResult> {
  let builder = client.from(relation).select('*');
  if (spaceId) builder = builder.eq('space_id', spaceId);
  return builder.limit(READ_LIMIT + 1);
}

function planFrom(rowValue: Row | undefined): LoanPlan {
  return {
    targetMinor: rowValue ? minorValue(rowValue, 'target_minor') : '0',
    actualRepaymentMinor: rowValue ? minorValue(rowValue, 'actual_repayment_minor') : '0',
    remainingReservationMinor: rowValue ? minorValue(rowValue, 'remaining_reservation_minor') : '0',
    dueAmountMinor: rowValue ? minorValue(rowValue, 'due_amount_minor') : '0',
    expectedCollectionMinor: rowValue ? minorValue(rowValue, 'expected_collection_minor') : '0',
  };
}

function commandResult(data: unknown[] | null): CommandResult {
  const result = data?.[0];
  if (!result) return {};
  const value = row(result);
  return {
    ...(typeof value['event_id'] === 'string' ? { eventId: value['event_id'] } : {}),
    ...(typeof value['loan_id'] === 'string' ? { loanId: value['loan_id'] } : {}),
    ...(typeof value['id'] === 'string' ? { id: value['id'] } : {}),
  };
}

export function createSupabaseLoansGateway(client: LoansDataClient): LoansGateway {
  async function runCommand(name: string, args: Record<string, unknown>): Promise<CommandResult> {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return commandResult(result.data);
  }

  return {
    async listSpaces() {
      const values = await rows(client.from('spaces').select('id,name,kind').order('created_at').limit(READ_LIMIT + 1), 'Spaces');
      return values.map((value): Space => ({
        id: textValue(value, 'id'),
        name: textValue(value, 'name'),
        kind: textValue(value, 'kind') as Space['kind'],
      }));
    },

    async loadDashboard(spaceId, month) {
      const [spaceRows, walletRows, loanRows, balanceRows, eventRows, postingRows, movementRows, planResult, summaryResult] = await Promise.all([
        rows(query(client, 'spaces'), 'Spaces'),
        rows(query(client, 'wallets', spaceId), 'Wallets'),
        rows(query(client, 'loans', spaceId), 'Loans'),
        rows(query(client, 'loan_balances', spaceId), 'Loan balances'),
        rows(query(client, 'financial_events', spaceId), 'Financial events'),
        rows(query(client, 'loan_postings', spaceId), 'Loan postings'),
        rows(query(client, 'wallet_movements', spaceId), 'Wallet movements'),
        rows(client.rpc('loan_monthly_plan', { p_space_id: spaceId, p_month: month }), 'Monthly loan plan'),
        rows(client.rpc('loan_monthly_currency_summary', { p_space_id: spaceId, p_month: month }), 'Monthly currency summary'),
      ]);

      const spaceRow = spaceRows.find((value) => value['id'] === spaceId);
      if (!spaceRow) throw new Error('The selected space is not available.');
      const space: Space = { id: spaceId, name: textValue(spaceRow, 'name'), kind: textValue(spaceRow, 'kind') as Space['kind'] };
      const wallets: Wallet[] = walletRows.map((value) => ({
        id: textValue(value, 'id'), spaceId, name: textValue(value, 'name'),
        currency: textValue(value, 'currency') as Currency, archivedAt: nullableText(value, 'archived_at'),
      }));
      const walletNames = new Map(wallets.map((wallet) => [wallet.id, wallet.name]));
      const balances = new Map(balanceRows.map((value) => [textValue(value, 'loan_id'), minorValue(value, 'outstanding_minor')]));
      const plans = new Map(planResult.map((value) => [textValue(value, 'loan_id'), value]));
      const events = new Map(eventRows.map((value) => [textValue(value, 'id'), value]));
      const reversedBy = new Map<string, string>();
      for (const event of eventRows) {
        const original = nullableText(event, 'reversal_of');
        if (original) reversedBy.set(original, textValue(event, 'id'));
      }
      const movements = new Map(movementRows.map((value) => [textValue(value, 'event_id'), value]));
      const postingsByLoan = new Map<string, Row[]>();
      for (const posting of postingRows) {
        const loanId = textValue(posting, 'loan_id');
        postingsByLoan.set(loanId, [...(postingsByLoan.get(loanId) ?? []), posting]);
      }
      const today = new Date().toISOString().slice(0, 10);

      const loans: Loan[] = loanRows.map((value) => {
        const loanId = textValue(value, 'id');
        const loanPostings = postingsByLoan.get(loanId) ?? [];
        const history = loanPostings.map((posting): LoanHistoryItem => {
          const eventId = textValue(posting, 'event_id');
          const event = events.get(eventId);
          if (!event) throw new Error('Loan history is missing its financial event.');
          const movement = movements.get(eventId);
          return {
            eventId,
            kind: textValue(event, 'kind') as LoanHistoryItem['kind'],
            effectiveDate: textValue(event, 'effective_date'),
            createdAt: textValue(event, 'created_at'),
            principalDeltaMinor: minorValue(posting, 'principal_delta_minor'),
            repaymentEffectMinor: minorValue(posting, 'repayment_effect_minor'),
            walletName: movement ? walletNames.get(textValue(movement, 'wallet_id')) ?? null : null,
            walletAmountMinor: movement ? minorValue(movement, 'amount_minor') : null,
            reversalOf: nullableText(event, 'reversal_of'),
            reversedBy: reversedBy.get(eventId) ?? null,
          };
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const opening = history.find((item) => item.kind !== 'reversal' && BigInt(item.principalDeltaMinor) > 0n);
        const outstandingMinor = balances.get(loanId) ?? '0';
        const totalRepaidMinor = loanPostings.reduce((sum, posting) => sum + BigInt(minorValue(posting, 'repayment_effect_minor')), 0n).toString();
        const dueDate = nullableText(value, 'due_date');
        return {
          id: loanId,
          spaceId,
          direction: textValue(value, 'direction') as LoanDirection,
          personName: textValue(value, 'person_name'),
          currency: textValue(value, 'currency') as Currency,
          effectiveDate: textValue(value, 'effective_date'),
          dueDate,
          note: nullableText(value, 'note'),
          outstandingMinor,
          originalPrincipalMinor: opening?.principalDeltaMinor ?? '0',
          totalRepaidMinor,
          status: deriveLoanStatus(outstandingMinor, dueDate, today),
          plan: planFrom(plans.get(loanId)),
          history,
        };
      });

      const summaries: CurrencySummary[] = summaryResult.map((value) => ({
        currency: textValue(value, 'currency') as Currency,
        owedToMeMinor: minorValue(value, 'owed_to_me_minor'),
        iOweMinor: minorValue(value, 'i_owe_minor'),
        targetMinor: minorValue(value, 'planned_repayment_minor'),
        actualRepaymentMinor: minorValue(value, 'actual_repayment_minor'),
        remainingReservationMinor: minorValue(value, 'remaining_reservation_minor'),
        dueAmountMinor: minorValue(value, 'due_amount_minor'),
        expectedCollectionMinor: minorValue(value, 'expected_collection_minor'),
      }));

      return { space, month, wallets, loans, summaries };
    },

    createLoan(input: CreateLoanInput) {
      if (input.mode === 'opening') {
        return runCommand('open_loan_outstanding', {
          p_space_id: input.spaceId, p_request_id: input.requestId, p_direction: input.direction,
          p_person_name: input.personName, p_currency: input.currency, p_amount_minor: input.amountMinor,
          p_effective_date: input.effectiveDate, p_due_date: input.dueDate, p_note: input.note,
        });
      }
      if (!input.walletId) throw new Error('A wallet is required for a cash loan.');
      return runCommand('record_cash_loan', {
        p_space_id: input.spaceId, p_request_id: input.requestId, p_direction: input.direction,
        p_person_name: input.personName, p_currency: input.currency, p_wallet_id: input.walletId,
        p_amount_minor: input.amountMinor, p_effective_date: input.effectiveDate,
        p_due_date: input.dueDate, p_note: input.note,
      });
    },

    recordRepayment(input: RepaymentInput) {
      return runCommand('record_loan_repayment', {
        p_space_id: input.spaceId, p_request_id: input.requestId, p_loan_id: input.loanId,
        p_wallet_id: input.walletId, p_amount_minor: input.amountMinor, p_effective_date: input.effectiveDate,
      });
    },

    setMonthlyTarget(input: MonthlyTargetInput) {
      return runCommand('set_loan_monthly_target', {
        p_space_id: input.spaceId, p_request_id: input.requestId, p_loan_id: input.loanId,
        p_month: input.month, p_target_minor: input.targetMinor,
      });
    },

    reverseEvent(input: ReversalInput) {
      return runCommand('reverse_financial_event', {
        p_space_id: input.spaceId, p_request_id: input.requestId, p_event_id: input.eventId,
        p_effective_date: input.effectiveDate,
      });
    },
  };
}
