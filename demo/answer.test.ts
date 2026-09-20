import { describe, expect, it } from 'vitest';
import { cascade, deepSeekRates, parseDeepSeekAnswer, tally } from './answer.ts';

const LABELS = new Set(['groceries', 'dining', 'transport']);

describe('parseDeepSeekAnswer', () => {
  it('reports truncation when the model ran out of tokens before answering', () => {
    // deepseek-flash emits reasoning_content first, and those tokens count
    // against max_tokens: too small a cap leaves content empty.
    const result = parseDeepSeekAnswer('', 'length', LABELS);
    expect(result.label).toBeNull();
    expect(result.error).toMatch(/truncated/i);
    expect(result.error).toMatch(/max_tokens/);
  });

  it('accepts a label from the list', () => {
    expect(parseDeepSeekAnswer('{"category": "dining"}', 'stop', LABELS)).toEqual({ label: 'dining', error: null });
  });

  it('rejects a label that is not in the list', () => {
    const result = parseDeepSeekAnswer('{"category": "restaurants"}', 'stop', LABELS);
    expect(result.label).toBeNull();
    expect(result.error).toMatch(/restaurants/);
  });

  it('reports malformed JSON instead of throwing', () => {
    const result = parseDeepSeekAnswer('{"category":', 'stop', LABELS);
    expect(result.label).toBeNull();
    expect(result.error).toMatch(/could not be read/i);
  });

  it('reports an empty body that did not hit the token cap', () => {
    const result = parseDeepSeekAnswer(null, 'stop', LABELS);
    expect(result.label).toBeNull();
    expect(result.error).toMatch(/empty/i);
  });
});

describe('tally', () => {
  const scored = [
    { tier: 'clean', expected: 'dining', label: 'dining' },
    { tier: 'clean', expected: 'groceries', label: 'groceries' },
    { tier: 'messy', expected: 'health', label: 'health' },
    { tier: 'messy', expected: 'transport', label: 'other' },
    { tier: 'messy', expected: 'other', label: null },
  ];

  it('counts overall accuracy', () => {
    expect(tally(scored).all).toEqual({ correct: 3, total: 5 });
  });

  it('separates the tiers, counting a failed request as wrong', () => {
    const { byTier } = tally(scored);
    expect(byTier.get('clean')).toEqual({ correct: 2, total: 2 });
    expect(byTier.get('messy')).toEqual({ correct: 1, total: 3 });
  });

  it('handles an empty run', () => {
    expect(tally([])).toEqual({ all: { correct: 0, total: 0 }, byTier: new Map() });
  });
});

describe('cascade', () => {
  const entry = (over: Partial<Parameters<typeof cascade>[0][number]>) => ({
    expected: 'transport',
    primaryLabel: 'transport',
    primaryConfidence: 0.95,
    primaryCost: 0.001,
    primaryMs: 300,
    fallbackLabel: 'transport',
    fallbackCost: 0.01,
    fallbackMs: 1200,
    ...over,
  });

  it('keeps a confident answer without paying the fallback', () => {
    const result = cascade([entry({})], 0.7);
    expect(result).toMatchObject({ routed: 0, correct: 1, total: 1, cost: 0.001 });
    expect(result.latencies).toEqual([300]);
  });

  it('routes a low-confidence answer and pays both', () => {
    const result = cascade([entry({ primaryLabel: 'dining', primaryConfidence: 0.52 })], 0.7);
    expect(result).toMatchObject({ routed: 1, correct: 1, total: 1 });
    expect(result.cost).toBeCloseTo(0.011);
    expect(result.latencies).toEqual([1500]);
  });

  it('counts a routed answer as wrong when the fallback is also wrong', () => {
    const result = cascade([entry({ primaryConfidence: 0.1, fallbackLabel: 'dining' })], 0.7);
    expect(result).toMatchObject({ routed: 1, correct: 0 });
  });

  it('routes when the primary reports no confidence or failed', () => {
    expect(cascade([entry({ primaryConfidence: null })], 0.7).routed).toBe(1);
    expect(cascade([entry({ primaryLabel: null, primaryConfidence: 0.99 })], 0.7).routed).toBe(1);
  });
});

describe('deepSeekRates', () => {
  it('charges peak rates inside the weekday peak windows', () => {
    expect(deepSeekRates(new Date('2026-09-21T02:30:00Z')).window).toBe('peak'); // Monday
    expect(deepSeekRates(new Date('2026-09-21T07:00:00Z')).window).toBe('peak');
  });

  it('charges off-peak outside those windows and at weekends', () => {
    expect(deepSeekRates(new Date('2026-09-21T12:00:00Z')).window).toBe('off-peak'); // Monday midday
    expect(deepSeekRates(new Date('2026-09-21T05:00:00Z')).window).toBe('off-peak'); // between windows
    expect(deepSeekRates(new Date('2026-09-20T02:30:00Z')).window).toBe('off-peak'); // Sunday
  });

  it('prices peak at double off-peak', () => {
    const peak = deepSeekRates(new Date('2026-09-21T02:30:00Z'));
    const offPeak = deepSeekRates(new Date('2026-09-21T12:00:00Z'));
    expect(peak.miss).toBeCloseTo(offPeak.miss * 2);
    expect(peak.output).toBeCloseTo(offPeak.output * 2);
  });
});
