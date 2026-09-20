import { describe, expect, it } from 'vitest';
import { deepSeekRates, parseDeepSeekAnswer } from './answer.ts';

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
