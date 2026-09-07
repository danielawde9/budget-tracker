import type {
  CommandResult,
  CreateLoanInput,
  LoansDashboard,
  LoansGateway,
  MonthlyTargetInput,
  RepaymentInput,
  ReversalInput,
  Space,
} from '../features/loans/types.js';

export const personalSpace: Space = { id: 'personal-space', name: 'My money', kind: 'personal' };
export const householdSpace: Space = { id: 'household-space', name: 'Home budget', kind: 'household' };

export function loansFixture(space: Space = personalSpace): LoansDashboard {
  return {
    space,
    month: '2026-09-01',
    wallets: [
      { id: 'usd-wallet', spaceId: space.id, name: 'Daily USD', currency: 'USD', archivedAt: null },
      { id: 'lbp-wallet', spaceId: space.id, name: 'Home LBP', currency: 'LBP', archivedAt: null },
    ],
    summaries: [
      {
        currency: 'USD', owedToMeMinor: '75000', iOweMinor: '120000', dueAmountMinor: '120000',
        targetMinor: '50000', actualRepaymentMinor: '20000', remainingReservationMinor: '30000',
        expectedCollectionMinor: '75000',
      },
      {
        currency: 'LBP', owedToMeMinor: '0', iOweMinor: '0', dueAmountMinor: '0',
        targetMinor: '0', actualRepaymentMinor: '0', remainingReservationMinor: '0', expectedCollectionMinor: '0',
      },
    ],
    loans: [
      {
        id: 'maya-loan', spaceId: space.id, direction: 'they_owe_me', personName: 'Maya', currency: 'USD',
        effectiveDate: '2026-07-01', dueDate: '2026-09-30', note: 'Shared trip', outstandingMinor: '75000',
        originalPrincipalMinor: '100000', totalRepaidMinor: '25000', status: 'outstanding',
        plan: { targetMinor: '0', actualRepaymentMinor: '25000', remainingReservationMinor: '0', dueAmountMinor: '0', expectedCollectionMinor: '75000' },
        history: [
          { eventId: 'maya-payment', kind: 'loan_receive_repayment', effectiveDate: '2026-09-05', createdAt: '2026-09-05T12:00:00Z', principalDeltaMinor: '-25000', repaymentEffectMinor: '25000', walletName: 'Daily USD', walletAmountMinor: '25000', reversalOf: null, reversedBy: null },
          { eventId: 'maya-opening', kind: 'loan_lend', effectiveDate: '2026-07-01', createdAt: '2026-07-01T12:00:00Z', principalDeltaMinor: '100000', repaymentEffectMinor: '0', walletName: 'Daily USD', walletAmountMinor: '-100000', reversalOf: null, reversedBy: null },
        ],
      },
      {
        id: 'karim-loan', spaceId: space.id, direction: 'i_owe_them', personName: 'Karim', currency: 'USD',
        effectiveDate: '2026-06-01', dueDate: '2026-09-01', note: null, outstandingMinor: '120000',
        originalPrincipalMinor: '200000', totalRepaidMinor: '80000', status: 'overdue',
        plan: { targetMinor: '50000', actualRepaymentMinor: '20000', remainingReservationMinor: '30000', dueAmountMinor: '120000', expectedCollectionMinor: '0' },
        history: [
          { eventId: 'karim-opening', kind: 'loan_borrow', effectiveDate: '2026-06-01', createdAt: '2026-06-01T12:00:00Z', principalDeltaMinor: '200000', repaymentEffectMinor: '0', walletName: 'Daily USD', walletAmountMinor: '200000', reversalOf: null, reversedBy: null },
        ],
      },
      {
        id: 'rana-loan', spaceId: space.id, direction: 'they_owe_me', personName: 'Rana', currency: 'LBP',
        effectiveDate: '2026-05-01', dueDate: null, note: null, outstandingMinor: '0',
        originalPrincipalMinor: '5000000', totalRepaidMinor: '5000000', status: 'settled',
        plan: { targetMinor: '0', actualRepaymentMinor: '0', remainingReservationMinor: '0', dueAmountMinor: '0', expectedCollectionMinor: '0' },
        history: [],
      },
    ],
  };
}

export class InMemoryLoansGateway implements LoansGateway {
  readonly calls: Array<{ name: string; input?: unknown }> = [];
  readonly spaces = [personalSpace, householdSpace];
  error: Error | null = null;

  async listSpaces() {
    this.calls.push({ name: 'listSpaces' });
    if (this.error) throw this.error;
    return this.spaces;
  }

  async loadDashboard(spaceId: string, month: string) {
    this.calls.push({ name: 'loadDashboard', input: { spaceId, month } });
    if (this.error) throw this.error;
    const space = this.spaces.find((candidate) => candidate.id === spaceId) ?? personalSpace;
    return { ...loansFixture(space), month };
  }

  createLoan(input: CreateLoanInput): Promise<CommandResult> {
    return this.command('createLoan', input, { loanId: 'new-loan', eventId: 'new-event' });
  }

  recordRepayment(input: RepaymentInput): Promise<CommandResult> {
    return this.command('recordRepayment', input, { eventId: 'repayment-event' });
  }

  setMonthlyTarget(input: MonthlyTargetInput): Promise<CommandResult> {
    return this.command('setMonthlyTarget', input, { id: 'target-revision' });
  }

  reverseEvent(input: ReversalInput): Promise<CommandResult> {
    return this.command('reverseEvent', input, { eventId: 'reversal-event' });
  }

  private async command(name: string, input: unknown, result: CommandResult): Promise<CommandResult> {
    this.calls.push({ name, input });
    if (this.error) throw this.error;
    return result;
  }
}
