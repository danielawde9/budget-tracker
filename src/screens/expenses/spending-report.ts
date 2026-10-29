import { BudgetError, type BudgetApi } from '../../api/budget-api.ts';
import type { ActivityCursor, Entry, PlanMonth } from '../../api/schemas.ts';
import type { Currency } from '../../lib/money.ts';
import { addDays, addMonths, endOfMonth } from '../describe.ts';
import { loadMonthActivity } from '../home/dashboard-model.ts';

export interface ReportRange { readonly from: string; readonly to: string }
export type ReportPreset = 'thisMonth' | 'lastMonth' | 'last30Days' | 'thisYear' | 'month' | 'custom';
export interface SpendingSelection { readonly itemId: string; readonly groupId?: string }

export function reportPeriod(preset: Exclude<ReportPreset, 'custom'>, today: string, month = today.slice(0, 7)): ReportRange {
  if (preset === 'last30Days') return { from: addDays(today, -29), to: today };
  if (preset === 'thisYear') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const from = preset === 'lastMonth' ? addMonths(today, -1) : preset === 'month' ? `${month.slice(0, 7)}-01` : `${today.slice(0, 7)}-01`;
  const end = endOfMonth(from);
  return { from, to: end < today ? end : today };
}

function calendarDate(value: string): boolean {
  if (!/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validReportRange(range: ReportRange, today: string): boolean {
  return calendarDate(range.from) && calendarDate(range.to) && range.from <= range.to && range.to <= today;
}

const inRange = (entry: Entry, range: ReportRange) => entry.occurredOn >= range.from && entry.occurredOn <= range.to;
const newestFirst = (a: Entry, b: Entry) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt) || b.entryId.localeCompare(a.entryId);

/** Complete reads, bounded fan-out, and no partial totals on a failed page. */
export async function loadReportActivity(api: Pick<BudgetApi, 'activity'>, spaceId: string, range: ReportRange): Promise<Entry[]> {
  if (!validReportRange(range, range.to)) throw new BudgetError('BUDGET_INVALID_FILTER');
  const monthNumber = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  const months = monthNumber(range.to) - monthNumber(range.from) + 1;
  const entries = new Map<string, Entry>();
  if (months <= 24) {
    let next = 0;
    let failed = false;
    async function worker() {
      try {
        while (!failed && next < months) {
          const index = next++;
          const page = await loadMonthActivity(api, spaceId, addMonths(range.from, index));
          for (const entry of page) if (inRange(entry, range)) entries.set(entry.entryId, entry);
        }
      } catch (error) { failed = true; throw error; }
    }
    await Promise.all(Array.from({ length: Math.min(3, months) }, worker));
  } else {
    // A wide range should not make one request for each empty historical month.
    let before: ActivityCursor | null = null;
    const cursors = new Set<string>();
    do {
      const page = await api.activity(spaceId, { limit: 100, before, filter: {} });
      for (const entry of page.entries) if (inRange(entry, range)) entries.set(entry.entryId, entry);
      before = page.next;
      if (before) {
        const key = JSON.stringify(before);
        if (cursors.has(key)) throw new BudgetError('BAD_RESPONSE');
        cursors.add(key);
      }
      if (page.entries.at(-1)?.occurredOn && page.entries.at(-1)!.occurredOn < range.from) break;
    } while (before);
  }
  return [...entries.values()].sort(newestFirst);
}

interface Named { readonly nameEn: string | null; readonly nameAr: string | null }
interface ReportLine extends Named {
  readonly itemId: string;
  readonly groupId: string;
  readonly groupNameEn: string | null;
  readonly groupNameAr: string | null;
  readonly amount: bigint;
  readonly flow: Entry['items'][number]['flow'];
}
export interface ReportTransaction {
  readonly entry: Entry;
  readonly lines: readonly ReportLine[];
  readonly total: bigint;
}
export interface SpendingCategory extends Named {
  readonly itemId: string;
  readonly purchases: bigint;
  readonly refunds: bigint;
  readonly total: bigint;
  readonly count: number;
}
export interface SpendingGroup extends Named {
  readonly groupId: string;
  readonly total: bigint;
  readonly count: number;
  readonly categories: readonly SpendingCategory[];
}
export interface SpendingReport {
  readonly purchases: bigint;
  readonly refunds: bigint;
  readonly total: bigint;
  readonly count: number;
  readonly categories: readonly SpendingCategory[];
  readonly groups: readonly SpendingGroup[];
}

export function matchingSpendingEntries(entries: readonly Entry[], range: ReportRange, currency: Currency, selection: SpendingSelection | null = null, plan?: PlanMonth): ReportTransaction[] {
  const currentGroups = new Map(plan?.groups.flatMap(group => [...group.items, ...(group.flex ? [group.flex] : [])].map(item => [item.itemId, group] as const)) ?? []);
  const unique = new Map(entries.filter(entry => inRange(entry, range)).map(entry => [entry.entryId, entry]));
  return [...unique.values()].sort(newestFirst).flatMap(entry => {
    const lines: ReportLine[] = entry.items.filter(line => line.currency === currency && line.kind !== 'ready' &&
      ['spend', 'refund', 'interest', 'fee'].includes(line.flow)).map(line => {
      const group = currentGroups.get(line.itemId);
      const historical = Boolean(line.groupId);
      return { ...line, groupId: line.groupId ?? group?.groupId ?? 'other-expenses',
        groupNameEn: historical ? line.groupNameEn ?? 'Other expenses' : group?.nameEn ?? 'Other expenses',
        groupNameAr: historical ? line.groupNameAr ?? 'مصروفات أخرى' : group?.nameAr ?? 'مصروفات أخرى' };
    });
    // Investment fees (and reversals) can exist solely on the investment wallet.
    // A category-backed fee already contains the expense side of its wallet mirror.
    if (!lines.some(line => line.flow === 'fee')) {
      for (const wallet of entry.wallets) if (wallet.currency === currency && wallet.kind === 'investment' && wallet.flow === 'fee') {
        lines.push({ itemId: 'report:investment-fees', nameEn: 'Investment fees', nameAr: 'رسوم الاستثمار',
          groupId: 'report:fees', groupNameEn: 'Fees & interest', groupNameAr: 'الرسوم والفوائد', amount: wallet.amount, flow: 'fee' });
      }
    }
    const selected = lines.filter(line => !selection || line.itemId === selection.itemId && (!selection.groupId || line.groupId === selection.groupId));
    return selected.length ? [{ entry, lines: selected, total: selected.reduce((sum, line) => sum - line.amount, 0n) }] : [];
  });
}

interface MutableCategory {
  itemId: string; nameEn: string | null; nameAr: string | null; purchases: bigint; refunds: bigint; ids: Set<string>;
}
function addCategory(rows: Map<string, MutableCategory>, line: ReportLine, entryId: string) {
  const row = rows.get(line.itemId) ?? { itemId: line.itemId, nameEn: line.nameEn, nameAr: line.nameAr, purchases: 0n, refunds: 0n, ids: new Set<string>() };
  if (line.flow === 'refund') row.refunds += line.amount;
  else row.purchases -= line.amount;
  row.ids.add(entryId);
  rows.set(line.itemId, row);
}
function finishCategories(rows: Map<string, MutableCategory>): SpendingCategory[] {
  return [...rows.values()].map(({ ids, ...row }) => ({ ...row, count: ids.size, total: row.purchases - row.refunds }))
    .sort((a, b) => a.total > b.total ? -1 : a.total < b.total ? 1 : a.itemId.localeCompare(b.itemId));
}

export function buildSpendingReport(entries: readonly Entry[], range: ReportRange, currency: Currency, plan?: PlanMonth): SpendingReport {
  const records = matchingSpendingEntries(entries, range, currency, null, plan);
  const categories = new Map<string, MutableCategory>();
  const groups = new Map<string, { groupId: string; nameEn: string | null; nameAr: string | null; ids: Set<string>; categories: Map<string, MutableCategory> }>();
  for (const record of records) for (const line of record.lines) {
    addCategory(categories, line, record.entry.entryId);
    const group = groups.get(line.groupId) ?? { groupId: line.groupId, nameEn: line.groupNameEn, nameAr: line.groupNameAr, ids: new Set<string>(), categories: new Map<string, MutableCategory>() };
    addCategory(group.categories, line, record.entry.entryId);
    group.ids.add(record.entry.entryId);
    groups.set(line.groupId, group);
  }
  const rows = finishCategories(categories);
  const purchases = rows.reduce((sum, row) => sum + row.purchases, 0n);
  const refunds = rows.reduce((sum, row) => sum + row.refunds, 0n);
  return { purchases, refunds, total: purchases - refunds, count: records.length, categories: rows,
    groups: [...groups.values()].map(group => {
      const categories = finishCategories(group.categories);
      return { groupId: group.groupId, nameEn: group.nameEn, nameAr: group.nameAr, count: group.ids.size, categories,
        total: categories.reduce((sum, row) => sum + row.total, 0n) };
    }).sort((a, b) => a.total > b.total ? -1 : a.total < b.total ? 1 : a.groupId.localeCompare(b.groupId)) };
}
