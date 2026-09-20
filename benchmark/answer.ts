/** Pure helpers for the categorisation benchmark, kept here so they can be tested. */

/** Published DeepSeek list prices per million tokens, read 2026-09-20. */
const DEEPSEEK_PRICE = {
  peak: { miss: 0.3, hit: 0.006, output: 1.2 },
  offPeak: { miss: 0.15, hit: 0.003, output: 0.6 },
} as const;

export type Rates = {
  readonly miss: number;
  readonly hit: number;
  readonly output: number;
  readonly window: 'peak' | 'off-peak';
};

/**
 * DeepSeek charges peak rates 01:00-04:00 and 06:00-10:00 UTC, Monday to
 * Friday. Chinese public holidays are off-peak too; that is not modelled here.
 */
export function deepSeekRates(now: Date): Rates {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  const weekday = day >= 1 && day <= 5;
  const peakHour = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  return weekday && peakHour
    ? { ...DEEPSEEK_PRICE.peak, window: 'peak' }
    : { ...DEEPSEEK_PRICE.offPeak, window: 'off-peak' };
}

export type Tally = { readonly correct: number; readonly total: number };
export type Scored = { readonly tier: string; readonly expected: string; readonly label: string | null };

/** Accuracy overall and per tier, so clean and messy expenses read separately. */
export function tally(scored: readonly Scored[]): { readonly all: Tally; readonly byTier: ReadonlyMap<string, Tally> } {
  const byTier = new Map<string, Tally>();
  let correct = 0;
  for (const entry of scored) {
    const hit = entry.label === entry.expected;
    if (hit) correct += 1;
    const current = byTier.get(entry.tier) ?? { correct: 0, total: 0 };
    byTier.set(entry.tier, { correct: current.correct + (hit ? 1 : 0), total: current.total + 1 });
  }
  return { all: { correct, total: scored.length }, byTier };
}

export type CascadeEntry = {
  readonly expected: string;
  readonly primaryLabel: string | null;
  readonly primaryConfidence: number | null;
  readonly primaryCost: number;
  readonly primaryMs: number;
  readonly fallbackLabel: string | null;
  readonly fallbackCost: number;
  readonly fallbackMs: number;
};

export type CascadeResult = {
  readonly routed: number;
  readonly correct: number;
  readonly total: number;
  readonly cost: number;
  readonly latencies: readonly number[];
};

/**
 * Keep the primary model's answer when it is confident, and ask the fallback
 * model otherwise. Computed from answers both models already gave in one run,
 * so no extra requests are made. An answer with no confidence (or none at all)
 * always routes.
 */
export function cascade(entries: readonly CascadeEntry[], threshold: number): CascadeResult {
  let routed = 0;
  let correct = 0;
  let cost = 0;
  const latencies: number[] = [];
  for (const entry of entries) {
    const confident = entry.primaryConfidence !== null && entry.primaryConfidence >= threshold && entry.primaryLabel !== null;
    const label = confident ? entry.primaryLabel : entry.fallbackLabel;
    if (!confident) routed += 1;
    if (label === entry.expected) correct += 1;
    cost += entry.primaryCost + (confident ? 0 : entry.fallbackCost);
    latencies.push(entry.primaryMs + (confident ? 0 : entry.fallbackMs));
  }
  return { routed, correct, total: entries.length, cost, latencies };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export type ParsedAnswer = { readonly label: string; readonly error: null } | { readonly label: null; readonly error: string };

/**
 * DeepSeek's JSON mode has no schema, so the answer is validated here.
 * `deepseek-flash` also reasons before it answers, and reasoning tokens count
 * against max_tokens - too small a cap returns finish_reason "length" with an
 * empty body, which must not look like a wrong answer.
 */
export function parseDeepSeekAnswer(
  content: string | null | undefined,
  finishReason: string | null | undefined,
  labels: ReadonlySet<string>,
): ParsedAnswer {
  if (finishReason === 'length') {
    return { label: null, error: 'truncated before the answer: raise max_tokens (reasoning tokens count against it)' };
  }
  if (content === null || content === undefined || content.trim() === '') {
    return { label: null, error: 'empty response body' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { label: null, error: `answer could not be read as JSON: ${content.slice(0, 60)}` };
  }
  const label = (parsed as { category?: unknown } | null)?.category;
  if (typeof label !== 'string' || !labels.has(label)) {
    return { label: null, error: `not one of the categories: ${JSON.stringify(label)}` };
  }
  return { label, error: null };
}
