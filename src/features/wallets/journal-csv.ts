import type { JournalEvent } from './types.js';

export type ExportLocale = 'en' | 'ar';

export interface JournalCsvOptions {
  maxRows?: number;
  maxBytes?: number;
}

export interface JournalCsvResult {
  csv: string;
  rowCount: number;
  totals: ReadonlyArray<{ currency: string; netMinor: string }>;
  truncated: boolean;
  highWaterMark: { createdAt: string; eventId: string } | null;
}

const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const HEADERS: Record<ExportLocale, readonly string[]> = {
  en: ['Date', 'Kind', 'Label', 'Note', 'Wallet', 'Currency', 'Amount (minor)'],
  ar: ['التاريخ', 'النوع', 'البيان', 'ملاحظة', 'المحفظة', 'العملة', 'المبلغ (وحدات صغرى)'],
};

const TOTAL_LABEL: Record<ExportLocale, string> = { en: 'Total', ar: 'الإجمالي' };

interface CsvRow {
  line: string;
  currency: string;
  amountMinor: string;
  event: JournalEvent;
}

function escapeCell(value: string): string {
  let cell = value;
  // Pure numeric text cannot smuggle a spreadsheet formula; everything else
  // starting with a formula trigger gets a neutralizing text marker.
  const first = cell.charAt(0);
  if ((first === '=' || first === '+' || first === '-' || first === '@') && !/^-?\d+$/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\n\r]/.test(cell)) {
    cell = `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

function compareWaterMark(left: JournalEvent, right: { createdAt: string; eventId: string }): number {
  const byCreated = left.createdAt.localeCompare(right.createdAt);
  if (byCreated !== 0) return byCreated;
  return left.id.localeCompare(right.eventId);
}

export function buildJournalCsv(
  events: readonly JournalEvent[],
  locale: ExportLocale,
  labelFor: (event: JournalEvent) => string,
  options: JournalCsvOptions = {},
): JournalCsvResult {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const rows: CsvRow[] = [];
  let truncated = false;
  for (const event of events) {
    if (truncated) break;
    const label = escapeCell(labelFor(event));
    const note = escapeCell(event.note?.trim() ?? '');
    for (const movement of event.movements) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      rows.push({
        line: [
          escapeCell(event.effectiveDate),
          escapeCell(event.kind),
          label,
          note,
          escapeCell(movement.walletName),
          escapeCell(movement.currency),
          escapeCell(movement.amountMinor),
        ].join(','),
        currency: movement.currency,
        amountMinor: movement.amountMinor,
        event,
      });
    }
  }

  const assemble = (dataRows: readonly CsvRow[], truncatedMarker: boolean) => {
    const totals = new Map<string, bigint>();
    let highWaterMark: { createdAt: string; eventId: string } | null = null;
    for (const row of dataRows) {
      totals.set(row.currency, (totals.get(row.currency) ?? 0n) + BigInt(row.amountMinor));
      if (highWaterMark === null || compareWaterMark(row.event, highWaterMark) > 0) {
        highWaterMark = { createdAt: row.event.createdAt, eventId: row.event.id };
      }
    }
    const sortedTotals = [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
    const lines = [
      highWaterMark ? `# snapshot: ${highWaterMark.createdAt} | ${highWaterMark.eventId}` : '# snapshot: none',
      ...(truncatedMarker ? ['# truncated: true'] : []),
      `# ${HEADERS[locale].join(',')}`,
      ...dataRows.map((row) => row.line),
      ...sortedTotals.map(([currency, net]) => `# ${TOTAL_LABEL[locale]} ${currency}: ${net.toString()}`),
    ];
    return {
      text: lines.join('\n'),
      totals: sortedTotals.map(([currency, net]) => ({ currency, netMinor: net.toString() })),
      highWaterMark,
    };
  };

  let assembled = assemble(rows, truncated);
  while (assembled.text.length > maxBytes) {
    truncated = true;
    const lines = assembled.text.split('\n');
    if (lines.length > 3 && !lines[lines.length - 2]!.startsWith('20') && lines[lines.length - 1]!.startsWith('# ')) {
      // Drop a footer totals line first; it is decoration, not data.
      assembled.text = [...lines.slice(0, -1)].join('\n');
      continue;
    }
    rows.pop();
    assembled = assemble(rows, truncated);
  }

  return {
    csv: assembled.text,
    rowCount: rows.length,
    totals: assembled.totals,
    truncated,
    highWaterMark: assembled.highWaterMark,
  };
}
