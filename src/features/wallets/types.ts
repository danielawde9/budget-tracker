import type { Currency, Locale } from '../loans/types.js';

export type GeneralEventKind = 'opening_balance' | 'income' | 'expense' | 'transfer';
export type JournalEventKind =
  | GeneralEventKind
  | 'loan_opening'
  | 'loan_lend'
  | 'loan_borrow'
  | 'loan_receive_repayment'
  | 'loan_repay_borrowing'
  | 'reversal';

export interface WalletProjection {
  id: string;
  spaceId: string;
  name: string;
  currency: Currency;
  archivedAt: string | null;
  balanceMinor: string;
}

export interface JournalMovement {
  walletId: string;
  walletName: string;
  currency: Currency;
  amountMinor: string;
}

export interface JournalCategoryLabel {
  id: string;
  kind: 'income' | 'expense';
  nameEn: string | null;
  nameAr: string | null;
  archivedAt: string | null;
}

export interface JournalEvent {
  id: string;
  spaceId: string;
  requestId: string;
  kind: JournalEventKind;
  effectiveDate: string;
  createdAt: string;
  reversalOf: string | null;
  reversedBy: string | null;
  loanLinked: boolean;
  movements: readonly JournalMovement[];
  category?: JournalCategoryLabel | null;
}

export interface JournalPage {
  events: readonly JournalEvent[];
  nextCursor: string | null;
}

export interface WalletsSnapshot {
  wallets: readonly WalletProjection[];
  history: JournalPage;
}

export interface CreateWalletInput {
  spaceId: string;
  name: string;
  currency: Currency;
}

export interface MovementInput {
  walletId: string;
  amountMinor: string;
}

export interface RecordEventInput {
  spaceId: string;
  requestId: string;
  kind: GeneralEventKind;
  effectiveDate: string;
  movements: readonly MovementInput[];
}

export interface ReverseEventInput {
  spaceId: string;
  requestId: string;
  eventId: string;
  effectiveDate: string;
}

export interface CommandResult {
  id?: string;
  eventId?: string;
}

export interface WalletsGateway {
  loadSnapshot(spaceId: string): Promise<WalletsSnapshot>;
  loadHistoryPage(spaceId: string, cursor: string): Promise<JournalPage>;
  createWallet(input: CreateWalletInput): Promise<CommandResult>;
  recordEvent(input: RecordEventInput): Promise<CommandResult>;
  reverseEvent(input: ReverseEventInput): Promise<CommandResult>;
  findEventByRequestId(spaceId: string, requestId: string): Promise<JournalEvent | null>;
}

export interface WalletsCopyContext {
  locale: Locale;
}
