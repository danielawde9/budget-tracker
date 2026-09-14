import { describe, expect, it } from 'vitest';
import {
  array, bigIntId, boolean, currency, date, enumValue, head, integer, minor, month,
  nullableBigIntId, nullableHead, nullableInteger, nullableMinor, nullableSignedIntegerText,
  nullableString, nullableUuid, object, planningMoneyInput, string, uniqueBy, uuid,
} from './parse.js';

describe('object', () => {
  it('accepts a plain object', () => {
    expect(object({ a: 1 })).toEqual({ a: 1 });
  });
  it.each([null, undefined, 'x', 1, [1, 2]])('rejects %p', (value) => {
    expect(() => object(value)).toThrow();
  });
});

describe('minor', () => {
  const monetaryFixture = {
    snapshotId: '12', plannedIncomeMinor: '200000', actualIncomeMinor: '180000',
    expenseMinor: '161000', incomeAfterSpendingMinor: '19000', childPlanChanged: false,
  };

  it('parses a complete valid monetary fixture', () => {
    const result = {
      plannedIncomeMinor: minor(monetaryFixture.plannedIncomeMinor),
      actualIncomeMinor: minor(monetaryFixture.actualIncomeMinor),
      expenseMinor: minor(monetaryFixture.expenseMinor),
      incomeAfterSpendingMinor: minor(monetaryFixture.incomeAfterSpendingMinor),
    };
    expect(result.incomeAfterSpendingMinor).toBe('19000');
    expect(result.plannedIncomeMinor).toBe('200000');
  });

  it('preserves a bigint string beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(minor('9007199254740993')).toBe('9007199254740993');
  });

  it('rejects the equivalent unsafe JSON number', () => {
    expect(() => minor(9007199254740993)).toThrow('Unsafe money number.');
  });

  it('accepts a safe integer number and normalizes it to a canonical string', () => {
    expect(minor(5000)).toBe('5000');
  });

  it('accepts a negative aggregate (a signed correction)', () => {
    expect(minor('-5000')).toBe('-5000');
  });

  it('rejects a leading-zero string', () => {
    expect(() => minor('0500')).toThrow();
  });

  it('rejects a non-integer string', () => {
    expect(() => minor('12.5')).toThrow();
  });

  it('rejects null', () => {
    expect(() => minor(null)).toThrow();
  });

  it('rejects a value beyond the 30-digit aggregate cap', () => {
    expect(() => minor('1'.repeat(31))).toThrow();
  });
});

describe('nullableMinor', () => {
  it('passes null through unchanged, never coercing to zero', () => {
    expect(nullableMinor(null)).toBeNull();
  });
  it('parses a present value', () => {
    expect(nullableMinor('100')).toBe('100');
  });
});

describe('planningMoneyInput', () => {
  it('accepts zero and normalizes a number to a string', () => {
    expect(planningMoneyInput(0)).toBe('0');
    expect(planningMoneyInput(200000)).toBe('200000');
  });
  it('rejects a negative mutation amount', () => {
    expect(() => planningMoneyInput(-1)).toThrow();
    expect(() => planningMoneyInput('-1')).toThrow();
  });
  it('rejects a value beyond the SQL 15-digit mutation cap', () => {
    expect(() => planningMoneyInput('1'.repeat(16))).toThrow();
  });
  it('rejects a leading-zero string', () => {
    expect(() => planningMoneyInput('0100')).toThrow();
  });
});

describe('date', () => {
  it('accepts a real calendar date', () => {
    expect(date('2026-09-14')).toBe('2026-09-14');
  });
  it('rejects an invalid leap date', () => {
    expect(() => date('2025-02-29')).toThrow('Invalid calendar date.');
  });
  it('accepts a valid leap date', () => {
    expect(date('2024-02-29')).toBe('2024-02-29');
  });
  it('rejects an out-of-range month/day', () => {
    expect(() => date('2026-13-01')).toThrow();
    expect(() => date('2026-09-31')).toThrow();
  });
  it('rejects a non-string', () => {
    expect(() => date(20_260_914)).toThrow();
  });
});

describe('month', () => {
  it('accepts a month-start date', () => {
    expect(month('2026-09-01')).toBe('2026-09-01');
  });
  it('rejects a non-first-of-month date', () => {
    expect(() => month('2026-09-15')).toThrow('Month must start on day one.');
  });
});

describe('string/uuid/nullableString/nullableUuid', () => {
  it('accepts a canonical lowercase UUID', () => {
    expect(uuid('11111111-1111-4111-8111-111111111111', 'groupId')).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('rejects an uppercase or malformed UUID', () => {
    expect(() => uuid('AAAAAAAA-1111-4111-8111-111111111111', 'groupId')).toThrow();
    expect(() => uuid('not-a-uuid', 'groupId')).toThrow();
  });
  it('rejects a null required string', () => {
    expect(() => string(null, 'nameEn')).toThrow('Missing or invalid nameEn.');
  });
  it('passes null through for nullable variants', () => {
    expect(nullableString(null, 'nameAr')).toBeNull();
    expect(nullableUuid(null, 'groupId')).toBeNull();
  });
});

describe('head/nullableHead', () => {
  it('accepts a 64-lowercase-hex token', () => {
    const token = 'a'.repeat(64);
    expect(head(token, 'earmarkHead')).toBe(token);
  });
  it('rejects uppercase hex, a bigint revision, and any other length', () => {
    expect(() => head('A'.repeat(64), 'earmarkHead')).toThrow();
    expect(() => head('123', 'earmarkHead')).toThrow();
    expect(() => head('a'.repeat(63), 'earmarkHead')).toThrow();
    expect(() => head('a'.repeat(65), 'earmarkHead')).toThrow();
  });
  it('never confuses a head token with a plain string field', () => {
    expect(() => head('not-a-head-at-all', 'earmarkHead')).toThrow();
  });
  it('passes null through for the nullable variant only', () => {
    expect(nullableHead(null, 'earmarkHead')).toBeNull();
    expect(nullableHead(undefined, 'earmarkHead')).toBeNull();
    expect(() => head(null, 'earmarkHead')).toThrow();
  });
});

describe('bigIntId/nullableBigIntId', () => {
  it('accepts a bigint identifier as text', () => {
    expect(bigIntId('40001', 'snapshotId')).toBe('40001');
  });
  it('rejects a leading-zero identifier', () => {
    expect(() => bigIntId('040001', 'snapshotId')).toThrow();
  });
  it('rejects a negative identifier', () => {
    expect(() => bigIntId('-1', 'snapshotId')).toThrow();
  });
  it('passes null through', () => {
    expect(nullableBigIntId(null, 'snapshotId')).toBeNull();
  });
});

describe('boolean/integer/nullableInteger', () => {
  it('requires an actual boolean, not a truthy value', () => {
    expect(boolean(true, 'hasPlan')).toBe(true);
    expect(() => boolean(1, 'hasPlan')).toThrow();
  });
  it('requires an actual integer', () => {
    expect(integer(5, 'order')).toBe(5);
    expect(() => integer(5.5, 'order')).toThrow();
  });
  it('passes null through for nullableInteger', () => {
    expect(nullableInteger(null, 'order')).toBeNull();
  });
});

describe('nullableSignedIntegerText', () => {
  it('accepts a signed integer string, including negative and zero', () => {
    expect(nullableSignedIntegerText('-500', 'actualShareOfIncomeBps')).toBe('-500');
    expect(nullableSignedIntegerText('0', 'actualShareOfIncomeBps')).toBe('0');
    expect(nullableSignedIntegerText('99999999999999999999', 'actualShareOfIncomeBps')).toBe('99999999999999999999');
  });
  it('passes null through when income is nonpositive', () => {
    expect(nullableSignedIntegerText(null, 'actualShareOfIncomeBps')).toBeNull();
  });
  it('rejects a number (this field must arrive as unbounded-safe text)', () => {
    expect(() => nullableSignedIntegerText(-500, 'actualShareOfIncomeBps')).toThrow();
  });
  it('rejects a leading-zero string', () => {
    expect(() => nullableSignedIntegerText('012', 'actualShareOfIncomeBps')).toThrow();
  });
});

describe('currency', () => {
  it('accepts USD and LBP', () => {
    expect(currency('USD')).toBe('USD');
    expect(currency('LBP')).toBe('LBP');
  });
  it('rejects an unknown currency', () => {
    expect(() => currency('EUR')).toThrow();
  });
});

describe('enumValue', () => {
  it('accepts a listed member', () => {
    expect(enumValue('spending', ['spending', 'future'] as const, 'purpose')).toBe('spending');
  });
  it('rejects an unlisted value even though TypeScript could cast it', () => {
    expect(() => enumValue('unknown-kind', ['spending', 'future'] as const, 'purpose')).toThrow();
  });
});

describe('array', () => {
  it('accepts an array within the bound', () => {
    expect(array([1, 2], 'groups', 12)).toEqual([1, 2]);
  });
  it('rejects a non-array', () => {
    expect(() => array({}, 'groups', 12)).toThrow();
  });
  it('rejects an array beyond its cap (101-row response)', () => {
    expect(() => array(Array.from({ length: 102 }, (_v, index) => index), 'rows', 101)).toThrow();
  });
});

describe('uniqueBy', () => {
  it('accepts distinct keys', () => {
    expect(uniqueBy([{ id: 'a' }, { id: 'b' }], (item) => item.id, 'group id')).toHaveLength(2);
  });
  it('rejects a duplicate real group id', () => {
    expect(() => uniqueBy([{ id: 'a' }, { id: 'a' }], (item) => item.id, 'group id')).toThrow('Duplicate group id.');
  });
});
