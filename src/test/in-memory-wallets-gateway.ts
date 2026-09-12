import type {
  CreateWalletInput,
  DescribeEventInput,
  JournalEvent,
  JournalPage,
  RecordEventInput,
  RenameWalletInput,
  ReverseEventInput,
  WalletCommandRecord,
  WalletLifecycleInput,
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
    effectiveDate: '2026-09-07', createdAt: '2026-09-07T10:00:00Z', actorId: '11111111-1111-4111-8111-111111111111', reversalOf: null, reversedBy: null, loanLinked: false,
    movements: [{ walletId: 'wallet-usd-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '25050', walletArchived: false }],
  },
  {
    id: 'event-loan', spaceId: 'personal-space', requestId: 'request-loan', kind: 'loan_lend',
    effectiveDate: '2026-09-06', createdAt: '2026-09-06T10:00:00Z', actorId: '11111111-1111-4111-8111-111111111111', reversalOf: null, reversedBy: null, loanLinked: true,
    movements: [{ walletId: 'wallet-usd-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-50000', walletArchived: false }],
  },
];

export class InMemoryWalletsGateway implements WalletsGateway {
  wallets = [...walletFixtures];
  archivedWallets: WalletProjection[] = [];
  events = [...journalFixtures];
  error: Error | null = null;
  calls: Array<{ name: string; input: unknown }> = [];
  walletCommandResults = new Map<string, WalletCommandRecord>();

  private failIfNeeded() {
    if (this.error) throw this.error;
  }

  async loadSnapshot(spaceId: string): Promise<WalletsSnapshot> {
    this.calls.push({ name: 'loadSnapshot', input: spaceId });
    this.failIfNeeded();
    return {
      wallets: this.wallets.filter((wallet) => wallet.spaceId === spaceId),
      archivedWallets: this.archivedWallets.filter((wallet) => wallet.spaceId === spaceId),
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
    const id = `wallet-${this.wallets.length + this.archivedWallets.length + 1}`;
    this.wallets = [...this.wallets, { id, ...input, archivedAt: null, balanceMinor: '0' }];
    return { id };
  }

  async renameWallet(input: RenameWalletInput) {
    this.calls.push({ name: 'renameWallet', input });
    this.failIfNeeded();
    this.wallets = this.wallets.map((wallet) => wallet.id === input.walletId ? { ...wallet, name: input.name } : wallet);
    this.walletCommandResults.set(input.requestId, { commandKind: 'rename_wallet', walletId: input.walletId });
    return { id: input.walletId };
  }

  async archiveWallet(input: WalletLifecycleInput) {
    this.calls.push({ name: 'archiveWallet', input });
    this.failIfNeeded();
    const wallet = this.wallets.find((item) => item.id === input.walletId);
    if (wallet) {
      this.wallets = this.wallets.filter((item) => item.id !== input.walletId);
      this.archivedWallets = [...this.archivedWallets, { ...wallet, archivedAt: '2026-09-11T12:00:00Z' }];
    }
    this.walletCommandResults.set(input.requestId, { commandKind: 'archive_wallet', walletId: input.walletId });
    return { id: input.walletId };
  }

  async restoreWallet(input: WalletLifecycleInput) {
    this.calls.push({ name: 'restoreWallet', input });
    this.failIfNeeded();
    const wallet = this.archivedWallets.find((item) => item.id === input.walletId);
    if (wallet) {
      this.archivedWallets = this.archivedWallets.filter((item) => item.id !== input.walletId);
      this.wallets = [...this.wallets, { ...wallet, archivedAt: null }];
    }
    this.walletCommandResults.set(input.requestId, { commandKind: 'restore_wallet', walletId: input.walletId });
    return { id: input.walletId };
  }

  async getWalletCommandResult(_spaceId: string, requestId: string) {
    this.calls.push({ name: 'getWalletCommandResult', input: requestId });
    return this.walletCommandResults.get(requestId) ?? null;
  }

  async recordEvent(input: RecordEventInput) {
    this.calls.push({ name: 'recordEvent', input });
    this.failIfNeeded();
    return { eventId: 'event-new' };
  }

  async describeEvent(input: DescribeEventInput) {
    this.calls.push({ name: 'describeEvent', input });
    this.failIfNeeded();
    return { eventId: input.eventId };
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
