import { describe, expect, it } from 'vitest';
import { hrefWithoutQuickAdd, readQuickAddIntent } from './quick-add.js';

describe('readQuickAddIntent', () => {
  it.each([
    ['?add=expense', 'expense'],
    ['?add=income', 'income'],
    ['?lang=ar&add=expense', 'expense'],
  ] as const)('reads %s as %s', (search, expected) => {
    expect(readQuickAddIntent(search)).toBe(expected);
  });

  it.each(['', '?add=', '?add=transfer', '?add=EXPENSE', '?add=expense%20', '?other=expense'])(
    'ignores %j',
    (search) => {
      expect(readQuickAddIntent(search)).toBeNull();
    },
  );
});

describe('hrefWithoutQuickAdd', () => {
  it('removes only the add parameter and keeps everything else', () => {
    expect(hrefWithoutQuickAdd('https://budget.example/?add=expense')).toBe('https://budget.example/');
    expect(hrefWithoutQuickAdd('https://budget.example/?lang=ar&add=income#top'))
      .toBe('https://budget.example/?lang=ar#top');
  });

  it('leaves a link without the parameter unchanged', () => {
    expect(hrefWithoutQuickAdd('https://budget.example/?lang=ar')).toBe('https://budget.example/?lang=ar');
  });
});
