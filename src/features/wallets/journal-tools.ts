import type { JournalEvent, JournalEventKind } from './types.js';

export interface JournalFilters {
  readonly query: string;
  readonly walletId: string;
  readonly kind: JournalEventKind | '';
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterJournalEvents(events: readonly JournalEvent[], filters: JournalFilters): readonly JournalEvent[] {
  const query = normalized(filters.query);
  return events.filter((event) => {
    if (filters.kind && event.kind !== filters.kind) return false;
    if (filters.walletId && !event.movements.some((movement) => movement.walletId === filters.walletId)) return false;
    if (!query) return true;
    return [event.effectiveDate, event.kind, event.category?.nameEn ?? '', event.category?.nameAr ?? '', ...event.movements.map((movement) => movement.walletName)]
      .some((value) => normalized(value).includes(query));
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function journalEventsToCsv(events: readonly JournalEvent[]): string {
  const rows = [['effective_date', 'event_kind', 'wallet', 'currency', 'amount_minor', 'category', 'entered_by']];
  for (const event of events) {
    for (const movement of event.movements) {
      rows.push([
        event.effectiveDate,
        event.kind,
        movement.walletName,
        movement.currency,
        movement.amountMinor,
        event.category?.nameEn ?? event.category?.nameAr ?? '',
        event.actorId ?? '',
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
