const AGGREGATE_MONEY_PATTERN = /^(0|-?[1-9][0-9]{0,29})$/;
const MUTATION_MONEY_PATTERN = /^(0|[1-9][0-9]{0,14})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEAD_PATTERN = /^[0-9a-f]{64}$/;

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid response object.');
  }
  return value as Record<string, unknown>;
}

/** Aggregate/read-side money: up to 30 digits, signed. Mutation inputs use the
 * stricter 15-digit nonnegative `planningMoneyInput` below instead. */
export function minor(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Unsafe money number.');
    return BigInt(value).toString();
  }
  if (typeof value !== 'string' || !AGGREGATE_MONEY_PATTERN.test(value)) {
    throw new Error('Invalid money string.');
  }
  return BigInt(value).toString();
}

export function nullableMinor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return minor(value);
}

/** SQL's mutation-input bound: a nonnegative integer up to 15 digits. */
export function planningMoneyInput(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Unsafe money number.');
    const text = BigInt(value).toString();
    if (!MUTATION_MONEY_PATTERN.test(text)) throw new Error('Money amount exceeds the allowed bound.');
    return text;
  }
  if (typeof value !== 'string' || !MUTATION_MONEY_PATTERN.test(value)) {
    throw new Error('Invalid nonnegative money string.');
  }
  return BigInt(value).toString();
}

export function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Invalid date.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (value.startsWith('0000-') || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date.');
  }
  return value;
}

export function month(value: unknown): string {
  const result = date(value);
  if (!result.endsWith('-01')) throw new Error('Month must start on day one.');
  return result;
}

export function string(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Missing or invalid ${field}.`);
  return value;
}

export function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, field);
}

export function uuid(value: unknown, field: string): string {
  const result = string(value, field);
  if (!UUID_PATTERN.test(result)) throw new Error(`Invalid UUID for ${field}.`);
  return result;
}

export function nullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return uuid(value, field);
}

/** An opaque 64-lowercase-hex stale token (e.g. a goal's earmark/definition
 * head) -- never a bigint revision counter, so it is validated by shape only. */
export function head(value: unknown, field: string): string {
  const result = string(value, field);
  if (!HEAD_PATTERN.test(result)) throw new Error(`Invalid head token for ${field}.`);
  return result;
}

export function nullableHead(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return head(value, field);
}

/** A bigint identifier: PostgREST may serialize it as a JSON number (when
 * small) or as a numeric string, depending on the driver's type mapping. */
export function bigIntId(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid identifier for ${field}.`);
    return String(value);
  }
  const result = string(value, field);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(result)) throw new Error(`Invalid identifier for ${field}.`);
  return result;
}

export function nullableBigIntId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return bigIntId(value, field);
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Missing or invalid ${field}.`);
  return value;
}

export function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`Missing or invalid ${field}.`);
  return value;
}

export function nullableInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, field);
}

/** Signed integer text, e.g. actualShareOfIncomeBps -- never coerced to a number
 * since the ratio is unbounded when the income denominator is tiny. */
export function nullableSignedIntegerText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Invalid signed integer text for ${field}.`);
  }
  return value;
}

export function currency(value: unknown): 'USD' | 'LBP' {
  const result = string(value, 'currency');
  if (result !== 'USD' && result !== 'LBP') throw new Error('Unsupported currency.');
  return result;
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const result = string(value, field);
  if (!(allowed as readonly string[]).includes(result)) throw new Error(`Unsupported ${field} value.`);
  return result as T;
}

export function array(value: unknown, field: string, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Missing or invalid ${field}.`);
  if (value.length > maxLength) throw new Error(`${field} exceeded its ${maxLength}-row bound.`);
  return value;
}

export function uniqueBy<T>(items: readonly T[], key: (item: T) => string, field: string): readonly T[] {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new Error(`Duplicate ${field}.`);
    seen.add(value);
  }
  return items;
}
