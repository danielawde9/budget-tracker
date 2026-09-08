import type {
  CreateWalletInput,
  JournalEvent,
  JournalPage,
  RecordEventInput,
  ReverseEventInput,
  WalletProjection,
  WalletsGateway,
  WalletsSnapshot,
} from '../features/wallets/types.js';

export const walletFixtures: readonly WalletProjection[] = [
  { id: 'wallet-usd-1', spaceId: 'personal-space', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '125050' },
  { id: 'wallet-usd-2', spaceId: 'personal-space', name: 'Reserve USD', currency: 'USD', archivedAt: null, balanceMinor: '50000' },
  { id: 'wallet-lbp-1', spaceId: 'personal-space', name: 'Daily LBP', currency: 'LBP', archivedAt: null, balanceMinor: '2500000' },
];

export const journalFixtures: readonly JournalEvent[] = [
  {
    id: 'event-income', spaceId: 'personal-space', requestId: 'request-income', kind: 'income',
    effectiveDate: '2026-09-07', createdAt: '2026-09-07T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: false,
    movements: [{ walletId: 'wallet-usd-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '25050' }],
  },
  {
    id: 'event-loan', spaceId: 'personal-space', requestId: 'request-loan', kind: 'loan_lend',
    effectiveDate: '2026-09-06', createdAt: '2026-09-06T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: true,
    movements: [{ walletId: 'wallet-usd-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-50000' }],
  },
];

export class InMemoryWalletsGateway implements WalletsGateway {
  wallets = [...walletFixtures];
  events = [...journalFixtures];
  error: Error | null = null;
  calls: Array<{ name: string; input: unknown }> = [];

  private failIfNeeded() {
    if (this.error) throw this.error;
  }

  async loadSnapshot(spaceId: string): Promise<WalletsSnapshot> {
    this.calls.push({ name: 'loadSnapshot', input: spaceId });
    this.failIfNeeded();
    return {
      wallets: this.wallets.filter((wallet) => wallet.spaceId === spaceId),
      history: { events: this.events.filter((event) => event.spaceId === spaceId), nextCursor: null },
    };
  }

  async loadHistoryPage(spaceId: string, cursor: string): Promise<JournalPage> {
    this.calls.push({ name: 'loadHistoryPage', input: { spaceId, cursor } });
    this.failIfNeeded();
    return { events: [], nextCursor: null };
  }

  async createWallet(input: CreateWalletInput) {
    this.calls.push({ name: 'createWallet', input });
    this.failIfNeeded();
    const id = `wallet-${this.wallets.length + 1}`;
    this.wallets.push({ id, ...input, archivedAt: null, balanceMinor: '0' });
    return { id };
  }

  async recordEvent(input: RecordEventInput) {
    this.calls.push({ name: 'recordEvent', input });
    this.failIfNeeded();
    return { eventId: 'event-new' };
  }

  async reverseEvent(input: ReverseEventInput) {
    this.calls.push({ name: 'reverseEvent', input });
    this.failIfNeeded();
    return { eventId: 'reversal-new' };
  }

  async findEventByRequestId(spaceId: string, requestId: string) {
    this.calls.push({ name: 'findEventByRequestId', input: { spaceId, requestId } });
    return this.events.find((event) => event.spaceId === spaceId && event.requestId === requestId) ?? null;
  }
}
