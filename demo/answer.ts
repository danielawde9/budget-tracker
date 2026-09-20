/** Pure helpers for the categorisation demo, kept here so they can be tested. */

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
