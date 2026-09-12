import type { Category } from '../categories/types.js';
import type { GeneralEventKind, JournalEvent, WalletProjection } from './types.js';

export interface QuickEntryDefaults {
  kind: 'income' | 'expense';
  walletId: string;
  categoryId: string | null;
  payeeName: string | null;
  amount: string;
}

function normalizedPayee(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function minorAmountForInput(amountMinor: string, currency: WalletProjection['currency']): string {
  const absolute = BigInt(amountMinor);
  const value = absolute < 0n ? -absolute : absolute;
  if (currency === 'LBP') return value.toString();
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function activeCategoryId(event: JournalEvent, kind: GeneralEventKind, categories: readonly Category[]): string | null {
  const id = event.category?.id;
  if (!id || (kind !== 'income' && kind !== 'expense')) return null;
  return categories.some((category) => category.id === id && category.kind === kind && category.archivedAt === null) ? id : null;
}

export function transactionDefaultsFromRecentEvent(
  event: JournalEvent,
  wallets: readonly WalletProjection[],
  categories: readonly Category[],
): QuickEntryDefaults | null {
  if (event.kind !== 'income' && event.kind !== 'expense' || event.reversalOf || event.reversedBy || event.loanLinked) return null;
  const movement = event.movements[0];
  if (!movement) return null;
  const wallet = wallets.find((item) => item.id === movement.walletId && item.archivedAt === null);
  if (!wallet) return null;
  return {
    kind: event.kind,
    walletId: wallet.id,
    categoryId: activeCategoryId(event, event.kind, categories),
    payeeName: event.payeeName?.trim() || null,
    amount: minorAmountForInput(movement.amountMinor, wallet.currency),
  };
}

export function suggestedCategoryForPayee(
  events: readonly JournalEvent[],
  payeeName: string,
  kind: 'income' | 'expense',
  categories: readonly Category[],
): string | null {
  const payee = normalizedPayee(payeeName);
  if (!payee) return null;
  const categoryIds = events
    .filter((event) => event.kind === kind && !event.reversalOf && !event.reversedBy && normalizedPayee(event.payeeName ?? '') === payee)
    .slice(0, 3)
    .map((event) => activeCategoryId(event, kind, categories));
  const counts = new Map<string, number>();
  for (const categoryId of categoryIds) if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  for (const [categoryId, count] of counts) if (count >= 2) return categoryId;
  return null;
}
