import { z } from 'zod';

/**
 * Shapes of every read the database returns. Amounts arrive as decimal
 * strings of minor units and leave this boundary as exact bigints.
 */
const minor = z.string().regex(/^-?\d{1,19}$/).transform((value) => BigInt(value));
const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableText = z.string().nullable();
export const currency = z.enum(['USD', 'LBP']);

export const spaceSummary = z.object({
  id,
  name: z.string(),
  role: z.enum(['owner', 'member']),
  timezone: z.string(),
  planCurrency: currency,
  today: isoDate,
  currentMonth: isoDate,
});

const named = { nameEn: nullableText, nameAr: nullableText };

export const planTotals = z.object({
  month: isoDate,
  planCurrency: currency,
  versionId: id.nullable(),
  revision: z.number().int().nullable(),
  effectiveMonth: isoDate.nullable(),
  expectedIncome: minor,
  groupsTotal: minor,
  notPlanned: minor,
  overPlanned: minor,
  received: minor,
  otherIncome: minor,
  funded: minor,
  stillToFund: minor,
  ready: minor,
  /** Ready to assign at the end of the viewed month (equals today's for the current month). */
  readyAtMonthEnd: minor,
});

export const alert = z.object({
  kind: z.enum(['over_assigned', 'ready_to_fund', 'ready_unassigned', 'bill_overdue', 'bill_short', 'group_over']),
  currency: currency.optional(),
  amount: minor.optional(),
  billId: id.optional(),
  name: z.string().optional(),
  dueOn: isoDate.optional(),
  itemId: id.optional(),
  groupId: id.optional(),
  nameEn: nullableText.optional(),
  nameAr: nullableText.optional(),
});

export const currencyOverview = z.object({
  currency,
  cashHeld: minor,
  ready: minor,
  setAside: minor,
  setAsideByGroup: z.array(z.object({ groupId: id, ...named, amount: minor })),
  wallets: z.array(z.object({ walletId: id, name: z.string(), balance: minor })),
  netWorth: z.object({ cash: minor, investments: minor, owedToMe: minor, iOwe: minor, total: minor }),
});

export const overview = z.object({
  today: isoDate,
  month: isoDate,
  planCurrency: currency,
  currencies: z.array(currencyOverview),
  plan: planTotals,
  alerts: z.array(alert),
  referenceRate: z.object({ currency, unitsPerUsd: z.string(), effectiveOn: isoDate }).nullable(),
});

export const itemKind = z.enum(['ready', 'spending', 'reserve', 'goal', 'flex', 'loan_payment']);

export const planItem = z.object({
  itemId: id,
  kind: itemKind,
  ...named,
  inPlan: z.boolean(),
  planned: minor,
  stillToFund: minor,
  broughtForward: minor,
  opening: minor,
  funded: minor,
  movedIn: minor,
  movedOut: minor,
  coveredIn: minor,
  coveredOut: minor,
  spent: minor,
  otherOut: minor,
  exchanged: minor,
  available: minor,
  balances: z.object({ USD: minor, LBP: minor }),
  targetMinor: minor.nullable(),
  targetDate: isoDate.nullable(),
  walletId: id.nullable(),
});

export const planGroup = z.object({
  groupId: id,
  ...named,
  percentBps: z.number().int(),
  planned: minor,
  itemsPlanned: minor,
  over: minor,
  funded: minor,
  spent: minor,
  otherOut: minor,
  available: minor,
  items: z.array(planItem),
  flex: planItem.nullable(),
});

export const planMonth = planTotals.extend({
  today: isoDate,
  isCurrent: z.boolean(),
  isPast: z.boolean(),
  groups: z.array(planGroup),
});

export const fundingPreview = z.object({
  month: isoDate,
  currency,
  available: minor,
  lines: z.array(z.object({ itemId: id, amountMinor: minor })),
  unfunded: minor,
});

export const flow = z.enum([
  'opening', 'income', 'other_income', 'fund', 'release', 'move', 'cover', 'spend', 'refund',
  'transfer', 'exchange', 'invest', 'withdraw', 'value', 'fee', 'borrow', 'principal', 'interest', 'lend', 'collect',
]);

export const entryKind = z.enum([
  'opening_balance', 'opening_assign', 'income', 'assign', 'expense', 'refund', 'transfer', 'exchange',
  'invest', 'invest_withdraw', 'invest_value', 'invest_fee', 'invest_income',
  'loan_borrow', 'loan_repay', 'loan_lend', 'loan_collect', 'loan_opening', 'reversal',
]);

export const walletKind = z.enum(['cash', 'investment', 'loan']);

export const entry = z.object({
  entryId: id,
  kind: entryKind,
  occurredOn: isoDate,
  createdAt: z.string(),
  memo: nullableText,
  reversesEntryId: id.nullable(),
  reversalReason: nullableText,
  reversedByEntryId: id.nullable(),
  billId: id.nullable(),
  billDueOn: isoDate.nullable(),
  billName: nullableText,
  billPaymentLoanWalletId: id.nullable().optional(),
  billLinkVersion: z.number().int().nonnegative().optional(),
  billLinkHistory: z.array(z.object({ billId: id.nullable(), billName: nullableText, dueOn: isoDate.nullable(), createdAt: z.string() })).optional(),
  wallets: z.array(z.object({ walletId: id, name: z.string(), kind: walletKind, currency, amount: minor, flow })),
  items: z.array(z.object({ itemId: id, kind: itemKind, ...named, currency, amount: minor, flow })),
});

export const activityCursor = z.object({ occurredOn: isoDate, createdAt: z.string(), id });

export const activityPage = z.object({
  entries: z.array(entry),
  next: activityCursor.nullable(),
});

export const statementRow = z.object({
  currency,
  broughtForward: minor,
  opening: minor,
  funded: minor,
  movedIn: minor,
  movedOut: minor,
  coveredIn: minor,
  coveredOut: minor,
  spent: minor,
  otherOut: minor,
  exchanged: minor,
  available: minor,
});

export const itemStatement = z.object({
  item: z.object({
    itemId: id,
    kind: itemKind,
    ...named,
    groupId: id.nullable(),
    targetMinor: minor.nullable(),
    targetDate: isoDate.nullable(),
    archived: z.boolean(),
  }),
  month: isoDate,
  balances: z.object({ USD: minor, LBP: minor }),
  statement: z.array(statementRow),
  entries: z.array(entry),
});

export const accountWallet = z.object({
  id,
  name: z.string(),
  kind: walletKind,
  currency,
  balance: minor,
  archived: z.boolean(),
  loanDirection: z.enum(['i_owe', 'owed_to_me']).nullable(),
  counterparty: nullableText,
  contributed: minor.nullable(),
  gain: minor.nullable(),
});

export const accounts = z.object({ wallets: z.array(accountWallet) });

export const billOccurrence = z.object({
  billId: id,
  name: z.string(),
  itemId: id,
  itemNameEn: nullableText,
  itemNameAr: nullableText,
  currency,
  expected: minor,
  dueOn: isoDate,
  status: z.enum(['paid', 'part_paid', 'skipped', 'due', 'overdue']),
  paidAmount: minor,
  remaining: minor.optional(),
  overpaid: minor.optional(),
  paymentCount: z.number().int().nonnegative().optional(),
  entryId: id.nullable(),
  coverage: z.enum(['covered', 'short', 'not_covered']).nullable(),
  shortBy: minor,
  loanWalletId: id.nullable(),
  cadence: z.enum(['monthly', 'yearly', 'once']),
});

export const bill = z.object({
  billId: id,
  name: z.string(),
  itemId: id,
  amount: minor,
  currency,
  cadence: z.enum(['monthly', 'yearly', 'once']),
  firstDueOn: isoDate,
  endOn: isoDate.nullable(),
  loanWalletId: id.nullable(),
});

export const billLinkResult = z.object({ entryId: id, billId: id.nullable(), dueOn: isoDate.nullable(), linkVersion: z.number().int().nonnegative() });

export const entryResult = z.object({ entryId: id.nullable() });
export const coveredResult = z.object({ entryId: id, covered: minor });
export const spaceResult = z.object({ spaceId: id });
export const walletResult = z.object({ walletId: id, entryId: id.nullable() });
export const billResult = z.object({ billId: id });

/** A past expense description and what it was last recorded with. */
export const expenseSuggestion = z.object({
  memo: z.string().min(1),
  itemId: id,
  walletId: id,
  amount: minor,
  currency,
  lastOn: isoDate,
});

export const expenseSuggestions = z.object({
  /** The wallet of the latest expense, or null when there is none. */
  lastWalletId: id.nullable(),
  suggestions: expenseSuggestion.array(),
});
export const okResult = z.object({ ok: z.literal(true) });
export const planResult = z.object({ versionId: id, revision: z.number().int(), effectiveMonth: isoDate });

export type SpaceSummary = z.infer<typeof spaceSummary>;
export type Overview = z.infer<typeof overview>;
export type CurrencyOverview = z.infer<typeof currencyOverview>;
export type Alert = z.infer<typeof alert>;
export type PlanTotals = z.infer<typeof planTotals>;
export type PlanMonth = z.infer<typeof planMonth>;
export type PlanGroup = z.infer<typeof planGroup>;
export type PlanItem = z.infer<typeof planItem>;
export type ItemKind = z.infer<typeof itemKind>;
export type FundingPreview = z.infer<typeof fundingPreview>;
export type Entry = z.infer<typeof entry>;
export type EntryKind = z.infer<typeof entryKind>;
export type Flow = z.infer<typeof flow>;
export type ActivityCursor = z.infer<typeof activityCursor>;
export type ActivityPage = z.infer<typeof activityPage>;
export type ItemStatement = z.infer<typeof itemStatement>;
export type StatementRow = z.infer<typeof statementRow>;
export type AccountWallet = z.infer<typeof accountWallet>;
export type Accounts = z.infer<typeof accounts>;
export type BillOccurrence = z.infer<typeof billOccurrence>;
export type Bill = z.infer<typeof bill>;
export type ExpenseSuggestion = z.infer<typeof expenseSuggestion>;
export type ExpenseSuggestions = z.infer<typeof expenseSuggestions>;
export type WalletKind = z.infer<typeof walletKind>;

export const spaceInvitation = z.object({ invitationId: id, email: z.string(), expiresAt: z.string() });
export const invitationResult = spaceInvitation.pick({ invitationId: true, expiresAt: true });
