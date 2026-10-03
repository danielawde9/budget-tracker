import type { Entry } from '../api/schemas.ts';
import type { I18n, MessageKey } from '../lib/i18n.tsx';
import type { Currency } from '../lib/money.ts';

export interface EntryLine {
  readonly title: string;
  readonly detail: string;
  readonly amounts: readonly { readonly currency: Currency; readonly minor: bigint }[];
  readonly tone: 'in' | 'out' | 'neutral';
}

const KIND_LABEL: Readonly<Record<Entry['kind'], MessageKey>> = {
  opening_balance: 'entry.opening_balance',
  opening_assign: 'entry.opening_assign',
  income: 'entry.income',
  assign: 'entry.assign',
  expense: 'entry.expense',
  refund: 'entry.refund',
  transfer: 'entry.transfer',
  exchange: 'entry.exchange',
  invest: 'entry.invest',
  invest_withdraw: 'entry.invest_withdraw',
  invest_value: 'entry.invest_value',
  invest_fee: 'entry.invest_fee',
  invest_income: 'entry.invest_income',
  loan_borrow: 'entry.loan_borrow',
  loan_repay: 'entry.loan_repay',
  loan_lend: 'entry.loan_lend',
  loan_collect: 'entry.loan_collect',
  loan_opening: 'entry.loan_opening',
  reversal: 'entry.reversal',
};

export function kindLabel(i18n: I18n, kind: Entry['kind']): string {
  return i18n.t(KIND_LABEL[kind]);
}

function totalsByCurrency(lines: readonly { readonly currency: Currency; readonly amount: bigint }[]) {
  const totals = new Map<Currency, bigint>();
  for (const line of lines) totals.set(line.currency, (totals.get(line.currency) ?? 0n) + line.amount);
  return [...totals.entries()].filter(([, minor]) => minor !== 0n).map(([currency, minor]) => ({ currency, minor }));
}

const unique = (values: readonly string[]): string[] => [...new Set(values.filter((value) => value.length > 0))];

/** One line of plain words for an entry, with the money that moved. */
export function describeEntry(i18n: I18n, entry: Entry): EntryLine {
  const itemNames = (filter: (line: Entry['items'][number]) => boolean) =>
    unique(entry.items.filter((line) => line.kind !== 'ready' && filter(line)).map((line) => i18n.name(line)));
  const walletNames = unique(entry.wallets.map((line) => line.name));
  const cash = totalsByCurrency(entry.wallets.filter((line) => line.kind === 'cash'));
  const offBudget = totalsByCurrency(entry.wallets.filter((line) => line.kind !== 'cash'));
  const moved = totalsByCurrency(entry.items.filter((line) => line.amount > 0n && line.kind !== 'ready'));
  const label = kindLabel(i18n, entry.kind);
  const memo = entry.memo ?? '';
  switch (entry.kind) {
    case 'expense':
    case 'refund':
      return {
        title: itemNames((line) => line.flow === 'spend' || line.flow === 'refund').join(', ') || label,
        detail: [entry.billName ?? memo, walletNames.join(' · ')].filter(Boolean).join(' · '),
        amounts: cash,
        tone: entry.kind === 'expense' ? 'out' : 'in',
      };
    case 'income':
      return { title: memo || label, detail: walletNames.join(' · '), amounts: cash, tone: 'in' };
    case 'assign':
    case 'opening_assign': {
      const targets = itemNames((line) => line.amount > 0n);
      return { title: label, detail: memo || targets.join(', '), amounts: moved, tone: 'neutral' };
    }
    case 'transfer':
      return { title: label, detail: walletNames.join(' → '), amounts: totalsByCurrency(entry.wallets.filter((line) => line.amount > 0n)), tone: 'neutral' };
    case 'exchange':
      return { title: label, detail: walletNames.join(' → '), amounts: entry.wallets.map((line) => ({ currency: line.currency, minor: line.amount })), tone: 'neutral' };
    case 'invest_value':
    case 'invest_fee':
    case 'loan_opening':
      return { title: label, detail: walletNames.join(' · '), amounts: offBudget, tone: 'neutral' };
    case 'reversal':
      return { title: label, detail: entry.reversalReason ?? '', amounts: cash.length > 0 ? cash : offBudget, tone: 'neutral' };
    default:
      return {
        title: memo || label,
        detail: [label === (memo || label) ? '' : label, walletNames.join(' · ')].filter(Boolean).join(' · '),
        amounts: cash.length > 0 ? cash : offBudget,
        tone: cash.some((amount) => amount.minor > 0n) ? 'in' : cash.some((amount) => amount.minor < 0n) ? 'out' : 'neutral',
      };
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(isoMonth: string, months: number): string {
  const date = new Date(`${isoMonth.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function endOfMonth(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}
